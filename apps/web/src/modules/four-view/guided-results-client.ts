"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildGuidedResults, latestResultSeries, type ResultSource } from "./guided-results";

const PAGE = 200;
const unavailable = () => new Error("No se pudieron leer los análisis guardados. Tus fotos siguen guardadas; reintenta para ver los resultados.");
export class SessionMissingError extends Error {
  constructor() {
    super("No hay una sesión activa.");
    this.name = "SessionMissingError";
  }
}

// Bounded, paginated read: never silently turn a database error/truncated page
// into an empty jornada. No model calls, metrics RPCs or annotation mutations.
export async function readResultPages<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, signal?: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 100; page++) {
    signal?.throwIfAborted();
    const { data, error } = await read(page * PAGE, (page + 1) * PAGE - 1);
    signal?.throwIfAborted();
    if (error || !data) throw unavailable();
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
  throw new Error("Hay demasiados registros para esta consulta. Abre los resultados desde una jornada concreta.");
}

export async function loadGuidedResults(db: SupabaseClient, eventId?: string, signal?: AbortSignal) {
  const { data: auth, error } = await db.auth.getUser();
  signal?.throwIfAborted();
  if (error?.name === "AuthSessionMissingError" || !auth.user) throw new SessionMissingError();
  if (error) throw new Error("No se pudo recuperar tu sesión. Reintenta para cargar tus datos.");
  const ownerId = auth.user.id;
  async function read<K extends keyof ResultSource>(table: string, fields: string, _kind: K,
    filter?: { column: string; ids: string[] }, own = false): Promise<ResultSource[K]> {
    const groups = filter ? Array.from({ length: Math.ceil(filter.ids.length / 100) }, (_, i) => filter.ids.slice(i * 100, i * 100 + 100)) : [null];
    const rows: unknown[] = [];
    for (const ids of groups) rows.push(...await readResultPages(async (from, to) => {
      let query = db.from(table).select(fields).order(table === "guided_capture_reviews" ? "image_id" : "id").range(from, to);
      if (filter && ids) query = query.in(filter.column, ids);
      if (own) query = query.eq("owner_id", ownerId);
      if (table === "capture_views") query = query.eq("active", true);
      if (signal) query = query.abortSignal(signal);
      return await query;
    }, signal));
    return rows as ResultSource[K];
  }
  const projects = await read("projects", "id,name,owner_id", "projects", undefined, true);
  const sites = await read("sites", "id,name,project_id", "sites", { column: "project_id", ids: projects.map(p => p.id) });
  const siteFilter = { column: "site_id", ids: sites.map(s => s.id) };
  const [eventRows, trees] = await Promise.all([
    read("sampling_events", "id,name,site_id,sampled_at", "events", eventId ? { column: "id", ids: [eventId] } : siteFilter),
    read("trees", "id,code,site_id", "trees", siteFilter),
  ]);
  const events = eventRows.filter(e => sites.some(s => s.id === e.site_id));
  const samples = await read("tree_samples", "id,tree_id,site_id,sampling_event_id", "samples", { column: "sampling_event_id", ids: events.map(e => e.id) });
  const series = latestResultSeries(await read("capture_series", "id,tree_sample_id,created_at", "series", { column: "tree_sample_id", ids: samples.map(s => s.id) }));
  const captures = await read("capture_views", "id,capture_series_id,image_id,direction,active", "captures", { column: "capture_series_id", ids: series.map(s => s.id) });
  const reviews = await read("guided_capture_reviews", "image_id,tree_sample_id,owner_id,direction,review", "reviews", { column: "image_id", ids: [...new Set(captures.map(v => v.image_id))] }, true);
  return buildGuidedResults({ projects, sites, events, trees, samples, series, captures, reviews }, ownerId);
}

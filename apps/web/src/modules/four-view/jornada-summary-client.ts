"use client";

import { supabase } from "@/lib/supabase/client";
import { ecologyServices } from "./ecology-client";
import { readResultPages } from "./guided-results-client";
import { validateClosureSnapshot, type ClosureEvent } from "../jornada/closure";
import { buildEcologySummary } from "./ecology-summary";

// Read the same saved reviews as the editors. No inference, recalculation or writes.
export async function loadJornadaSummary(eventId: string, signal?: AbortSignal) {
  const data = await ecologyServices.load(eventId, signal);
  const { data: event, error } = await supabase.from("sampling_events")
    .select("id,site_id,name,status,updated_at").eq("id", eventId).abortSignal(signal ?? new AbortController().signal).maybeSingle();
  signal?.throwIfAborted();
  if (error || !event || event.id !== eventId) throw new Error("No se pudo leer el estado de esta jornada. Reintenta sin cambiar tus datos.");
  const samples = await readResultPages<{ id: string }>((from, to) => {
    let query = supabase.from("tree_samples").select("id").eq("sampling_event_id", eventId).order("id").range(from, to);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  validateClosureSnapshot({ event: event as ClosureEvent, rows: data.rows }, samples.map(s => s.id));
  buildEcologySummary(data, eventId);
  return { data, event: event as ClosureEvent };
}
export type JornadaSummarySnapshot = Awaited<ReturnType<typeof loadJornadaSummary>>;

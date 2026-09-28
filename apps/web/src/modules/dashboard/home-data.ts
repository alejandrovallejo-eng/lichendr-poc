"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { buildEcologySummary } from "../four-view/ecology-summary";
import { ecologyServices } from "../four-view/ecology-client";
import { loadGuidedResults } from "../four-view/guided-results-client";
import { buildDashboardHomeSnapshot } from "./home-logic";
export {
  buildDashboardFocusSnapshot,
  type CaptureSeriesRow,
  type DashboardFocusSnapshot,
  type DashboardHomeSnapshot,
  type DashboardJourneySummary,
  type SampleRow,
  type SamplingEventRow,
  type TreeRow,
} from "./home-logic";

export async function loadDashboardHomeData(signal?: AbortSignal) {
  const db = supabase as SupabaseClient;
  const rows = await loadGuidedResults(db, undefined, signal);
  const { data: projects, error: projectError } = await db.from("projects")
    .select("id,name,owner_id").order("created_at", { ascending: false }).abortSignal(signal ?? new AbortController().signal);
  signal?.throwIfAborted();
  if (projectError || !projects) throw new Error("No se pudo leer tu panel inicial. Reintenta sin cambiar tus datos.");
  const projectIds = projects.map((project) => project.id);
  const { data: sites, error: siteError } = projectIds.length
    ? await db.from("sites").select("id,name,project_id").in("project_id", projectIds).order("name").abortSignal(signal ?? new AbortController().signal)
    : { data: [], error: null };
  signal?.throwIfAborted();
  if (siteError || !sites) throw new Error("No se pudo leer tu panel inicial. Reintenta sin cambiar tus datos.");
  const siteIds = sites.map((site) => site.id);
  const { data: events, error: eventError } = siteIds.length
    ? await db.from("sampling_events").select("id,site_id,name,sampled_at,status,updated_at")
      .in("site_id", siteIds).order("sampled_at", { ascending: false }).abortSignal(signal ?? new AbortController().signal)
    : { data: [], error: null };
  signal?.throwIfAborted();
  if (eventError || !events) throw new Error("No se pudo leer tu panel inicial. Reintenta sin cambiar tus datos.");
  const { data: trees, error: treeError } = siteIds.length
    ? await db.from("trees").select("id,site_id").in("site_id", siteIds).abortSignal(signal ?? new AbortController().signal)
    : { data: [], error: null };
  signal?.throwIfAborted();
  if (treeError || !trees) throw new Error("No se pudo leer tu panel inicial. Reintenta sin cambiar tus datos.");
  const eventIds = events.map((event) => event.id);
  const { data: samples, error: sampleError } = eventIds.length
    ? await db.from("tree_samples").select("id,tree_id,sampling_event_id")
      .in("sampling_event_id", eventIds).abortSignal(signal ?? new AbortController().signal)
    : { data: [], error: null };
  signal?.throwIfAborted();
  if (sampleError || !samples) throw new Error("No se pudo leer tu panel inicial. Reintenta sin cambiar tus datos.");
  const sampleIds = samples.map((sample) => sample.id);
  const { data: series, error: seriesError } = sampleIds.length
    ? await db.from("capture_series").select("id,tree_sample_id,status,valid_view_count,pending_view_count,confirmed_at,updated_at,created_at")
      .in("tree_sample_id", sampleIds).abortSignal(signal ?? new AbortController().signal)
    : { data: [], error: null };
  signal?.throwIfAborted();
  if (seriesError || !series) throw new Error("No se pudo leer tu panel inicial. Reintenta sin cambiar tus datos.");
  return buildDashboardHomeSnapshot({
    projects,
    sites,
    events,
    trees,
    samples,
    series,
    rows,
  });
}

export async function loadDashboardFocusEcology(eventId: string, signal?: AbortSignal) {
  const data = await ecologyServices.load(eventId, signal);
  return buildEcologySummary(data, eventId);
}

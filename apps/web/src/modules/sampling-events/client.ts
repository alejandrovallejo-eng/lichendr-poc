import type { Database } from "@/types/supabase";
import type { SamplingEvent } from "@/types/domain";
import { supabase } from "@/lib/supabase/client";
import { ensureAnonymousSession } from "@/modules/auth/client";

const mapSamplingEvent = (row: Database["public"]["Tables"]["sampling_events"]["Row"]): SamplingEvent => ({
  id: row.id,
  siteId: row.site_id,
  name: row.name,
  sampledAt: row.sampled_at,
  observerNames: row.observer_names ?? undefined,
  weatherNotes: row.weather_notes ?? undefined,
  protocolVersion: row.protocol_version,
  status: row.status as SamplingEvent["status"],
  notes: row.notes ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function fetchSamplingEventsBySite(siteId: string) {
  const { error: authError } = await ensureAnonymousSession();

  if (authError) {
    return { samplingEvents: [] as SamplingEvent[], error: authError };
  }

  const { data, error } = await supabase
    .from("sampling_events")
    .select(
      "id, site_id, name, sampled_at, observer_names, weather_notes, protocol_version, status, notes, created_at, updated_at"
    )
    .eq("site_id", siteId)
    .order("sampled_at", { ascending: false });

  if (error) {
    return { samplingEvents: [] as SamplingEvent[], error: error.message };
  }

  return { samplingEvents: data?.map(mapSamplingEvent) ?? [], error: null };
}

interface CreateSamplingEventParams {
  siteId: string;
  name: string;
  sampledAt: string;
  observerNames?: string;
  weatherNotes?: string;
  protocolVersion?: string;
  status?: "draft" | "completed";
  notes?: string;
}

export async function createSamplingEvent(params: CreateSamplingEventParams) {
  const { error: authError } = await ensureAnonymousSession();

  if (authError) {
    return { samplingEvent: null as SamplingEvent | null, error: authError };
  }

  const insertData: Database["public"]["Tables"]["sampling_events"]["Insert"] = {
    site_id: params.siteId,
    name: params.name.trim(),
    sampled_at: params.sampledAt,
    observer_names: params.observerNames?.trim() || null,
    weather_notes: params.weatherNotes?.trim() || null,
    protocol_version: params.protocolVersion ?? "poc-v1",
    status: params.status ?? "draft",
    notes: params.notes?.trim() || null,
  };

  const { data, error } = await supabase
    .from("sampling_events")
    .insert([insertData])
    .select(
      "id, site_id, name, sampled_at, observer_names, weather_notes, protocol_version, status, notes, created_at, updated_at"
    )
    .single();

  if (error) {
    return { samplingEvent: null as SamplingEvent | null, error: error.message };
  }

  return { samplingEvent: data ? mapSamplingEvent(data) : null, error: null };
}

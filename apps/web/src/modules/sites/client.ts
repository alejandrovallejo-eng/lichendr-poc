import type { Database } from "@/types/supabase";
import type { Site } from "@/types/domain";
import { supabase } from "@/lib/supabase/client";
import { ensureAnonymousSession } from "@/modules/auth/client";

const mapSite = (row: Database["public"]["Tables"]["sites"]["Row"]): Site => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  description: row.description ?? undefined,
  province: row.province ?? undefined,
  municipality: row.municipality ?? undefined,
  latitude: row.latitude ?? undefined,
  longitude: row.longitude ?? undefined,
  gpsAccuracyM: row.gps_accuracy_m ?? undefined,
  locationSource: row.location_source as Site["locationSource"],
  radiusM: row.radius_m,
  notes: row.notes ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function fetchSitesByProject(projectId: string) {
  const { error: authError } = await ensureAnonymousSession();

  if (authError) {
    return { sites: [] as Site[], error: authError };
  }

  const { data, error } = await supabase
    .from("sites")
    .select("id, project_id, name, description, country_code, province, municipality, latitude, longitude, gps_accuracy_m, location_source, radius_m, notes, created_at, updated_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    return { sites: [] as Site[], error: error.message };
  }

  return { sites: data?.map(mapSite) ?? [], error: null };
}

interface CreateSiteParams {
  projectId: string;
  name: string;
  description?: string;
  province?: string;
  municipality?: string;
  latitude?: number;
  longitude?: number;
  gpsAccuracyM?: number;
  locationSource?: "unknown" | "manual" | "exif" | "gps";
  radiusM?: number;
  notes?: string;
}

export async function createSite(params: CreateSiteParams) {
  const { error: authError } = await ensureAnonymousSession();

  if (authError) {
    return { site: null as Site | null, error: authError };
  }

  const { projectId, name, description, province, municipality, latitude, longitude, gpsAccuracyM, locationSource, radiusM, notes } = params;

  const siteLocationSource =
    latitude != null && longitude != null
      ? "manual"
      : "unknown";

  const insertData: Database["public"]["Tables"]["sites"]["Insert"] = {
    project_id: projectId,
    name: name.trim(),
    description: description?.trim() || null,
    country_code: "DO",
    province: province?.trim() || null,
    municipality: municipality?.trim() || null,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    gps_accuracy_m: gpsAccuracyM ?? null,
    location_source: locationSource ?? siteLocationSource,
    radius_m: radiusM ?? 100,
    notes: notes?.trim() || null,
  };

  const { data, error } = await supabase
    .from("sites")
    .insert([insertData])
    .select("id, project_id, name, description, country_code, province, municipality, latitude, longitude, gps_accuracy_m, location_source, radius_m, notes, created_at, updated_at")
    .single();

  if (error) {
    return { site: null as Site | null, error: error.message };
  }

  return { site: data ? mapSite(data) : null, error: null };
}

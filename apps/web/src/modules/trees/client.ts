import type { Database } from "@/types/supabase";
import type { Tree, TreeSample } from "@/types/domain";
import { supabase } from "@/lib/supabase/client";
import { ensureAnonymousSession } from "@/modules/auth/client";

const mapTree = (row: Database["public"]["Tables"]["trees"]["Row"]): Tree => ({
  id: row.id,
  siteId: row.site_id,
  code: row.code,
  speciesName: row.species_name ?? undefined,
  speciesConfidence: row.species_confidence as Tree["speciesConfidence"],
  latitude: row.latitude ?? undefined,
  longitude: row.longitude ?? undefined,
  gpsAccuracyM: row.gps_accuracy_m ?? undefined,
  locationSource: row.location_source as Tree["locationSource"],
  notes: row.notes ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapTreeSample = (row: Database["public"]["Tables"]["tree_samples"]["Row"]): TreeSample => ({
  id: row.id,
  siteId: row.site_id,
  samplingEventId: row.sampling_event_id,
  treeId: row.tree_id,
  substrateType: row.substrate_type as TreeSample["substrateType"],
  trunkOrientation: row.trunk_orientation as TreeSample["trunkOrientation"],
  samplingHeightM: row.sampling_height_m ?? undefined,
  shadeLevel: row.shade_level as TreeSample["shadeLevel"],
  confidenceLevel: row.confidence_level as TreeSample["confidenceLevel"],
  notes: row.notes ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface TreeSampleWithTree extends TreeSample {
  tree: Tree | null;
}

export function enrichTreeSamplesWithTree(treeSamples: TreeSample[], trees: Tree[]): TreeSampleWithTree[] {
  const treeLookup = new Map(trees.map((tree) => [tree.id, tree]));

  return treeSamples.map((treeSample) => ({
    ...treeSample,
    tree: treeLookup.get(treeSample.treeId) ?? null,
  }));
}

export async function fetchTreesBySite(siteId: string) {
  const { error: authError } = await ensureAnonymousSession();
  if (authError) {
    return { trees: [] as Tree[], error: authError };
  }

  const { data, error } = await supabase
    .from("trees")
    .select(
      "id, site_id, code, species_name, species_confidence, latitude, longitude, gps_accuracy_m, location_source, notes, created_at, updated_at"
    )
    .eq("site_id", siteId)
    .order("created_at", { ascending: false });

  if (error) {
    return { trees: [] as Tree[], error: error.message };
  }

  return { trees: data?.map(mapTree) ?? [], error: null };
}

interface CreateTreeParams {
  siteId: string;
  code: string;
  speciesName?: string;
  speciesConfidence?: "unknown" | "low" | "medium" | "high";
  latitude?: number;
  longitude?: number;
  gpsAccuracyM?: number;
  locationSource?: "unknown" | "manual" | "exif" | "gps";
  notes?: string;
}

export async function createTree(params: CreateTreeParams) {
  const { error: authError } = await ensureAnonymousSession();
  if (authError) {
    return { tree: null as Tree | null, error: authError };
  }

  const insertData: Database["public"]["Tables"]["trees"]["Insert"] = {
    site_id: params.siteId,
    code: params.code.trim(),
    species_name: params.speciesName?.trim() || null,
    species_confidence: params.speciesConfidence ?? "unknown",
    latitude: params.latitude ?? null,
    longitude: params.longitude ?? null,
    gps_accuracy_m: params.gpsAccuracyM ?? null,
    location_source: params.locationSource ?? "unknown",
    notes: params.notes?.trim() || null,
  };

  const { data, error } = await supabase
    .from("trees")
    .insert([insertData])
    .select(
      "id, site_id, code, species_name, species_confidence, latitude, longitude, gps_accuracy_m, location_source, notes, created_at, updated_at"
    )
    .single();

  if (error) {
    return { tree: null as Tree | null, error: error.message };
  }

  return { tree: data ? mapTree(data) : null, error: null };
}

export async function fetchTreeSamplesByEvent(eventId: string) {
  const { error: authError } = await ensureAnonymousSession();
  if (authError) {
    return { treeSamples: [] as TreeSample[], error: authError };
  }

  const { data, error } = await supabase
    .from("tree_samples")
    .select(
      "id, site_id, sampling_event_id, tree_id, substrate_type, trunk_orientation, sampling_height_m, shade_level, confidence_level, notes, created_at, updated_at"
    )
    .eq("sampling_event_id", eventId)
    .order("created_at", { ascending: false });

  if (error) {
    return { treeSamples: [] as TreeSample[], error: error.message };
  }

  return { treeSamples: data?.map(mapTreeSample) ?? [], error: null };
}

interface CreateTreeSampleParams {
  siteId: string;
  samplingEventId: string;
  treeId: string;
  substrateType: "tree_bark" | "dead_wood" | "rock" | "soil" | "concrete" | "other" | "unknown";
  trunkOrientation: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "multiple" | "unknown";
  samplingHeightM?: number;
  shadeLevel: "unknown" | "low" | "medium" | "high";
  confidenceLevel: "unknown" | "low" | "medium" | "high";
  notes?: string;
}

export async function createTreeSample(params: CreateTreeSampleParams) {
  const { error: authError } = await ensureAnonymousSession();
  if (authError) {
    return { treeSample: null as TreeSample | null, error: authError };
  }

  const insertData: Database["public"]["Tables"]["tree_samples"]["Insert"] = {
    site_id: params.siteId,
    sampling_event_id: params.samplingEventId,
    tree_id: params.treeId,
    substrate_type: params.substrateType,
    trunk_orientation: params.trunkOrientation,
    sampling_height_m: params.samplingHeightM ?? null,
    shade_level: params.shadeLevel,
    confidence_level: params.confidenceLevel,
    notes: params.notes?.trim() || null,
  };

  const { data, error } = await supabase
    .from("tree_samples")
    .insert([insertData])
    .select(
      "id, site_id, sampling_event_id, tree_id, substrate_type, trunk_orientation, sampling_height_m, shade_level, confidence_level, notes, created_at, updated_at"
    )
    .single();

  if (error) {
    return { treeSample: null as TreeSample | null, error: error.message };
  }

  return { treeSample: data ? mapTreeSample(data) : null, error: null };
}

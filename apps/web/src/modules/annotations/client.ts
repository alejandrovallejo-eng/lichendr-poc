import { ensureAnonymousSession } from "@/modules/auth/client";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/types/supabase";

const VALID_REGION_CLASSIFICATIONS = ["lichen", "bark", "moss", "algae", "shadow", "glare", "unknown"] as const;

export type AnnotationSetRow = Database["public"]["Tables"]["annotation_sets"]["Row"];
export type MorphotypeRow = Database["public"]["Tables"]["morphotypes"]["Row"];
export type AnnotationPointRow = Database["public"]["Tables"]["annotation_points"]["Row"];

export type AnnotationSetStatus = "draft" | "completed";
export type AnnotationMethod = "systematic_point_count" | "manual_free_points" | "ai_assisted_segmentation";
export type MorphotypeGrowthForm = "crustose" | "foliose" | "fruticose" | "squamulose" | "unknown";
export type AnnotationPointClassification = "lichen" | "bark" | "moss" | "algae" | "shadow" | "glare" | "unknown";
export type AnnotationPointConfidenceLevel = "low" | "medium" | "high";

export interface AccessibleImageRecord {
  id: string;
  tree_sample_id: string;
  original_filename: string;
  created_at: string;
  storage_path: string;
}

export type ImageEvaluationStatus = "not_started" | "draft" | "completed";

export interface AnnotationImageContext {
  treeSampleId: string;
  treeId: string;
  treeCode: string;
  samplingEventId: string;
  samplingEventName: string;
  sampledAt: string;
  siteId: string;
  siteName: string;
  projectId: string;
  projectName: string;
}

export interface AnnotationImageListItem extends AccessibleImageRecord {
  annotationSetId: string | null;
  annotationStatus: ImageEvaluationStatus;
  completedAt: string | null;
  context: AnnotationImageContext;
  regionCount: number;
  evaluatedRegionCount: number;
  lichenRegionCount: number;
  morphotypeLabels: string[];
  provisionalCoveragePercent: number | null;
}

export interface AnnotationCompletionResult {
  annotationSet: AnnotationSetRow;
  regions: Database["public"]["Tables"]["annotation_regions"]["Row"][];
  morphotypes: MorphotypeRow[];
}

export interface AnnotationSetDraft {
  imageId: string;
  version?: number;
  method?: AnnotationMethod;
  status?: AnnotationSetStatus;
  gridRows: number;
  gridColumns: number;
  roiX: number | null;
  roiY: number | null;
  roiWidth: number | null;
  roiHeight: number | null;
  notes?: string | null;
  completedAt?: string | null;
}

export interface MorphotypeDraft {
  id?: string;
  annotationSetId: string;
  label: string;
  growthForm: MorphotypeGrowthForm;
  colorHex: string | null;
  notes: string | null;
}

export interface AnnotationPointDraft {
  id?: string;
  annotationSetId: string;
  pointIndex: number;
  xNormalized: number;
  yNormalized: number;
  classification: AnnotationPointClassification;
  confidenceLevel: AnnotationPointConfidenceLevel;
  morphotypeId: string | null;
  notes?: string | null;
}

export interface AnnotationStateBundle {
  annotationSet: AnnotationSetRow | null;
  morphotypes: MorphotypeRow[];
  points: AnnotationPointRow[];
}

export interface AnnotationRoiState {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}

export function isValidAnnotationRoi(roi: AnnotationRoiState): boolean {
  if (roi.x == null || roi.y == null || roi.width == null || roi.height == null) {
    return false;
  }

  if (![roi.x, roi.y, roi.width, roi.height].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return false;
  }

  return roi.x >= 0 && roi.x <= 1 && roi.y >= 0 && roi.y <= 1 && roi.width > 0 && roi.height > 0 && roi.x + roi.width <= 1 && roi.y + roi.height <= 1;
}

async function ensureSession() {
  const sessionResult = await ensureAnonymousSession();
  if (sessionResult.error || !sessionResult.session) {
    throw new Error(sessionResult.error ?? "No se pudo obtener una sesión válida.");
  }
}

export async function listAccessibleImages(): Promise<AccessibleImageRecord[]> {
  await ensureSession();

  const { data, error } = await supabase
    .from("images")
    .select("id, tree_sample_id, original_filename, created_at, storage_path")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as AccessibleImageRecord[];
}

export async function listAnnotationImages(): Promise<AnnotationImageListItem[]> {
  const images = await listAccessibleImages();
  if (images.length === 0) return [];

  const imageIds = images.map((image) => image.id);
  const treeSampleIds = [...new Set(images.map((image) => image.tree_sample_id))];
  const [{ data: annotationSets, error: annotationSetsError }, { data: treeSamples, error: treeSamplesError }] = await Promise.all([
    supabase
      .from("annotation_sets")
      .select("id, image_id, status, completed_at")
      .eq("version", 1)
      .in("image_id", imageIds),
    supabase
      .from("tree_samples")
      .select("id, tree_id, sampling_event_id, site_id")
      .in("id", treeSampleIds),
  ]);
  if (annotationSetsError) throw annotationSetsError;
  if (treeSamplesError) throw treeSamplesError;

  const samples = treeSamples ?? [];
  const treeIds = [...new Set(samples.map((sample) => sample.tree_id))];
  const eventIds = [...new Set(samples.map((sample) => sample.sampling_event_id))];
  const siteIds = [...new Set(samples.map((sample) => sample.site_id))];
  const annotationSetIds = (annotationSets ?? []).map((annotationSet) => annotationSet.id);
  const [
    { data: trees, error: treesError },
    { data: events, error: eventsError },
    { data: sites, error: sitesError },
    regionsResult,
    morphotypesResult,
  ] = await Promise.all([
    supabase.from("trees").select("id, code").in("id", treeIds),
    supabase.from("sampling_events").select("id, name, sampled_at").in("id", eventIds),
    supabase.from("sites").select("id, name, project_id").in("id", siteIds),
    annotationSetIds.length > 0
      ? supabase
        .from("annotation_regions")
        .select("id, annotation_set_id, classification, morphotype_id, region_role, area_pixels, status")
        .in("annotation_set_id", annotationSetIds)
      : Promise.resolve({ data: [], error: null }),
    annotationSetIds.length > 0
      ? supabase
        .from("morphotypes")
        .select("id, annotation_set_id, label")
        .in("annotation_set_id", annotationSetIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (treesError) throw treesError;
  if (eventsError) throw eventsError;
  if (sitesError) throw sitesError;
  if (regionsResult.error) throw regionsResult.error;
  if (morphotypesResult.error) throw morphotypesResult.error;

  const projectIds = [...new Set((sites ?? []).map((site) => site.project_id))];
  const { data: projects, error: projectsError } = projectIds.length > 0
    ? await supabase.from("projects").select("id, name").in("id", projectIds)
    : { data: [], error: null };
  if (projectsError) throw projectsError;

  const annotationSetByImageId = new Map((annotationSets ?? []).map((annotationSet) => [annotationSet.image_id, annotationSet]));
  const sampleById = new Map(samples.map((sample) => [sample.id, sample]));
  const treeById = new Map((trees ?? []).map((tree) => [tree.id, tree]));
  const eventById = new Map((events ?? []).map((event) => [event.id, event]));
  const siteById = new Map((sites ?? []).map((site) => [site.id, site]));
  const projectById = new Map((projects ?? []).map((project) => [project.id, project]));
  const morphotypeById = new Map((morphotypesResult.data ?? []).map((morphotype) => [morphotype.id, morphotype]));

  return images.flatMap((image) => {
    const sample = sampleById.get(image.tree_sample_id);
    const tree = sample ? treeById.get(sample.tree_id) : null;
    const event = sample ? eventById.get(sample.sampling_event_id) : null;
    const site = sample ? siteById.get(sample.site_id) : null;
    const project = site ? projectById.get(site.project_id) : null;
    if (!sample || !tree || !event || !site || !project) return [];

    const annotationSet = annotationSetByImageId.get(image.id) ?? null;
    const acceptedRegions = annotationSet
      ? (regionsResult.data ?? []).filter((region) => region.annotation_set_id === annotationSet.id && region.status === "accepted")
      : [];
    const evaluatedRegions = acceptedRegions.filter((region) => region.region_role !== "trunk");
    const lichenRegions = evaluatedRegions.filter((region) => region.classification === "lichen");
    const trunkArea = acceptedRegions.find((region) => region.region_role === "trunk")?.area_pixels ?? null;
    const lichenArea = lichenRegions.reduce((total, region) => total + region.area_pixels, 0);
    const morphotypeLabels = [...new Set(lichenRegions.flatMap((region) => {
      if (!region.morphotype_id) return [];
      const morphotype = morphotypeById.get(region.morphotype_id);
      return morphotype ? [morphotype.label] : [];
    }))];
    const isCompleted = annotationSet?.status === "completed" && Boolean(annotationSet.completed_at);

    return [{
      ...image,
      annotationSetId: annotationSet?.id ?? null,
      annotationStatus: isCompleted ? "completed" : annotationSet ? "draft" : "not_started",
      completedAt: isCompleted ? annotationSet.completed_at : null,
      context: {
        treeSampleId: sample.id,
        treeId: tree.id,
        treeCode: tree.code,
        samplingEventId: event.id,
        samplingEventName: event.name,
        sampledAt: event.sampled_at,
        siteId: site.id,
        siteName: site.name,
        projectId: project.id,
        projectName: project.name,
      },
      regionCount: acceptedRegions.length,
      evaluatedRegionCount: evaluatedRegions.length,
      lichenRegionCount: lichenRegions.length,
      morphotypeLabels,
      provisionalCoveragePercent: trunkArea && trunkArea > 0
        ? Math.min(100, lichenArea / trunkArea * 100)
        : null,
    }];
  });
}

export async function getSignedImageUrl(storagePath: string): Promise<string> {
  await ensureSession();

  const { data, error } = await supabase.storage.from("lichen-images").createSignedUrl(storagePath, 10 * 60);
  if (error) {
    throw error;
  }

  return data.signedUrl;
}

export async function getImageRecord(imageId: string): Promise<AccessibleImageRecord | null> {
  await ensureSession();

  const { data, error } = await supabase.from("images").select("id, tree_sample_id, original_filename, created_at, storage_path").eq("id", imageId).maybeSingle();
  if (error) {
    throw error;
  }

  return (data as AccessibleImageRecord | null) ?? null;
}

export async function loadAnnotationState(imageId: string): Promise<AnnotationStateBundle> {
  await ensureSession();

  const { data: annotationSet, error: annotationSetError } = await supabase
    .from("annotation_sets")
    .select("*")
    .eq("image_id", imageId)
    .eq("version", 1)
    .maybeSingle();

  if (annotationSetError) {
    throw annotationSetError;
  }

  if (!annotationSet) {
    return { annotationSet: null, morphotypes: [], points: [] };
  }

  const annotationSetId = annotationSet.id;

  const [{ data: morphotypes, error: morphotypesError }, { data: points, error: pointsError }] = await Promise.all([
    supabase.from("morphotypes").select("*").eq("annotation_set_id", annotationSetId).order("created_at", { ascending: true }),
    supabase.from("annotation_points").select("*").eq("annotation_set_id", annotationSetId).order("point_index", { ascending: true }),
  ]);

  if (morphotypesError) {
    throw morphotypesError;
  }

  if (pointsError) {
    throw pointsError;
  }

  return {
    annotationSet: annotationSet as AnnotationSetRow,
    morphotypes: (morphotypes ?? []) as MorphotypeRow[],
    points: (points ?? []) as AnnotationPointRow[],
  };
}

export async function ensureAnnotationSetForImage(
  imageId: string,
  defaults?: Partial<Pick<AnnotationSetDraft, "method" | "status" | "gridRows" | "gridColumns" | "roiX" | "roiY" | "roiWidth" | "roiHeight" | "notes">>,
): Promise<AnnotationSetRow> {
  const state = await loadAnnotationState(imageId);
  if (state.annotationSet) {
    return state.annotationSet;
  }

  return upsertAnnotationSet({
    imageId,
    method: defaults?.method ?? "manual_free_points",
    status: defaults?.status ?? "draft",
    gridRows: defaults?.gridRows ?? 10,
    gridColumns: defaults?.gridColumns ?? 10,
    roiX: defaults?.roiX ?? 0,
    roiY: defaults?.roiY ?? 0,
    roiWidth: defaults?.roiWidth ?? 1,
    roiHeight: defaults?.roiHeight ?? 1,
    notes: defaults?.notes ?? null,
  });
}

export async function upsertAnnotationSet(payload: AnnotationSetDraft): Promise<AnnotationSetRow> {
  await ensureSession();

  const existing = await supabase.from("annotation_sets").select("*").eq("image_id", payload.imageId).eq("version", payload.version ?? 1).maybeSingle();
  if (existing.error) {
    throw existing.error;
  }

  const basePayload = {
    image_id: payload.imageId,
    method: payload.method ?? "systematic_point_count",
    status: payload.status ?? "draft",
    version: payload.version ?? 1,
    grid_rows: payload.gridRows,
    grid_columns: payload.gridColumns,
    roi_x: payload.roiX ?? null,
    roi_y: payload.roiY ?? null,
    roi_width: payload.roiWidth ?? null,
    roi_height: payload.roiHeight ?? null,
    notes: payload.notes ?? null,
    completed_at: payload.completedAt ?? null,
  };

  if (existing.data) {
    const { data, error } = await supabase
      .from("annotation_sets")
      .update(basePayload)
      .eq("id", existing.data.id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as AnnotationSetRow;
  }

  const { data, error } = await supabase.from("annotation_sets").insert(basePayload).select("*").single();
  if (error) {
    throw error;
  }

  return data as AnnotationSetRow;
}

export async function upsertMorphotype(payload: MorphotypeDraft): Promise<MorphotypeRow> {
  await ensureSession();

  if (payload.id) {
    const { data, error } = await supabase
      .from("morphotypes")
      .update({
        annotation_set_id: payload.annotationSetId,
        label: payload.label,
        growth_form: payload.growthForm,
        color_hex: payload.colorHex,
        notes: payload.notes,
      })
      .eq("id", payload.id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as MorphotypeRow;
  }

  const { data, error } = await supabase
    .from("morphotypes")
    .insert({
      annotation_set_id: payload.annotationSetId,
      label: payload.label,
      growth_form: payload.growthForm,
      color_hex: payload.colorHex,
      notes: payload.notes,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as MorphotypeRow;
}

export async function deleteMorphotype(morphotypeId: string): Promise<void> {
  await ensureSession();

  const { error } = await supabase.from("morphotypes").delete().eq("id", morphotypeId);
  if (error) {
    throw error;
  }
}

export async function upsertAnnotationPoint(payload: AnnotationPointDraft): Promise<AnnotationPointRow> {
  await ensureSession();

  const pointPayload = {
    annotation_set_id: payload.annotationSetId,
    morphotype_id: payload.morphotypeId,
    point_index: payload.pointIndex,
    x_normalized: payload.xNormalized,
    y_normalized: payload.yNormalized,
    classification: payload.classification,
    confidence_level: payload.confidenceLevel,
    notes: payload.notes ?? null,
  };

  if (payload.id) {
    const { data, error } = await supabase.from("annotation_points").update(pointPayload).eq("id", payload.id).select("*").single();
    if (error) {
      throw error;
    }

    return data as AnnotationPointRow;
  }

  const { data, error } = await supabase.from("annotation_points").upsert(pointPayload, { onConflict: "annotation_set_id,point_index" }).select("*").single();
  if (error) {
    throw error;
  }

  return data as AnnotationPointRow;
}

export async function deleteAnnotationPoint(pointId: string): Promise<void> {
  await ensureSession();

  const { error } = await supabase.from("annotation_points").delete().eq("id", pointId);
  if (error) {
    throw error;
  }
}

export async function completeAnnotationSet(annotationSetId: string): Promise<AnnotationSetRow> {
  await ensureSession();

  const { data, error } = await supabase
    .from("annotation_sets")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", annotationSetId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as AnnotationSetRow;
}

export async function finalizeAnnotationSet(annotationSetId: string, imageId: string): Promise<AnnotationCompletionResult> {
  await ensureSession();

  const [
    { data: image, error: imageError },
    { data: annotationSet, error: annotationSetError },
    { data: regions, error: regionsError },
    { data: morphotypes, error: morphotypesError },
  ] = await Promise.all([
    supabase.from("images").select("id").eq("id", imageId).maybeSingle(),
    supabase
      .from("annotation_sets")
      .select("*")
      .eq("id", annotationSetId)
      .eq("image_id", imageId)
      .eq("version", 1)
      .maybeSingle(),
    supabase.from("annotation_regions").select("*").eq("annotation_set_id", annotationSetId),
    supabase.from("morphotypes").select("*").eq("annotation_set_id", annotationSetId),
  ]);
  if (imageError || !image) throw new Error("La imagen guardada no está disponible.");
  if (annotationSetError || !annotationSet) throw new Error("El conjunto de anotación no está disponible.");
  if (regionsError) throw new Error("No se pudieron verificar las regiones guardadas.");
  if (morphotypesError) throw new Error("No se pudieron verificar los morfotipos.");
  if (annotationSet.status !== "draft" || annotationSet.completed_at) {
    throw new Error("La evaluación no está en estado borrador.");
  }

  const pendingRegions = (regions ?? []).filter((region) => region.status === "draft");
  if (pendingRegions.length > 0) throw new Error("Hay regiones pendientes de confirmar.");
  const acceptedRegions = (regions ?? []).filter((region) => region.status === "accepted");
  const trunk = acceptedRegions.find((region) => region.region_role === "trunk");
  if (!trunk) throw new Error("Confirma el tronco antes de finalizar.");
  const evaluatedRegions = acceptedRegions.filter((region) => region.region_role !== "trunk");
  if (evaluatedRegions.length === 0) throw new Error("Evalúa al menos una región antes de finalizar.");

  const morphotypeIds = new Set((morphotypes ?? []).map((morphotype) => morphotype.id));
  if (evaluatedRegions.some((region) => !VALID_REGION_CLASSIFICATIONS.includes(region.classification))) {
    throw new Error("Todas las regiones deben tener una clasificación válida.");
  }
  if (evaluatedRegions.some((region) => region.classification === "lichen" && (!region.morphotype_id || !morphotypeIds.has(region.morphotype_id)))) {
    throw new Error("Todas las regiones de liquen deben tener un morfotipo.");
  }

  await Promise.all(acceptedRegions.map(async (region) => {
    const { data, error } = await supabase.storage.from(region.mask_bucket).download(region.mask_path);
    if (error || !data || data.size === 0) {
      throw new Error("No se pudieron verificar todas las máscaras guardadas.");
    }
  }));

  const completedAt = new Date().toISOString();
  const { data: completed, error: completionError } = await supabase
    .from("annotation_sets")
    .update({ status: "completed", completed_at: completedAt })
    .eq("id", annotationSetId)
    .eq("image_id", imageId)
    .eq("status", "draft")
    .select("*")
    .single();
  if (completionError) throw new Error("No se pudo finalizar la evaluación. El borrador se conserva.");

  return {
    annotationSet: completed as AnnotationSetRow,
    regions: acceptedRegions,
    morphotypes: (morphotypes ?? []) as MorphotypeRow[],
  };
}

export async function reopenAnnotationSet(annotationSetId: string, imageId: string): Promise<AnnotationSetRow> {
  await ensureSession();
  const { data, error } = await supabase
    .from("annotation_sets")
    .update({ status: "draft", completed_at: null })
    .eq("id", annotationSetId)
    .eq("image_id", imageId)
    .eq("status", "completed")
    .select("*")
    .single();
  if (error) throw new Error("No se pudo reabrir la evaluación.");
  return data as AnnotationSetRow;
}

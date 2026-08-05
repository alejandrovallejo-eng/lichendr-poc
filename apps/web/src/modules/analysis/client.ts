import { ensureAnonymousSession } from "@/modules/auth/client";
import { supabase } from "@/lib/supabase/client";
import { loadMaskFromUrl } from "@/modules/annotations/studio-browser-utils";
import {
  calculateAnnotationMetricSummary,
  type AnnotationMetricSummary,
  type AnnotationQualityFlag,
} from "@/modules/annotations/studio-mask-utils";
import type { Database } from "@/types/supabase";

export type AnnotationMetricsRow = Database["public"]["Tables"]["annotation_metrics"]["Row"];

export interface AnalysisMorphotypeObservation {
  id: string;
  label: string;
  growthForm: string;
  colorHex: string | null;
  regionCount: number;
}

export interface AnalysisEvaluation {
  annotationSetId: string;
  imageId: string;
  imageName: string;
  completedAt: string;
  projectId: string;
  projectName: string;
  siteId: string;
  siteName: string;
  samplingEventId: string;
  samplingEventName: string;
  treeSampleId: string;
  treeId: string;
  treeCode: string;
  metrics: AnnotationMetricsRow | null;
  morphotypes: AnalysisMorphotypeObservation[];
}

const QUALITY_FLAGS = new Set<AnnotationQualityFlag>([
  "missing_trunk",
  "zero_trunk_area",
  "mask_dimension_mismatch",
  "lichen_outside_trunk",
  "high_lichen_overlap",
  "no_lichen_regions",
  "summary_pending",
  "signed_mask_unavailable",
]);

function normalizeQualityFlags(value: AnnotationMetricsRow["quality_flags"]): AnnotationQualityFlag[] {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([flag, enabled]) => enabled === true ? [flag] : [])
      : [];
  return candidates.filter((flag): flag is AnnotationQualityFlag => (
    typeof flag === "string" && QUALITY_FLAGS.has(flag as AnnotationQualityFlag)
  ));
}

export function evaluationQualityFlags(evaluation: AnalysisEvaluation): AnnotationQualityFlag[] {
  if (!evaluation.metrics) return ["summary_pending"];
  return normalizeQualityFlags(evaluation.metrics.quality_flags);
}

async function ensureSession(): Promise<void> {
  const sessionResult = await ensureAnonymousSession();
  if (sessionResult.error || !sessionResult.session) {
    throw new Error(sessionResult.error ?? "No se pudo obtener una sesión válida.");
  }
}

export async function listAnalysisEvaluations(signal?: AbortSignal): Promise<AnalysisEvaluation[]> {
  await ensureSession();
  signal?.throwIfAborted();

  const { data: annotationSets, error: annotationSetsError } = await supabase
    .from("annotation_sets")
    .select("id, image_id, completed_at")
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .abortSignal(signal ?? new AbortController().signal);
  if (annotationSetsError) throw annotationSetsError;
  if (!annotationSets?.length) return [];

  const annotationSetIds = annotationSets.map((item) => item.id);
  const imageIds = annotationSets.map((item) => item.image_id);
  const [
    { data: metrics, error: metricsError },
    { data: images, error: imagesError },
    { data: regions, error: regionsError },
    { data: morphotypes, error: morphotypesError },
  ] = await Promise.all([
    supabase.from("annotation_metrics").select("*").in("annotation_set_id", annotationSetIds).abortSignal(signal ?? new AbortController().signal),
    supabase.from("images").select("id, tree_sample_id, original_filename").in("id", imageIds).abortSignal(signal ?? new AbortController().signal),
    supabase
      .from("annotation_regions")
      .select("id, annotation_set_id, morphotype_id")
      .in("annotation_set_id", annotationSetIds)
      .eq("status", "accepted")
      .eq("classification", "lichen")
      .abortSignal(signal ?? new AbortController().signal),
    supabase
      .from("morphotypes")
      .select("id, annotation_set_id, label, growth_form, color_hex")
      .in("annotation_set_id", annotationSetIds)
      .abortSignal(signal ?? new AbortController().signal),
  ]);
  if (metricsError) throw metricsError;
  if (imagesError) throw imagesError;
  if (regionsError) throw regionsError;
  if (morphotypesError) throw morphotypesError;

  const treeSampleIds = [...new Set((images ?? []).map((image) => image.tree_sample_id))];
  const { data: samples, error: samplesError } = await supabase
    .from("tree_samples")
    .select("id, tree_id, sampling_event_id, site_id")
    .in("id", treeSampleIds)
    .abortSignal(signal ?? new AbortController().signal);
  if (samplesError) throw samplesError;

  const treeIds = [...new Set((samples ?? []).map((sample) => sample.tree_id))];
  const eventIds = [...new Set((samples ?? []).map((sample) => sample.sampling_event_id))];
  const siteIds = [...new Set((samples ?? []).map((sample) => sample.site_id))];
  const [
    { data: trees, error: treesError },
    { data: events, error: eventsError },
    { data: sites, error: sitesError },
  ] = await Promise.all([
    supabase.from("trees").select("id, code").in("id", treeIds).abortSignal(signal ?? new AbortController().signal),
    supabase.from("sampling_events").select("id, name").in("id", eventIds).abortSignal(signal ?? new AbortController().signal),
    supabase.from("sites").select("id, project_id, name").in("id", siteIds).abortSignal(signal ?? new AbortController().signal),
  ]);
  if (treesError) throw treesError;
  if (eventsError) throw eventsError;
  if (sitesError) throw sitesError;

  const projectIds = [...new Set((sites ?? []).map((site) => site.project_id))];
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name")
    .in("id", projectIds)
    .abortSignal(signal ?? new AbortController().signal);
  if (projectsError) throw projectsError;

  const imageById = new Map((images ?? []).map((item) => [item.id, item]));
  const sampleById = new Map((samples ?? []).map((item) => [item.id, item]));
  const treeById = new Map((trees ?? []).map((item) => [item.id, item]));
  const eventById = new Map((events ?? []).map((item) => [item.id, item]));
  const siteById = new Map((sites ?? []).map((item) => [item.id, item]));
  const projectById = new Map((projects ?? []).map((item) => [item.id, item]));
  const metricsBySetId = new Map((metrics ?? []).map((item) => [item.annotation_set_id, item as AnnotationMetricsRow]));
  const morphotypeById = new Map((morphotypes ?? []).map((item) => [item.id, item]));

  return annotationSets.flatMap((annotationSet) => {
    const image = imageById.get(annotationSet.image_id);
    const sample = image ? sampleById.get(image.tree_sample_id) : null;
    const tree = sample ? treeById.get(sample.tree_id) : null;
    const event = sample ? eventById.get(sample.sampling_event_id) : null;
    const site = sample ? siteById.get(sample.site_id) : null;
    const project = site ? projectById.get(site.project_id) : null;
    if (!annotationSet.completed_at || !image || !sample || !tree || !event || !site || !project) return [];

    const regionCounts = new Map<string, number>();
    for (const region of regions ?? []) {
      if (region.annotation_set_id !== annotationSet.id || !region.morphotype_id) continue;
      regionCounts.set(region.morphotype_id, (regionCounts.get(region.morphotype_id) ?? 0) + 1);
    }
    const observations = [...regionCounts.entries()].flatMap(([morphotypeId, regionCount]) => {
      const morphotype = morphotypeById.get(morphotypeId);
      if (!morphotype) return [];
      return [{
        id: morphotype.id,
        label: morphotype.label,
        growthForm: morphotype.growth_form,
        colorHex: morphotype.color_hex,
        regionCount,
      }];
    });

    return [{
      annotationSetId: annotationSet.id,
      imageId: image.id,
      imageName: image.original_filename,
      completedAt: annotationSet.completed_at,
      projectId: project.id,
      projectName: project.name,
      siteId: site.id,
      siteName: site.name,
      samplingEventId: event.id,
      samplingEventName: event.name,
      treeSampleId: sample.id,
      treeId: tree.id,
      treeCode: tree.code,
      metrics: metricsBySetId.get(annotationSet.id) ?? null,
      morphotypes: observations,
    }];
  });
}

export async function recalculateEvaluationMetrics(
  annotationSetId: string,
  signal?: AbortSignal,
): Promise<AnnotationMetricsRow> {
  await ensureSession();
  signal?.throwIfAborted();

  const [
    { data: annotationSet, error: annotationSetError },
    { data: regions, error: regionsError },
    { data: morphotypes, error: morphotypesError },
  ] = await Promise.all([
    supabase
      .from("annotation_sets")
      .select("id")
      .eq("id", annotationSetId)
      .eq("status", "completed")
      .not("completed_at", "is", null)
      .abortSignal(signal ?? new AbortController().signal)
      .maybeSingle(),
    supabase
      .from("annotation_regions")
      .select("*")
      .eq("annotation_set_id", annotationSetId)
      .eq("status", "accepted")
      .abortSignal(signal ?? new AbortController().signal),
    supabase
      .from("morphotypes")
      .select("id")
      .eq("annotation_set_id", annotationSetId)
      .abortSignal(signal ?? new AbortController().signal),
  ]);
  if (annotationSetError || !annotationSet) throw new Error("La evaluación completada no está disponible.");
  if (regionsError) throw new Error("No se pudieron consultar las regiones aceptadas.");
  if (morphotypesError) throw new Error("No se pudieron consultar los morfotipos.");

  const acceptedRegions = regions ?? [];
  const trunk = acceptedRegions.find((region) => region.region_role === "trunk") ?? null;
  const lichenRegions = acceptedRegions.filter((region) => region.classification === "lichen");
  const usedMorphotypeIds = new Set(lichenRegions.flatMap((region) => (
    region.morphotype_id ? [region.morphotype_id] : []
  )));

  let metricSummary: AnnotationMetricSummary;
  const dimensionsMatch = !trunk || lichenRegions.every((region) => (
    region.mask_width_px === trunk.mask_width_px && region.mask_height_px === trunk.mask_height_px
  ));
  if (!dimensionsMatch) {
    metricSummary = {
      trunkAreaPixels: trunk?.area_pixels ?? null,
      lichenUnionInsideTrunkPixels: null,
      lichenOutsideTrunkPixels: null,
      overlappingLichenPixels: null,
      coveragePercent: null,
      qualityFlags: [
        ...(lichenRegions.length === 0 ? ["no_lichen_regions" as const] : []),
        "mask_dimension_mismatch" as const,
      ],
    };
  } else if (!trunk) {
    metricSummary = calculateAnnotationMetricSummary(null, []);
    if (lichenRegions.length > 0) {
      metricSummary.qualityFlags = metricSummary.qualityFlags.filter((flag) => flag !== "no_lichen_regions");
    }
  } else {
    const maskRegions = [trunk, ...lichenRegions];
    let signedUrls: string[] | null = null;
    try {
      signedUrls = await Promise.all(maskRegions.map(async (region) => {
        const { data, error } = await supabase.storage.from(region.mask_bucket).createSignedUrl(region.mask_path, 5 * 60);
        if (error || !data?.signedUrl) throw new Error("signed_mask_unavailable");
        return data.signedUrl;
      }));
    } catch {
      signal?.throwIfAborted();
      metricSummary = {
        trunkAreaPixels: null,
        lichenUnionInsideTrunkPixels: null,
        lichenOutsideTrunkPixels: null,
        overlappingLichenPixels: null,
        coveragePercent: null,
        qualityFlags: [
          ...(lichenRegions.length === 0 ? ["no_lichen_regions" as const] : []),
          "signed_mask_unavailable",
        ],
      };
    }
    if (signedUrls) {
      signal?.throwIfAborted();
      try {
        const masks = await Promise.all(maskRegions.map((region, index) => (
          loadMaskFromUrl(signedUrls[index], region.mask_width_px, region.mask_height_px, signal)
        )));
        metricSummary = calculateAnnotationMetricSummary(masks[0], masks.slice(1));
      } catch (reason) {
        if ((reason as { name?: string }).name === "AbortError") throw reason;
        const incompatibleDimensions = reason instanceof Error && reason.message.includes("dimensiones");
        metricSummary = {
          trunkAreaPixels: null,
          lichenUnionInsideTrunkPixels: null,
          lichenOutsideTrunkPixels: null,
          overlappingLichenPixels: null,
          coveragePercent: null,
          qualityFlags: [
            ...(lichenRegions.length === 0 ? ["no_lichen_regions" as const] : []),
            incompatibleDimensions ? "mask_dimension_mismatch" : "signed_mask_unavailable",
          ],
        };
      }
    }
  }

  const payload: Database["public"]["Tables"]["annotation_metrics"]["Insert"] = {
    annotation_set_id: annotationSetId,
    trunk_area_pixels: metricSummary.trunkAreaPixels,
    lichen_union_area_pixels: metricSummary.lichenUnionInsideTrunkPixels,
    lichen_outside_trunk_pixels: metricSummary.lichenOutsideTrunkPixels,
    overlapping_lichen_pixels: metricSummary.overlappingLichenPixels,
    coverage_percent: metricSummary.coveragePercent,
    accepted_region_count: acceptedRegions.length,
    lichen_region_count: lichenRegions.length,
    morphotype_count: Math.min(usedMorphotypeIds.size, morphotypes?.length ?? 0),
    calculation_method: "mask_union_intersection",
    calculation_version: "1.1.0",
    quality_flags: metricSummary.qualityFlags,
    calculated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("annotation_metrics")
    .upsert(payload, { onConflict: "annotation_set_id" })
    .select("*")
    .single();
  if (error || !data) throw new Error("No se pudo guardar el resumen calculado.");
  return data as AnnotationMetricsRow;
}

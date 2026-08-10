"use client";

import { ensureAnonymousSession } from "@/modules/auth/client";
import { supabase } from "@/lib/supabase/client";
import { extractExifMetadata } from "@/modules/images/exif";
import {
  createSignedImageUrl,
  persistImageWithMetadata,
  resolveImageUploadContext,
  type ImageUploadContext,
} from "@/modules/images/client";
import { IMAGE_STORAGE_BUCKET } from "@/modules/images/persistence";
import type { Database } from "@/types/supabase";
import { aggregateFourViewMetrics, dataUrlToBlob } from "./metrics";
import type { CornerPoint, Direction, FrameClassification, VisionViewResult } from "./types";

export const FOUR_VIEW_ALGORITHM_VERSION = "four-view-0.2.1";
export const FOUR_VIEW_TEMPLATE_VERSION = "LICHENDR-FRAME-0.2";

export type CaptureSeriesRow = Database["public"]["Tables"]["capture_series"]["Row"];
export type CaptureViewRow = Database["public"]["Tables"]["capture_views"]["Row"];

async function ensureSession(): Promise<void> {
  const result = await ensureAnonymousSession();
  if (result.error || !result.session) throw new Error(result.error ?? "No se pudo validar la sesión.");
}

export async function ensureTreeSampleForTree(siteId: string, eventId: string, treeId: string): Promise<string> {
  await ensureSession();
  const existing = await supabase
    .from("tree_samples")
    .select("id")
    .eq("sampling_event_id", eventId)
    .eq("tree_id", treeId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;
  const inserted = await supabase
    .from("tree_samples")
    .insert({
      site_id: siteId,
      sampling_event_id: eventId,
      tree_id: treeId,
      substrate_type: "tree_bark",
      trunk_orientation: "multiple",
      sampling_height_m: 1,
      confidence_level: "high",
    })
    .select("id")
    .single();
  if (!inserted.error && inserted.data) return inserted.data.id;
  const raced = await supabase
    .from("tree_samples")
    .select("id")
    .eq("sampling_event_id", eventId)
    .eq("tree_id", treeId)
    .single();
  if (raced.error || !raced.data) throw inserted.error ?? raced.error ?? new Error("No se pudo crear la muestra del árbol.");
  return raced.data.id;
}

export async function getOrCreateCaptureSeries(treeSampleId: string): Promise<CaptureSeriesRow> {
  await ensureSession();
  const { data, error } = await supabase.rpc("get_or_create_capture_series", {
    p_tree_sample_id: treeSampleId,
    p_algorithm_version: FOUR_VIEW_ALGORITHM_VERSION,
    p_request_key: crypto.randomUUID(),
    p_template_version: FOUR_VIEW_TEMPLATE_VERSION,
  });
  if (error || !data) throw error ?? new Error("No se pudo abrir la serie fotográfica.");
  return data;
}

export async function analyzeFourViewFile(
  file: File,
  action: "detect" | "confirm_corners" | "analyze_confirmed" = "detect",
  corners?: readonly CornerPoint[],
): Promise<VisionViewResult> {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("action", action);
  if (corners) formData.append("corners", JSON.stringify(corners));
  const response = await fetch("/api/vision/analyze-view", { method: "POST", body: formData });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
    const message = error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : typeof error === "string" ? error : "No se pudo procesar la vista.";
    throw new Error(message);
  }
  return body as VisionViewResult;
}

function traceableSource(result: VisionViewResult): string {
  const detection = result.frame_detection;
  const markers = detection.detected_marker_ids.join(",");
  const variant = detection.successful_variant ?? "none";
  return `${result.source};method=${detection.method};markers=${markers};variant=${variant}`;
}

function storedClassification(source: string): FrameClassification {
  const classification = /mobile_sam_cielab:(validated|assisted|manual_assisted)/.exec(source)?.[1];
  return classification === "assisted" || classification === "manual_assisted" ? classification : "validated";
}

async function removeOriginal(imageId: string, storagePath: string): Promise<void> {
  await Promise.allSettled([
    supabase.from("images").delete().eq("id", imageId),
    supabase.storage.from(IMAGE_STORAGE_BUCKET).remove([storagePath]),
  ]);
}

async function uploadDerived(path: string, blob: Blob): Promise<void> {
  const { error } = await supabase.storage.from(IMAGE_STORAGE_BUCKET).upload(path, blob, {
    contentType: blob.type,
    upsert: false,
  });
  if (error) throw error;
}

async function persistAutomaticAnnotations(
  view: CaptureViewRow,
  result: VisionViewResult,
  maskPath: string,
): Promise<string> {
  const metrics = result.metrics;
  if (!metrics) throw new Error("La vista no contiene métricas.");
  const { data: annotationSet, error: setError } = await supabase
    .from("annotation_sets")
    .insert({
      image_id: view.image_id,
      method: "ai_assisted_segmentation",
      status: "provisional_ai",
      version: 1,
      grid_rows: 5,
      grid_columns: 2,
      notes: "Propuesta automática provisional; MobileSAM no identifica especies.",
    })
    .select("id")
    .single();
  if (setError || !annotationSet) throw setError ?? new Error("No se pudo crear la anotación provisional.");
  try {
    const morphotypeCodes = Object.keys(metrics.morphotype_coverage);
    if (morphotypeCodes.length) {
      const { error } = await supabase.from("morphotypes").insert(morphotypeCodes.map((label) => ({
        annotation_set_id: annotationSet.id,
        label,
        growth_form: "unknown",
        notes: "Morfotipo visual provisional; no equivale a una especie.",
      })));
      if (error) throw error;
    }
    const unionPixels = Math.round(metrics.lichen_union_area_cm2 / 500 * 800_000);
    if (unionPixels > 0) {
      const confidenceValues = metrics.candidates
        .filter((candidate) => candidate.classification === "possible_lichen")
        .map((candidate) => candidate.confidence);
      const confidence = confidenceValues.length
        ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
        : null;
      const { error } = await supabase.from("annotation_regions").insert({
        annotation_set_id: annotationSet.id,
        classification: "lichen",
        source: "automatic_four_view",
        model_name: result.model_name,
        model_version: null,
        confidence,
        algorithm_version: result.algorithm_version,
        template_version: result.template_version,
        quality_flags: result.quality_flags,
        mask_bucket: IMAGE_STORAGE_BUCKET,
        mask_path: maskPath,
        mask_width_px: 400,
        mask_height_px: 2000,
        area_pixels: unionPixels,
        score: confidence,
        status: "accepted",
        notes: "Unión automática provisional de posibles líquenes.",
      });
      if (error) throw error;
    }
    const { error: metricError } = await supabase.from("annotation_metrics").insert({
      annotation_set_id: annotationSet.id,
      trunk_area_pixels: 800_000,
      lichen_union_area_pixels: unionPixels,
      lichen_outside_trunk_pixels: 0,
      overlapping_lichen_pixels: 0,
      coverage_percent: metrics.lichen_coverage_percent,
      accepted_region_count: unionPixels > 0 ? 1 : 0,
      lichen_region_count: unionPixels > 0 ? 1 : 0,
      morphotype_count: unionPixels > 0 ? morphotypeCodes.length : 0,
      calculation_method: "rectified_mask_union",
      calculation_version: result.algorithm_version,
      quality_flags: result.quality_flags,
      calculated_at: new Date().toISOString(),
    });
    if (metricError) throw metricError;
    return annotationSet.id;
  } catch (error) {
    await supabase.from("annotation_sets").delete().eq("id", annotationSet.id);
    throw error;
  }
}

export async function saveProcessedView(input: {
  file: File;
  direction: Direction;
  result: VisionViewResult;
  series: CaptureSeriesRow;
  requestKey: string;
  context: Omit<ImageUploadContext, "userId" | "treeId">;
}): Promise<CaptureViewRow> {
  const uploadContext = await resolveImageUploadContext(input.context);
  const metadata = await extractExifMetadata(input.file);
  const image = await persistImageWithMetadata(
    input.file,
    uploadContext,
    metadata,
    `Vista ${input.direction} · ${FOUR_VIEW_TEMPLATE_VERSION}`,
    ["N", "E", "S", "W"].indexOf(input.direction) + 1,
  );
  let view: CaptureViewRow;
  try {
    const registration = await supabase.rpc("register_capture_view", {
      p_series_id: input.series.id,
      p_image_id: image.id,
      p_direction: input.direction,
      p_algorithm_version: FOUR_VIEW_ALGORITHM_VERSION,
      p_request_key: input.requestKey,
    });
    if (registration.error || !registration.data) {
      const recovered = await supabase
        .from("capture_views")
        .select("*")
        .eq("request_key", input.requestKey)
        .maybeSingle();
      if (recovered.error || !recovered.data) throw registration.error ?? recovered.error ?? new Error("No se pudo registrar la vista.");
      view = recovered.data;
    } else {
      view = registration.data;
    }
    if (view.image_id !== image.id) await removeOriginal(image.id, image.storage_path);
  } catch (error) {
    await removeOriginal(image.id, image.storage_path);
    throw error;
  }
  if (view.processing_status === "provisional_ai" || view.processing_status === "confirmed") return view;

  if (!input.result.metrics) {
    const { data, error } = await supabase
      .from("capture_views")
      .update({
        processing_status: "repeat_photo",
        source: traceableSource(input.result),
        reprojection_error_px: input.result.reprojection_error_px,
        quality_score: input.result.quality_score,
        quality_flags: input.result.quality_flags,
        confidence: input.result.frame_detection.confidence,
        processed_at: new Date().toISOString(),
      })
      .eq("id", view.id)
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("No se pudo guardar el rechazo de calidad.");
    return data;
  }

  const root = `${uploadContext.userId}/four-view/${input.series.id}/${view.id}`;
  const rectifiedPath = `${root}/rectified.jpg`;
  const unionPath = `${root}/lichen-union.png`;
  const uploaded: string[] = [];
  let annotationSetId: string | null = null;
  try {
    if (!input.result.rectified_image_data_url) {
      throw new Error("La vista confirmada no contiene una rectificación.");
    }
    await uploadDerived(rectifiedPath, dataUrlToBlob(input.result.rectified_image_data_url));
    uploaded.push(rectifiedPath);
    await uploadDerived(unionPath, dataUrlToBlob(input.result.metrics.lichen_union_mask_data_url));
    uploaded.push(unionPath);
    annotationSetId = await persistAutomaticAnnotations(view, input.result, unionPath);
    const confidenceValues = input.result.metrics.candidates.map((candidate) => candidate.confidence);
    const confidence = confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : null;
    const { data, error } = await supabase
      .from("capture_views")
      .update({
        annotation_set_id: annotationSetId,
        processing_status: "provisional_ai",
        source: traceableSource(input.result),
        rectified_storage_path: rectifiedPath,
        union_mask_storage_path: unionPath,
        valid_area_cm2: input.result.metrics.valid_area_cm2,
        lichen_union_area_cm2: input.result.metrics.lichen_union_area_cm2,
        lichen_coverage_percent: input.result.metrics.lichen_coverage_percent,
        component_count: input.result.metrics.component_count,
        occupied_cells: input.result.metrics.occupied_cells,
        provisional_morphotype_richness: input.result.metrics.provisional_morphotype_richness,
        morphotype_coverage: input.result.metrics.morphotype_coverage,
        reprojection_error_px: input.result.reprojection_error_px,
        quality_score: input.result.quality_score,
        quality_flags: input.result.quality_flags,
        confidence: input.result.frame_detection.confidence ?? confidence,
        processed_at: new Date().toISOString(),
      })
      .eq("id", view.id)
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("No se pudieron guardar las métricas.");
    return data;
  } catch (error) {
    if (annotationSetId) await supabase.from("annotation_sets").delete().eq("id", annotationSetId);
    if (uploaded.length) await supabase.storage.from(IMAGE_STORAGE_BUCKET).remove(uploaded);
    await supabase.from("capture_views").update({ processing_status: "failed" }).eq("id", view.id);
    throw error;
  }
}

export async function finalizeSeries(
  seriesId: string,
  results: readonly (VisionViewResult | null)[],
): Promise<CaptureSeriesRow> {
  const summary = aggregateFourViewMetrics(results);
  const { data, error } = await supabase
    .from("capture_series")
    .update({
      status: summary.validViews === 4 ? "provisional_ai" : "needs_retake",
      review_status: "pending",
      total_valid_area_cm2: summary.totalValidAreaCm2,
      total_lichen_area_cm2: summary.totalLichenAreaCm2,
      tree_lichen_coverage_percent: summary.coveragePercent,
      occupied_cells: summary.occupiedCells,
      provisional_morphotype_richness: summary.morphotypeRichness,
      valid_view_count: summary.validViews,
      pending_view_count: summary.pendingViews,
      calculated_at: new Date().toISOString(),
    })
    .eq("id", seriesId)
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("No se pudo guardar el resumen del árbol.");
  return data;
}

export async function confirmSeries(seriesId: string): Promise<void> {
  const { error } = await supabase.rpc("confirm_capture_series", { p_series_id: seriesId });
  if (error) throw error;
}

export async function signedDerivedUrl(path: string | null): Promise<string | null> {
  return path ? createSignedImageUrl(path) : null;
}

export async function loadSeriesResults(seriesId: string): Promise<Partial<Record<Direction, VisionViewResult>>> {
  const { data: views, error } = await supabase
    .from("capture_views")
    .select("*")
    .eq("capture_series_id", seriesId)
    .eq("active", true);
  if (error) throw error;
  const entries = await Promise.all((views ?? []).map(async (view) => {
    const [rectifiedUrl, maskUrl] = await Promise.all([
      signedDerivedUrl(view.rectified_storage_path),
      signedDerivedUrl(view.union_mask_storage_path),
    ]);
    const hasMetrics = view.valid_area_cm2 !== null && view.lichen_union_area_cm2 !== null && view.lichen_coverage_percent !== null;
    const result: VisionViewResult = {
      template_version: view.template_version,
      algorithm_version: view.algorithm_version,
      canonical_width: 400,
      canonical_height: 2000,
      pixels_per_cm: 40,
      reprojection_error_px: view.reprojection_error_px,
      quality_flags: view.quality_flags.filter((flag): flag is string => typeof flag === "string"),
      quality_score: view.quality_score ?? 0,
      critical_errors: view.processing_status === "repeat_photo"
        ? view.quality_flags.filter((flag): flag is string => typeof flag === "string")
        : [],
      status: hasMetrics ? "provisional_ai" : "repeat_photo",
      rectified_image_data_url: rectifiedUrl,
      model_name: view.model_name,
      source: view.source,
      frame_detection: {
        classification: storedClassification(view.source),
        method: /;method=([^;]+)/.exec(view.source)?.[1] ?? "stored_result",
        confidence: view.confidence ?? 0,
        detected_marker_ids: (/;markers=([^;]*)/.exec(view.source)?.[1] ?? "")
          .split(",")
          .filter(Boolean)
          .map(Number)
          .filter(Number.isInteger),
        missing_marker_ids: [],
        rejected_candidate_count: 0,
        successful_resolution: null,
        successful_variant: /;variant=([^;]+)/.exec(view.source)?.[1] ?? null,
        reprojection_error_px: view.reprojection_error_px,
        rejection_reason: null,
        proposal_source: null,
        assisted_eligible: false,
        user_confirmed: storedClassification(view.source) !== "validated",
        source_width: 0,
        source_height: 0,
      },
      corner_proposal: null,
      source_width: 0,
      source_height: 0,
      metrics: hasMetrics ? {
        valid_area_cm2: view.valid_area_cm2 ?? 0,
        lichen_union_area_cm2: view.lichen_union_area_cm2 ?? 0,
        lichen_coverage_percent: view.lichen_coverage_percent ?? 0,
        component_count: view.component_count ?? 0,
        occupied_cells: view.occupied_cells ?? 0,
        provisional_morphotype_richness: view.provisional_morphotype_richness ?? 0,
        morphotype_coverage: view.morphotype_coverage,
        quality_score: view.quality_score ?? 0,
        quality_flags: view.quality_flags.filter((flag): flag is string => typeof flag === "string"),
        candidates: [],
        lichen_union_mask_data_url: maskUrl ?? "",
      } : null,
    };
    return [view.direction, result] as const;
  }));
  return Object.fromEntries(entries) as Partial<Record<Direction, VisionViewResult>>;
}

export interface EvaluatedTreeRow {
  series: CaptureSeriesRow;
  projectId: string;
  siteId: string;
  eventId: string;
  treeId: string;
  project: string;
  site: string;
  event: string;
  tree: string;
}

export async function listEvaluatedTrees(): Promise<EvaluatedTreeRow[]> {
  await ensureSession();
  const { data: series, error } = await supabase
    .from("capture_series")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!series?.length) return [];
  const { data: samples } = await supabase.from("tree_samples").select("id, tree_id, site_id, sampling_event_id").in("id", series.map((item) => item.tree_sample_id));
  const { data: trees } = await supabase.from("trees").select("id, code").in("id", (samples ?? []).map((item) => item.tree_id));
  const { data: sites } = await supabase.from("sites").select("id, name, project_id").in("id", (samples ?? []).map((item) => item.site_id));
  const { data: events } = await supabase.from("sampling_events").select("id, name").in("id", (samples ?? []).map((item) => item.sampling_event_id));
  const { data: projects } = await supabase.from("projects").select("id, name").in("id", (sites ?? []).map((item) => item.project_id));
  const sampleMap = new Map((samples ?? []).map((item) => [item.id, item]));
  const treeMap = new Map((trees ?? []).map((item) => [item.id, item.code]));
  const siteMap = new Map((sites ?? []).map((item) => [item.id, item]));
  const eventMap = new Map((events ?? []).map((item) => [item.id, item.name]));
  const projectMap = new Map((projects ?? []).map((item) => [item.id, item.name]));
  return series.flatMap((item) => {
    const sample = sampleMap.get(item.tree_sample_id);
    const site = sample ? siteMap.get(sample.site_id) : null;
    if (!sample || !site) return [];
    return [{
      series: item,
      projectId: site.project_id,
      siteId: sample.site_id,
      eventId: sample.sampling_event_id,
      treeId: sample.tree_id,
      project: projectMap.get(site.project_id) ?? "Proyecto",
      site: site.name,
      event: eventMap.get(sample.sampling_event_id) ?? "Jornada",
      tree: treeMap.get(sample.tree_id) ?? "Árbol",
    }];
  });
}

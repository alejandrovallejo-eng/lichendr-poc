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
import { maskToPngBlob } from "@/modules/annotations/studio-browser-utils";
import { saveAcceptedRegion } from "@/modules/annotations/regions";
import type { Database } from "@/types/supabase";
import { dataUrlToBlob } from "./metrics";
import { fieldTapeDiameter, summarizeCalibration } from "./science";
import { orderFourViewTargets } from "./navigation";
import { hasProvisionalGeometry, storedFrameClassification } from "./assistance";
import type { CombinedTrunkEstimate, CornerPoint, Direction, TrunkViewEstimate, VisionViewResult } from "./types";
import type { ManualMeasurementMode } from "./manual-flow";
import { readStoredAnalysisResponse, storedAnalysisRequest } from "./stored-analysis";

export const FOUR_VIEW_ALGORITHM_VERSION = "four-view-0.2.2";
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

export async function analyzeStoredFourViewImage(
  imageId: string,
  action: "detect" | "confirm_corners" | "analyze_confirmed" = "detect",
  corners?: readonly CornerPoint[],
  manualMode: ManualMeasurementMode = "manual_confirmed",
): Promise<VisionViewResult> {
  const request = storedAnalysisRequest(imageId, action, corners, manualMode);
  let response: Response;
  try {
    response = await fetch("/api/vision/analyze-view", { method: "POST", ...request });
  } catch {
    throw new Error(
      "La fotografía quedó guardada, pero no fue posible iniciar la IA. Comprueba la conexión y vuelve a intentarlo.",
    );
  }
  return readStoredAnalysisResponse(response);
}

function traceableSource(result: VisionViewResult): string {
  const detection = result.frame_detection;
  const markers = detection.detected_marker_ids.join(",");
  const variant = detection.successful_variant ?? "none";
  const corners = result.corner_proposal
    ?.map((point) => `${point.x.toFixed(7)},${point.y.toFixed(7)}`)
    .join("|") ?? "none";
  return `${result.source};method=${detection.method};markers=${markers};variant=${variant};size=${result.source_width}x${result.source_height};autoConfidence=${detection.confidence.toFixed(4)};corners=${corners}`;
}

function storedCorners(source: string): CornerPoint[] | null {
  const encoded = /;corners=([^;]+)/.exec(source)?.[1];
  if (!encoded || encoded === "none") return null;
  const corners = encoded.split("|").map((point) => {
    const [x, y] = point.split(",").map(Number);
    return { x, y };
  });
  return corners.length === 4 && corners.every(({ x, y }) => (
    Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1
  )) ? corners : null;
}

function storedSourceSize(source: string): { width: number; height: number } {
  const match = /;size=(\d+)x(\d+)/.exec(source);
  return {
    width: match ? Number(match[1]) : 0,
    height: match ? Number(match[2]) : 0,
  };
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

export async function stageCaptureView(input: {
  file: File;
  direction: Direction;
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
  return view;
}

export async function saveProcessedView(input: {
  view: CaptureViewRow;
  result: VisionViewResult;
  series: CaptureSeriesRow;
  context: Omit<ImageUploadContext, "userId" | "treeId">;
}): Promise<CaptureViewRow> {
  const uploadContext = await resolveImageUploadContext(input.context);
  const view = input.view;
  if (["calibrated", "annotation_pending", "annotation_in_progress", "annotation_completed"].includes(view.processing_status)) return view;

  if (!input.result.rectified_image_data_url || input.result.critical_errors.length > 0) {
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
  const uploaded: string[] = [];
  let annotationSetId: string | null = null;
  try {
    await uploadDerived(rectifiedPath, dataUrlToBlob(input.result.rectified_image_data_url));
    uploaded.push(rectifiedPath);
    const calibrationMethod = input.result.frame_detection.classification === "manual_assisted_provisional"
      ? "manual_provisional"
      : input.result.frame_detection.user_confirmed ? "manual_confirmed" : "automatic";
    const trunk = input.result.trunk_estimate;
    const { data, error } = await supabase
      .from("capture_views")
      .update({
        processing_status: "calibrated",
        source: traceableSource(input.result),
        rectified_storage_path: rectifiedPath,
        union_mask_storage_path: null,
        rectified_width_px: input.result.canonical_width,
        rectified_height_px: input.result.canonical_height,
        valid_pixel_count: input.result.canonical_width * input.result.canonical_height,
        cm2_per_pixel: 500 / (input.result.canonical_width * input.result.canonical_height),
        pixels_per_cm: input.result.pixels_per_cm,
        calibration_method: calibrationMethod,
        confirmed_corners: input.result.corner_proposal,
        valid_area_cm2: 500,
        lichen_union_area_cm2: null,
        lichen_coverage_percent: null,
        component_count: null,
        occupied_cells: null,
        provisional_morphotype_richness: null,
        morphotype_coverage: {},
        reprojection_error_px: input.result.reprojection_error_px,
        quality_score: input.result.quality_score,
        quality_flags: input.result.quality_flags,
        confidence: input.result.frame_detection.confidence,
        trunk_width_cm: trunk?.width_cm ?? null,
        trunk_width_min_cm: trunk?.min_cm ?? null,
        trunk_width_max_cm: trunk?.max_cm ?? null,
        trunk_left_x_normalized: trunk?.left_x_normalized ?? null,
        trunk_right_x_normalized: trunk?.right_x_normalized ?? null,
        trunk_scale_cm_per_pixel: trunk?.scale_cm_per_pixel ?? null,
        trunk_estimation_method: trunk?.method ?? null,
        trunk_confidence: trunk?.confidence ?? null,
        trunk_quality_flags: trunk?.quality_flags ?? [],
        processed_at: new Date().toISOString(),
      })
      .eq("id", view.id)
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("No se pudo guardar la calibración.");
    const { data: annotationSet, error: annotationError } = await supabase
      .from("annotation_sets")
      .insert({
        image_id: view.image_id,
        capture_view_id: view.id,
        target_storage_path: rectifiedPath,
        target_width_px: input.result.canonical_width,
        target_height_px: input.result.canonical_height,
        method: "ai_assisted_segmentation",
        status: "draft",
        version: 1,
        grid_rows: 5,
        grid_columns: 2,
        roi_x: 0,
        roi_y: 0,
        roi_width: 1,
        roi_height: 1,
        notes: "Anotación de la abertura rectificada; los morfotipos visuales no equivalen a especies.",
      })
      .select("id")
      .single();
    if (annotationError || !annotationSet) throw annotationError ?? new Error("No se pudo crear el target de anotación.");
    annotationSetId = annotationSet.id;
    const validMask = new Uint8Array(input.result.canonical_width * input.result.canonical_height);
    validMask.fill(1);
    await saveAcceptedRegion({
      id: crypto.randomUUID(),
      annotationSetId,
      classification: "bark",
      morphotypeId: null,
      mask: await maskToPngBlob(validMask, input.result.canonical_width, input.result.canonical_height),
      width: input.result.canonical_width,
      height: input.result.canonical_height,
      areaPixels: validMask.length,
      score: 1,
      positivePoints: [],
      negativePoints: [],
      modelName: "LICHENDR physical frame opening",
      modelVersion: input.result.template_version,
      notes: "Área válida completa de la abertura rectificada de 10 × 50 cm.",
      source: "manual",
      regionRole: "trunk",
    });
    const { data: linked, error: linkError } = await supabase
      .from("capture_views")
      .update({ annotation_set_id: annotationSetId, processing_status: "annotation_pending" })
      .eq("id", view.id)
      .select("*")
      .single();
    if (linkError || !linked) throw linkError ?? new Error("No se pudo vincular la anotación.");
    return linked;
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
  const summary = summarizeCalibration(results);
  const { data, error } = await supabase
    .from("capture_series")
    .update({
      status: summary.calibrated ? "capture_calibrated" : "capture_draft",
      review_status: "pending",
      total_valid_area_cm2: summary.totalCalibratedAreaCm2,
      total_lichen_area_cm2: null,
      tree_lichen_coverage_percent: null,
      occupied_cells: null,
      provisional_morphotype_richness: null,
      valid_view_count: summary.validViews,
      pending_view_count: summary.pendingViews,
      calculated_at: null,
    })
    .eq("id", seriesId)
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("No se pudo guardar el resumen del árbol.");
  return data;
}

export async function saveTrunkMeasurement(
  seriesId: string,
  fieldCircumferenceCm: number | null,
  estimate: CombinedTrunkEstimate | null,
  viewEstimates: Partial<Record<Direction, TrunkViewEstimate | null>>,
): Promise<CaptureSeriesRow> {
  await Promise.all(Object.entries(viewEstimates).map(async ([direction, viewEstimate]) => {
    if (!viewEstimate) return;
    const { error } = await supabase
      .from("capture_views")
      .update({
        trunk_width_cm: viewEstimate.width_cm,
        trunk_width_min_cm: viewEstimate.min_cm,
        trunk_width_max_cm: viewEstimate.max_cm,
        trunk_left_x_normalized: viewEstimate.left_x_normalized,
        trunk_right_x_normalized: viewEstimate.right_x_normalized,
        trunk_scale_cm_per_pixel: viewEstimate.scale_cm_per_pixel,
        trunk_estimation_method: viewEstimate.method,
        trunk_confidence: viewEstimate.confidence,
        trunk_quality_flags: viewEstimate.quality_flags,
      })
      .eq("capture_series_id", seriesId)
      .eq("direction", direction as Direction)
      .eq("active", true);
    if (error) throw error;
  }));
  const fieldDiameterCm = fieldTapeDiameter(fieldCircumferenceCm);
  const { data, error } = await supabase
    .from("capture_series")
    .update({
      field_circumference_cm: fieldCircumferenceCm,
      circumference_cm: fieldCircumferenceCm,
      field_diameter_cm: fieldDiameterCm,
      field_measurement_height_m: fieldCircumferenceCm ? 1.3 : null,
      trunk_estimated_width_cm: estimate?.widthCm ?? null,
      trunk_estimated_circumference_cm: estimate?.circumferenceCm ?? null,
      trunk_estimate_min_cm: estimate?.minCm ?? null,
      trunk_estimate_max_cm: estimate?.maxCm ?? null,
      trunk_confidence: estimate?.confidence ?? null,
      trunk_views_used: estimate?.viewsUsed ?? [],
      trunk_geometric_assumption: estimate?.geometricAssumption ?? null,
      trunk_measurement_method: fieldCircumferenceCm
        ? "field_tape"
        : estimate ? "frame_assisted_ai_estimate" : null,
      trunk_algorithm_version: estimate ? "trunk-frame-1.0.0" : null,
      trunk_quality_flags: estimate?.qualityFlags ?? [],
      status: "annotation_pending",
    })
    .eq("id", seriesId)
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("No se pudo guardar el tamaño del tronco.");
  return data;
}

export interface CaptureAnnotationTarget {
  viewId: string;
  imageId: string;
  annotationSetId: string;
  direction: Direction;
  status: CaptureViewRow["processing_status"];
}

export async function loadCaptureAnnotationSequence(seriesId: string): Promise<CaptureAnnotationTarget[]> {
  await ensureSession();
  const { data, error } = await supabase
    .from("capture_views")
    .select("id, image_id, annotation_set_id, direction, processing_status")
    .eq("capture_series_id", seriesId)
    .eq("active", true);
  if (error) throw error;
  return orderFourViewTargets(data ?? []).map((view) => ({
      viewId: view.id,
      imageId: view.image_id,
      annotationSetId: view.annotation_set_id!,
      direction: view.direction,
      status: view.processing_status,
  }));
}

export async function refreshSeriesMetrics(seriesId: string): Promise<CaptureSeriesRow> {
  const { data, error } = await supabase.rpc("refresh_capture_series_metrics", { p_series_id: seriesId });
  if (error || !data) throw error ?? new Error("No se pudieron actualizar los resultados del árbol.");
  return data;
}

export async function loadTreeResults(seriesId: string): Promise<{
  series: CaptureSeriesRow;
  views: CaptureViewRow[];
}> {
  const series = await refreshSeriesMetrics(seriesId);
  const { data, error } = await supabase
    .from("capture_views")
    .select("*")
    .eq("capture_series_id", seriesId)
    .eq("active", true);
  if (error) throw error;
  const order = new Map<Direction, number>([["N", 0], ["E", 1], ["S", 2], ["W", 3]]);
  return {
    series,
    views: (data ?? []).sort((left, right) => (
      (order.get(left.direction) ?? 9) - (order.get(right.direction) ?? 9)
    )),
  };
}

export async function confirmSeries(seriesId: string): Promise<void> {
  const { data: views, error: viewsError } = await supabase
    .from("capture_views")
    .select("source")
    .eq("capture_series_id", seriesId)
    .eq("active", true);
  if (viewsError) throw viewsError;
  const provisional = hasProvisionalGeometry((views ?? []).map((view) => view.source));
  const { error } = await supabase.rpc("confirm_capture_series", { p_series_id: seriesId });
  if (error) throw error;
  if (provisional) return;
}

export async function signedDerivedUrl(path: string | null): Promise<string | null> {
  return path ? createSignedImageUrl(path) : null;
}

export async function loadSeriesViews(seriesId: string): Promise<CaptureViewRow[]> {
  const { data: views, error } = await supabase
    .from("capture_views")
    .select("*")
    .eq("capture_series_id", seriesId)
    .eq("active", true);
  if (error) throw error;
  return views ?? [];
}

export async function loadStoredImageFile(imageId: string): Promise<File> {
  const { data: image, error } = await supabase
    .from("images")
    .select("storage_bucket, storage_path, original_filename, mime_type")
    .eq("id", imageId)
    .single();
  if (error || !image) throw error ?? new Error("No se pudo recuperar la fotografía guardada.");
  const { data: blob, error: downloadError } = await supabase.storage
    .from(image.storage_bucket)
    .download(image.storage_path);
  if (downloadError || !blob) throw downloadError ?? new Error("No se pudo recuperar la fotografía guardada.");
  return new File([blob], image.original_filename, { type: image.mime_type });
}

export async function loadSeriesResults(seriesId: string): Promise<Partial<Record<Direction, VisionViewResult>>> {
  const views = await loadSeriesViews(seriesId);
  const processedViews = views.filter((view) => (
    view.processed_at !== null
    || view.processing_status === "calibrated"
    || view.processing_status.startsWith("annotation_")
    || view.processing_status === "repeat_photo"
  ));
  const entries = await Promise.all(processedViews.map(async (view) => {
    const [rectifiedUrl, maskUrl] = await Promise.all([
      signedDerivedUrl(view.rectified_storage_path),
      signedDerivedUrl(view.union_mask_storage_path),
    ]);
    const hasMetrics = view.valid_area_cm2 !== null && view.lichen_union_area_cm2 !== null && view.lichen_coverage_percent !== null;
    const sourceSize = storedSourceSize(view.source);
    const result: VisionViewResult = {
      template_version: view.template_version,
      algorithm_version: view.algorithm_version,
      canonical_width: view.rectified_width_px ?? 400,
      canonical_height: view.rectified_height_px ?? 2000,
      pixels_per_cm: view.pixels_per_cm ?? 40,
      reprojection_error_px: view.reprojection_error_px,
      quality_flags: view.quality_flags.filter((flag): flag is string => typeof flag === "string"),
      quality_score: view.quality_score ?? 0,
      critical_errors: view.processing_status === "repeat_photo"
        ? view.quality_flags.filter((flag): flag is string => typeof flag === "string")
        : [],
      status: rectifiedUrl ? "rectification_review" : "repeat_photo",
      rectified_image_data_url: rectifiedUrl,
      model_name: view.model_name,
      source: view.source,
      frame_detection: {
        classification: storedFrameClassification(view.source),
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
        user_confirmed: storedFrameClassification(view.source) !== "validated",
        source_width: sourceSize.width,
        source_height: sourceSize.height,
      },
      corner_proposal: storedCorners(view.source),
      source_width: sourceSize.width,
      source_height: sourceSize.height,
      trunk_estimate: view.trunk_width_cm !== null
        && view.trunk_width_min_cm !== null
        && view.trunk_width_max_cm !== null
        && view.trunk_left_x_normalized !== null
        && view.trunk_right_x_normalized !== null
        && view.trunk_scale_cm_per_pixel !== null
        && view.trunk_confidence !== null
        && view.trunk_estimation_method !== null
        ? {
            width_cm: view.trunk_width_cm,
            min_cm: view.trunk_width_min_cm,
            max_cm: view.trunk_width_max_cm,
            left_x_normalized: view.trunk_left_x_normalized,
            right_x_normalized: view.trunk_right_x_normalized,
            scale_cm_per_pixel: view.trunk_scale_cm_per_pixel,
            confidence: view.trunk_confidence,
            method: view.trunk_estimation_method,
            quality_flags: view.trunk_quality_flags.filter((flag): flag is string => typeof flag === "string"),
          }
        : null,
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
  provisional: boolean;
}

export async function listEvaluatedTrees(): Promise<EvaluatedTreeRow[]> {
  await ensureSession();
  const { data: series, error } = await supabase
    .from("capture_series")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!series?.length) return [];
  const [{ data: samples }, { data: views, error: viewsError }] = await Promise.all([
    supabase.from("tree_samples").select("id, tree_id, site_id, sampling_event_id").in("id", series.map((item) => item.tree_sample_id)),
    supabase.from("capture_views").select("capture_series_id, source").in("capture_series_id", series.map((item) => item.id)).eq("active", true),
  ]);
  if (viewsError) throw viewsError;
  const { data: trees } = await supabase.from("trees").select("id, code").in("id", (samples ?? []).map((item) => item.tree_id));
  const { data: sites } = await supabase.from("sites").select("id, name, project_id").in("id", (samples ?? []).map((item) => item.site_id));
  const { data: events } = await supabase.from("sampling_events").select("id, name").in("id", (samples ?? []).map((item) => item.sampling_event_id));
  const { data: projects } = await supabase.from("projects").select("id, name").in("id", (sites ?? []).map((item) => item.project_id));
  const sampleMap = new Map((samples ?? []).map((item) => [item.id, item]));
  const treeMap = new Map((trees ?? []).map((item) => [item.id, item.code]));
  const siteMap = new Map((sites ?? []).map((item) => [item.id, item]));
  const eventMap = new Map((events ?? []).map((item) => [item.id, item.name]));
  const projectMap = new Map((projects ?? []).map((item) => [item.id, item.name]));
  const provisionalSeries = new Set((views ?? [])
    .filter((view) => storedFrameClassification(view.source) === "manual_assisted_provisional")
    .map((view) => view.capture_series_id));
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
      provisional: provisionalSeries.has(item.id),
    }];
  });
}

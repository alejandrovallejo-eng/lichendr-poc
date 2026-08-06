import { supabase } from "@/lib/supabase/client";
import { listAnalysisEvaluations } from "@/modules/analysis/client";
import { ensureAnonymousSession } from "@/modules/auth/client";
import type { Database } from "@/types/supabase";
import type { EnvironmentalEvaluation } from "./science";

export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
export type SiteRow = Database["public"]["Tables"]["sites"]["Row"];
export type SamplingEventRow = Database["public"]["Tables"]["sampling_events"]["Row"];
export type TreeRow = Database["public"]["Tables"]["trees"]["Row"];
export type TreeSampleRow = Database["public"]["Tables"]["tree_samples"]["Row"];
export type SiteContextRow = Database["public"]["Tables"]["site_environmental_contexts"]["Row"];
export type SampleContextRow = Database["public"]["Tables"]["tree_sample_scientific_contexts"]["Row"];
export type PollutantMeasurementRow = Database["public"]["Tables"]["pollutant_measurements"]["Row"];

export interface EnvironmentalDataset {
  projects: ProjectRow[];
  sites: SiteRow[];
  samplingEvents: SamplingEventRow[];
  trees: TreeRow[];
  treeSamples: TreeSampleRow[];
  siteContexts: SiteContextRow[];
  sampleContexts: SampleContextRow[];
  pollutants: PollutantMeasurementRow[];
  evaluations: EnvironmentalEvaluation[];
}

async function ensureSession(): Promise<void> {
  const result = await ensureAnonymousSession();
  if (result.error || !result.session) {
    throw new Error(result.error ?? "No se pudo obtener una sesión válida.");
  }
}

export async function loadEnvironmentalDataset(signal?: AbortSignal): Promise<EnvironmentalDataset> {
  await ensureSession();
  signal?.throwIfAborted();
  const abortSignal = signal ?? new AbortController().signal;
  const [
    evaluations,
    projectsResult,
    sitesResult,
    eventsResult,
    treesResult,
    samplesResult,
    siteContextsResult,
    sampleContextsResult,
    pollutantsResult,
    imagesResult,
    annotationSetsResult,
  ] = await Promise.all([
    listAnalysisEvaluations(signal),
    supabase.from("projects").select("*").order("created_at").abortSignal(abortSignal),
    supabase.from("sites").select("*").order("name").abortSignal(abortSignal),
    supabase.from("sampling_events").select("*").order("sampled_at", { ascending: false }).abortSignal(abortSignal),
    supabase.from("trees").select("*").order("code").abortSignal(abortSignal),
    supabase.from("tree_samples").select("*").order("created_at").abortSignal(abortSignal),
    supabase.from("site_environmental_contexts").select("*").abortSignal(abortSignal),
    supabase.from("tree_sample_scientific_contexts").select("*").abortSignal(abortSignal),
    supabase.from("pollutant_measurements").select("*").order("measured_at", { ascending: false }).abortSignal(abortSignal),
    supabase.from("images").select("id, tree_sample_id").abortSignal(abortSignal),
    supabase.from("annotation_sets").select("id, image_id, status, completed_at").abortSignal(abortSignal),
  ]);

  const results = [
    projectsResult,
    sitesResult,
    eventsResult,
    treesResult,
    samplesResult,
    siteContextsResult,
    sampleContextsResult,
    pollutantsResult,
    imagesResult,
    annotationSetsResult,
  ];
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw firstError;

  const completed: EnvironmentalEvaluation[] = evaluations.map((evaluation) => ({
    annotationSetId: evaluation.annotationSetId,
    imageId: evaluation.imageId,
    status: "completed",
    completedAt: evaluation.completedAt,
    siteId: evaluation.siteId,
    samplingEventId: evaluation.samplingEventId,
    treeId: evaluation.treeId,
    treeSampleId: evaluation.treeSampleId,
    metrics: evaluation.metrics,
    morphotypeLabels: evaluation.morphotypes.map((item) => item.label),
  }));

  const imageById = new Map((imagesResult.data ?? []).map((image) => [image.id, image]));
  const sampleById = new Map((samplesResult.data ?? []).map((sample) => [sample.id, sample]));
  const completedIds = new Set(completed.map((item) => item.annotationSetId));
  const excluded: EnvironmentalEvaluation[] = (annotationSetsResult.data ?? []).flatMap((annotationSet) => {
    if (completedIds.has(annotationSet.id)) return [];
    const image = imageById.get(annotationSet.image_id);
    const sample = image ? sampleById.get(image.tree_sample_id) : null;
    if (!image || !sample) return [];
    return [{
      annotationSetId: annotationSet.id,
      imageId: image.id,
      status: annotationSet.status,
      completedAt: annotationSet.completed_at,
      siteId: sample.site_id,
      samplingEventId: sample.sampling_event_id,
      treeId: sample.tree_id,
      treeSampleId: sample.id,
      metrics: null,
      morphotypeLabels: [],
    }];
  });

  return {
    projects: projectsResult.data ?? [],
    sites: sitesResult.data ?? [],
    samplingEvents: eventsResult.data ?? [],
    trees: treesResult.data ?? [],
    treeSamples: samplesResult.data ?? [],
    siteContexts: siteContextsResult.data ?? [],
    sampleContexts: sampleContextsResult.data ?? [],
    pollutants: pollutantsResult.data ?? [],
    evaluations: [...completed, ...excluded],
  };
}

export interface SaveSamplingContextInput {
  treeSampleId: string;
  samplingHeightCm: number | null;
  trunkOrientation: string;
  notes: string | null;
  sampledWidthCm: number | null;
  sampledHeightCm: number | null;
  dbhCm: number | null;
  barkPh: number | null;
  barkTexture: string | null;
  canopyCoverPercent: number | null;
  airTemperatureC: number | null;
  relativeHumidityPercent: number | null;
  measuredAt: string | null;
  provenance: string | null;
}

export async function saveSamplingContext(input: SaveSamplingContextInput): Promise<void> {
  await ensureSession();
  const { error: sampleError } = await supabase
    .from("tree_samples")
    .update({
      sampling_height_m: input.samplingHeightCm == null ? null : input.samplingHeightCm / 100,
      trunk_orientation: input.trunkOrientation,
      notes: input.notes,
    })
    .eq("id", input.treeSampleId);
  if (sampleError) {
    throw new Error(`No se guardaron altura, orientación ni notas: ${sampleError.message}`);
  }

  const payload: Database["public"]["Tables"]["tree_sample_scientific_contexts"]["Insert"] = {
    tree_sample_id: input.treeSampleId,
    sampled_width_cm: input.sampledWidthCm,
    sampled_height_cm: input.sampledHeightCm,
    dbh_cm: input.dbhCm,
    bark_ph: input.barkPh,
    bark_texture: input.barkTexture,
    canopy_cover_percent: input.canopyCoverPercent,
    air_temperature_c: input.airTemperatureC,
    relative_humidity_percent: input.relativeHumidityPercent,
    measured_at: input.measuredAt,
    provenance: input.provenance,
  };
  const { error } = await supabase
    .from("tree_sample_scientific_contexts")
    .upsert(payload, { onConflict: "tree_sample_id" });
  if (error) {
    throw new Error(`Se guardaron altura, orientación y notas, pero no los datos científicos adicionales: ${error.message}`);
  }
}

export interface SaveSiteContextInput {
  siteId: string;
  samplingEventId: string;
  landUseClassification: string | null;
  isReferenceCandidate: boolean | null;
  measuredAt: string | null;
  provenance: string | null;
}

export async function saveSiteContext(input: SaveSiteContextInput): Promise<void> {
  await ensureSession();
  const payload: Database["public"]["Tables"]["site_environmental_contexts"]["Insert"] = {
    site_id: input.siteId,
    sampling_event_id: input.samplingEventId,
    land_use_classification: input.landUseClassification,
    is_reference_candidate: input.isReferenceCandidate,
    measured_at: input.measuredAt,
    provenance: input.provenance,
  };
  const { error } = await supabase
    .from("site_environmental_contexts")
    .upsert(payload, { onConflict: "sampling_event_id" });
  if (error) throw new Error(`El contexto de la muestra se guardó, pero no el contexto del sitio: ${error.message}`);
}

export type PollutantCode = PollutantMeasurementRow["pollutant_code"];
export type QaQcStatus = PollutantMeasurementRow["qa_qc_status"];

export interface CreatePollutantInput {
  siteId: string;
  samplingEventId: string | null;
  measuredAt: string;
  pollutantCode: PollutantCode;
  value: number;
  unit: string;
  averagingPeriod: string | null;
  instrumentMethod: string | null;
  dataSource: string;
  qaQcStatus: QaQcStatus;
  notes: string | null;
}

export async function createPollutantMeasurement(input: CreatePollutantInput): Promise<void> {
  await ensureSession();
  if (!input.unit.trim() || !input.dataSource.trim()) {
    throw new Error("La unidad y la fuente de datos no pueden quedar vacías.");
  }
  const payload: Database["public"]["Tables"]["pollutant_measurements"]["Insert"] = {
    site_id: input.siteId,
    sampling_event_id: input.samplingEventId,
    measured_at: input.measuredAt,
    pollutant_code: input.pollutantCode,
    value: input.value,
    unit: input.unit.trim(),
    averaging_period: input.averagingPeriod,
    instrument_method: input.instrumentMethod,
    data_source: input.dataSource.trim(),
    qa_qc_status: input.qaQcStatus,
    notes: input.notes,
  };
  const { error } = await supabase.from("pollutant_measurements").insert(payload);
  if (error) throw error;
}

export async function updatePollutantMeasurement(id: string, input: CreatePollutantInput): Promise<void> {
  await ensureSession();
  if (!input.unit.trim() || !input.dataSource.trim()) {
    throw new Error("La unidad y la fuente de datos no pueden quedar vacías.");
  }
  const payload: Database["public"]["Tables"]["pollutant_measurements"]["Update"] = {
    site_id: input.siteId,
    sampling_event_id: input.samplingEventId,
    measured_at: input.measuredAt,
    pollutant_code: input.pollutantCode,
    value: input.value,
    unit: input.unit.trim(),
    averaging_period: input.averagingPeriod,
    instrument_method: input.instrumentMethod,
    data_source: input.dataSource.trim(),
    qa_qc_status: input.qaQcStatus,
    notes: input.notes,
  };
  const { error } = await supabase.from("pollutant_measurements").update(payload).eq("id", id);
  if (error) throw error;
}

export async function deletePollutantMeasurement(id: string): Promise<void> {
  await ensureSession();
  const { error } = await supabase.from("pollutant_measurements").delete().eq("id", id);
  if (error) throw error;
}

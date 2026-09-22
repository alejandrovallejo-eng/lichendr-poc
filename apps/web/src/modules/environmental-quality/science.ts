import { calculateWeightedCoverage } from "../analysis/metrics";

export type PollutantUnitCode = "ug_m3" | "mg_m3" | "ng_m3" | "ppm" | "ppb";

export const POLLUTANT_UNIT_OPTIONS: ReadonlyArray<{ code: PollutantUnitCode; label: string }> = [
  { code: "ug_m3", label: "µg/m³" },
  { code: "mg_m3", label: "mg/m³" },
  { code: "ng_m3", label: "ng/m³" },
  { code: "ppm", label: "ppm" },
  { code: "ppb", label: "ppb" },
];

const UNIT_CODE_BY_LABEL = new Map<string, PollutantUnitCode>([
  ...POLLUTANT_UNIT_OPTIONS.map(({ code, label }) => [label, code] as const),
  ["ug/m3", "ug_m3"],
  ["µg/m3", "ug_m3"],
]);

export function pollutantUnitCodeFromLabel(label: string): PollutantUnitCode | null {
  return UNIT_CODE_BY_LABEL.get(label) ?? null;
}

export function pollutantUnitLabel(code: PollutantUnitCode): string {
  return POLLUTANT_UNIT_OPTIONS.find((option) => option.code === code)?.label ?? code;
}

export function validateAveragingPeriodMinutes(value: number | null): number | null {
  if (value != null && (!Number.isInteger(value) || value < 0)) {
    throw new Error("El período de promedio debe ser cero o un número entero positivo de minutos.");
  }
  return value;
}

export function averagingPeriodLabel(value: number | null): string {
  if (value == null) return "No reportado";
  if (value === 0) return "Instantáneo";
  if (value === 1) return "1 minuto";
  if (value === 60) return "1 hora";
  if (value === 480) return "8 horas";
  if (value === 1440) return "24 horas";
  return `${value} minutos`;
}

export type ReadinessStatus = "Completo" | "Parcial" | "Faltante" | "No aplica";

export interface ReadinessInput {
  completedAnnotations: number;
  metricsAvailable: number;
  confirmedTrunks: number;
  sampleCount: number;
  samplingHeightRecorded: number;
  orientationRecorded: number;
  sampledAreaRecorded: number;
  hostMetadataAvailable: number;
  barkCharacteristicsAvailable: number;
  microclimateAvailable: number;
  representedSites: number;
  candidateReferenceSites: number;
  pollutantMeasurements: number;
  representedTrees: number;
}

export interface ReadinessItem {
  key: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}

export interface EnvironmentalMetric {
  trunk_area_pixels: number | null;
  lichen_union_area_pixels: number | null;
  coverage_percent: number | null;
  lichen_region_count: number;
  morphotype_count: number;
  calculation_method: string;
  calculation_version: string;
  calculated_at: string;
  quality_flags: unknown[] | Record<string, unknown>;
}

export interface EnvironmentalEvaluation {
  annotationSetId: string;
  imageId: string;
  status: string;
  completedAt: string | null;
  siteId: string;
  samplingEventId: string;
  treeId: string;
  treeSampleId: string;
  metrics: EnvironmentalMetric | null;
  morphotypeLabels: string[];
}

export interface DescriptiveProfile {
  completedImages: number;
  representedTrees: number;
  representedSites: number;
  representedSamplingEvents: number;
  weightedCoverage: number | null;
  acceptedLichenRegions: number;
  morphotypeRichness: number;
  missingMetrics: number;
  incompleteMetrics: number;
  qualityFlags: string[];
  excludedRecords: number;
  perTreeCoverage: Array<{ id: string; value: number | null; imageCount: number }>;
  perSiteCoverage: Array<{ id: string; value: number | null; imageCount: number }>;
  calculationMethods: string[];
  lastCalculatedAt: string | null;
}

export interface PollutantValue {
  pollutantCode: string;
  unitCode: PollutantUnitCode;
  averagingPeriodMinutes: number | null;
  value: number;
}

export interface PollutantAggregate {
  pollutantCode: string;
  unitCode: PollutantUnitCode;
  averagingPeriodMinutes: number | null;
  count: number;
  mean: number;
}

function countedStatus(count: number, total: number, empty: ReadinessStatus = "No aplica"): ReadinessStatus {
  if (total === 0) return empty;
  if (count === 0) return "Faltante";
  return count >= total ? "Completo" : "Parcial";
}

function countDetail(count: number, total: number): string {
  return `${count} de ${total}`;
}

export function buildReadinessChecklist(input: ReadinessInput): ReadinessItem[] {
  const annotationTotal = input.completedAnnotations;
  const samples = input.sampleCount;
  return [
    {
      key: "annotations",
      label: "Anotaciones completadas y métricas",
      status: countedStatus(input.metricsAvailable, annotationTotal, "Faltante"),
      detail: countDetail(input.metricsAvailable, annotationTotal),
    },
    {
      key: "trunks",
      label: "Máscaras de tronco confirmadas",
      status: countedStatus(input.confirmedTrunks, annotationTotal, "Faltante"),
      detail: countDetail(input.confirmedTrunks, annotationTotal),
    },
    {
      key: "height",
      label: "Altura de muestreo registrada",
      status: countedStatus(input.samplingHeightRecorded, samples),
      detail: countDetail(input.samplingHeightRecorded, samples),
    },
    {
      key: "orientation",
      label: "Orientación registrada",
      status: countedStatus(input.orientationRecorded, samples),
      detail: countDetail(input.orientationRecorded, samples),
    },
    {
      key: "area",
      label: "Área real muestreada registrada",
      status: countedStatus(input.sampledAreaRecorded, samples),
      detail: countDetail(input.sampledAreaRecorded, samples),
    },
    {
      key: "host",
      label: "Metadatos del árbol hospedero disponibles",
      status: countedStatus(input.hostMetadataAvailable, samples),
      detail: countDetail(input.hostMetadataAvailable, samples),
    },
    {
      key: "bark",
      label: "Características de corteza disponibles",
      status: countedStatus(input.barkCharacteristicsAvailable, samples),
      detail: countDetail(input.barkCharacteristicsAvailable, samples),
    },
    {
      key: "microclimate",
      label: "Temperatura y humedad disponibles",
      status: countedStatus(input.microclimateAvailable, samples),
      detail: countDetail(input.microclimateAvailable, samples),
    },
    {
      key: "references",
      label: "Sitios de referencia comparables disponibles",
      status: input.representedSites === 0
        ? "No aplica"
        : input.candidateReferenceSites > 0 ? "Parcial" : "Faltante",
      detail: `${input.candidateReferenceSites} candidatos entre ${input.representedSites} sitios; la comparabilidad requiere revisión`,
    },
    {
      key: "pollutants",
      label: "Mediciones instrumentales de contaminantes disponibles",
      status: input.representedSites === 0
        ? "No aplica"
        : input.pollutantMeasurements > 0 ? "Completo" : "Faltante",
      detail: `${input.pollutantMeasurements} mediciones`,
    },
    {
      key: "trees",
      label: "Más de un árbol representado",
      status: input.representedTrees > 1 ? "Completo" : "Faltante",
      detail: `${input.representedTrees} árboles`,
    },
  ];
}

export function selectCompletedEvaluations<T extends Pick<EnvironmentalEvaluation, "status" | "completedAt">>(
  evaluations: readonly T[],
): T[] {
  return evaluations.filter((evaluation) => (
    evaluation.status === "completed" && evaluation.completedAt != null
  ));
}

function normalizeQualityFlags(value: EnvironmentalMetric["quality_flags"]): string[] {
  if (Array.isArray(value)) return value.filter((flag): flag is string => typeof flag === "string");
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([flag, enabled]) => enabled === true ? [flag] : []);
  }
  return [];
}

function groupedCoverage(
  evaluations: readonly EnvironmentalEvaluation[],
  key: "treeId" | "siteId",
): Array<{ id: string; value: number | null; imageCount: number }> {
  const groups = new Map<string, EnvironmentalEvaluation[]>();
  for (const evaluation of evaluations) {
    const id = evaluation[key];
    groups.set(id, [...(groups.get(id) ?? []), evaluation]);
  }
  return [...groups].map(([id, items]) => ({
    id,
    value: calculateWeightedCoverage(items.map((item) => item.metrics)),
    imageCount: items.length,
  }));
}

export function buildDescriptiveProfile(
  allEvaluations: readonly EnvironmentalEvaluation[],
): DescriptiveProfile {
  const completed = selectCompletedEvaluations(allEvaluations);
  const metrics = completed.flatMap((evaluation) => evaluation.metrics ? [evaluation.metrics] : []);
  const calculatedDates = metrics.map((metric) => metric.calculated_at).sort();
  const missingMetrics = completed.length - metrics.length;
  const qualityFlags = new Set(metrics.flatMap((metric) => normalizeQualityFlags(metric.quality_flags)));
  if (missingMetrics > 0) qualityFlags.add("summary_pending");
  return {
    completedImages: completed.length,
    representedTrees: new Set(completed.map((item) => item.treeId)).size,
    representedSites: new Set(completed.map((item) => item.siteId)).size,
    representedSamplingEvents: new Set(completed.map((item) => item.samplingEventId)).size,
    weightedCoverage: calculateWeightedCoverage(completed.map((item) => item.metrics)),
    acceptedLichenRegions: metrics.reduce((sum, metric) => sum + metric.lichen_region_count, 0),
    morphotypeRichness: new Set(completed.flatMap((item) => (
      item.morphotypeLabels.map((label) => label.trim().toLocaleLowerCase()).filter(Boolean)
    ))).size,
    missingMetrics,
    incompleteMetrics: metrics.filter((metric) => metric.coverage_percent == null).length,
    qualityFlags: [...qualityFlags],
    excludedRecords: allEvaluations.length - completed.length,
    perTreeCoverage: groupedCoverage(completed, "treeId"),
    perSiteCoverage: groupedCoverage(completed, "siteId"),
    calculationMethods: [...new Set(metrics.map((metric) => (
      `${metric.calculation_method} v${metric.calculation_version}`
    )))],
    lastCalculatedAt: calculatedDates.at(-1) ?? null,
  };
}

export function aggregateCompatiblePollutants(
  measurements: readonly PollutantValue[],
): PollutantAggregate[] {
  const groups = new Map<string, PollutantValue[]>();
  for (const measurement of measurements) {
    const periodKey = measurement.averagingPeriodMinutes == null
      ? "null"
      : String(measurement.averagingPeriodMinutes);
    const key = [measurement.pollutantCode, measurement.unitCode, periodKey].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), measurement]);
  }
  return [...groups.values()].map((items) => ({
    pollutantCode: items[0].pollutantCode,
    unitCode: items[0].unitCode,
    averagingPeriodMinutes: items[0].averagingPeriodMinutes,
    count: items.length,
    mean: items.reduce((sum, item) => sum + item.value, 0) / items.length,
  }));
}

import type { TreeMetricSummary, VisionViewResult } from "./types";

export function aggregateFourViewMetrics(results: readonly (VisionViewResult | null)[]): TreeMetricSummary {
  const valid = results.filter((result): result is VisionViewResult & { metrics: NonNullable<VisionViewResult["metrics"]> } => (
    result?.status === "provisional_ai"
    && result.metrics !== null
    && result.metrics.valid_area_cm2 > 0
    && result.metrics.valid_area_cm2 <= 500
    && result.metrics.lichen_union_area_cm2 >= 0
    && result.metrics.lichen_union_area_cm2 <= result.metrics.valid_area_cm2
    && result.metrics.occupied_cells >= 0
    && result.metrics.occupied_cells <= 5
  ));
  const totalValidAreaCm2 = valid.reduce((sum, result) => sum + result.metrics.valid_area_cm2, 0);
  const totalLichenAreaCm2 = valid.reduce((sum, result) => sum + result.metrics.lichen_union_area_cm2, 0);
  const morphotypes = new Set(valid.flatMap((result) => Object.keys(result.metrics.morphotype_coverage)));
  const provisionalViews = valid.filter((result) => (
    result.frame_detection.classification === "manual_assisted_provisional"
    || result.quality_flags.includes("manual_estimated_geometry")
  )).length;
  return {
    totalValidAreaCm2,
    totalLichenAreaCm2,
    coveragePercent: valid.length === 4 ? totalLichenAreaCm2 / totalValidAreaCm2 * 100 : null,
    occupiedCells: valid.reduce((sum, result) => sum + result.metrics.occupied_cells, 0),
    morphotypeRichness: morphotypes.size,
    validViews: valid.length,
    validatedViews: valid.length - provisionalViews,
    provisionalViews,
    isProvisional: provisionalViews > 0,
    pendingViews: 4 - valid.length,
  };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("El resultado de visión no contiene una imagen válida.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}

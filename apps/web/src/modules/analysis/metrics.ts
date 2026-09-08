export interface CoverageAreas {
  trunk_area_pixels: number | null;
  lichen_union_area_pixels: number | null;
}

export function calculateWeightedCoverage(
  metricsRows: readonly (CoverageAreas | null)[],
): number | null {
  let trunkPixels = 0;
  let lichenPixels = 0;
  for (const metrics of metricsRows) {
    if (
      metrics?.trunk_area_pixels == null
      || metrics.trunk_area_pixels <= 0
      || metrics.lichen_union_area_pixels == null
    ) continue;
    trunkPixels += metrics.trunk_area_pixels;
    lichenPixels += metrics.lichen_union_area_pixels;
  }
  return trunkPixels > 0 ? lichenPixels / trunkPixels * 100 : null;
}

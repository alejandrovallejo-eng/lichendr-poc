import assert from "node:assert/strict";
import test from "node:test";
import { aggregateFourViewMetrics } from "./metrics";
import type { VisionViewResult } from "./types";

function result(area: number, morphotypes: Record<string, number> = { "LQ-001": 10 }): VisionViewResult {
  return {
    template_version: "LICHENDR-FRAME-0.2",
    algorithm_version: "four-view-0.2.0",
    canonical_width: 400,
    canonical_height: 2000,
    pixels_per_cm: 40,
    reprojection_error_px: 0,
    quality_flags: [],
    quality_score: 1,
    critical_errors: [],
    status: "provisional_ai",
    rectified_image_data_url: "data:image/jpeg;base64,AA==",
    model_name: "MobileSAM vit_t",
    source: "mobile_sam_cielab",
    metrics: {
      valid_area_cm2: 500,
      lichen_union_area_cm2: area,
      lichen_coverage_percent: area / 5,
      component_count: 1,
      occupied_cells: 2,
      provisional_morphotype_richness: Object.keys(morphotypes).length,
      morphotype_coverage: morphotypes,
      quality_score: 1,
      quality_flags: [],
      candidates: [],
      lichen_union_mask_data_url: "data:image/png;base64,AA==",
    },
  };
}

test("calcula las cuatro vistas con área ponderada y máximo de 2000 cm²", () => {
  const summary = aggregateFourViewMetrics([result(50), result(100), result(150), result(200)]);
  assert.equal(summary.totalValidAreaCm2, 2000);
  assert.equal(summary.totalLichenAreaCm2, 500);
  assert.equal(summary.coveragePercent, 25);
  assert.equal(summary.validViews, 4);
  assert.equal(summary.pendingViews, 0);
});

test("mantiene incompleta una serie con una vista faltante", () => {
  const summary = aggregateFourViewMetrics([result(50), result(50), result(50), null]);
  assert.equal(summary.totalValidAreaCm2, 1500);
  assert.equal(summary.validViews, 3);
  assert.equal(summary.pendingViews, 1);
});

test("cuenta un morfotipo una sola vez entre vistas", () => {
  const summary = aggregateFourViewMetrics([
    result(50, { "LQ-001": 10 }),
    result(50, { "LQ-001": 5, "LQ-002": 5 }),
    null,
    null,
  ]);
  assert.equal(summary.morphotypeRichness, 2);
});

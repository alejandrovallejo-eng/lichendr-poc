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
    source: "mobile_sam_cielab:validated",
    frame_detection: {
      classification: "validated",
      method: "aruco_board_multiscale",
      confidence: 0.99,
      detected_marker_ids: [0, 1, 2, 3],
      missing_marker_ids: [],
      rejected_candidate_count: 0,
      successful_resolution: { width: 720, height: 2320 },
      successful_variant: "grayscale",
      reprojection_error_px: 0,
      rejection_reason: null,
      proposal_source: null,
      assisted_eligible: false,
      user_confirmed: false,
      source_width: 720,
      source_height: 2320,
    },
    corner_proposal: null,
    source_width: 720,
    source_height: 2320,
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
  assert.equal(summary.coveragePercent, null);
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

test("rechaza una vista que excede el máximo físico de 500 cm²", () => {
  const invalid = result(501);
  invalid.metrics!.valid_area_cm2 = 501;
  const summary = aggregateFourViewMetrics([result(50), result(50), result(50), invalid]);
  assert.equal(summary.totalValidAreaCm2, 1500);
  assert.equal(summary.coveragePercent, null);
  assert.equal(summary.validViews, 3);
});

test("identifica claramente un total con geometría manual provisional", () => {
  const provisional = result(50);
  provisional.frame_detection.classification = "manual_assisted_provisional";
  provisional.quality_flags = ["manual_estimated_geometry"];
  const summary = aggregateFourViewMetrics([result(50), result(50), result(50), provisional]);
  assert.equal(summary.validViews, 4);
  assert.equal(summary.validatedViews, 3);
  assert.equal(summary.provisionalViews, 1);
  assert.equal(summary.isProvisional, true);
  assert.equal(summary.coveragePercent, 10);
});

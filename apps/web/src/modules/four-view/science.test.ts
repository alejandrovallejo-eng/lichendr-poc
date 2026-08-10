import { strict as assert } from "node:assert";
import test from "node:test";
import { combineTrunkEstimates, fieldTapeDiameter, summarizeCalibration } from "./science.ts";
import type { TrunkViewEstimate, VisionViewResult } from "./types";

function calibrated(): VisionViewResult {
  return {
    template_version: "test",
    algorithm_version: "test",
    canonical_width: 400,
    canonical_height: 2000,
    pixels_per_cm: 40,
    reprojection_error_px: 0,
    quality_flags: [],
    quality_score: 1,
    critical_errors: [],
    status: "rectification_review",
    rectified_image_data_url: "data:image/jpeg;base64,AA==",
    model_name: "MobileSAM vit_t",
    source: "test",
    metrics: null,
    frame_detection: {
      classification: "validated",
      method: "automatic",
      confidence: 1,
      detected_marker_ids: [0, 1, 2, 3],
      missing_marker_ids: [],
      rejected_candidate_count: 0,
      successful_resolution: null,
      successful_variant: null,
      reprojection_error_px: 0,
      rejection_reason: null,
      proposal_source: null,
      assisted_eligible: false,
      user_confirmed: false,
      source_width: 1200,
      source_height: 1600,
    },
    corner_proposal: null,
    source_width: 1200,
    source_height: 1600,
    trunk_estimate: null,
  };
}

function estimate(width: number, confidence: TrunkViewEstimate["confidence"] = "medium"): TrunkViewEstimate {
  return {
    width_cm: width,
    min_cm: width * 0.85,
    max_cm: width * 1.15,
    left_x_normalized: 0.2,
    right_x_normalized: 0.8,
    scale_cm_per_pixel: 0.05,
    confidence,
    method: "automatic",
    quality_flags: [],
  };
}

test("la calibración de cuatro vistas no produce cobertura", () => {
  const summary = summarizeCalibration([calibrated(), calibrated(), calibrated(), calibrated()]);
  assert.equal(summary.calibrated, true);
  assert.equal(summary.totalCalibratedAreaCm2, 2000);
  assert.equal(calibrated().metrics, null);
});

test("la cinta tiene prioridad científica y calcula diámetro", () => {
  assert.ok(Math.abs((fieldTapeDiameter(100) ?? 0) - 31.8309886) < 0.0001);
  assert.equal(fieldTapeDiameter(null), null);
});

test("combina cuatro vistas opuestas con sección elíptica", () => {
  const result = combineTrunkEstimates({
    N: estimate(30, "high"),
    S: estimate(32, "high"),
    E: estimate(40, "high"),
    W: estimate(38, "high"),
  });
  assert.equal(result?.viewsUsed.length, 4);
  assert.equal(result?.geometricAssumption, "elliptical");
  assert.equal(result?.confidence, "high");
  assert.ok((result?.minCm ?? 0) < (result?.circumferenceCm ?? 0));
  assert.ok((result?.maxCm ?? 0) > (result?.circumferenceCm ?? 0));
});

test("una vista produce una estimación circular preliminar de baja confianza", () => {
  const result = combineTrunkEstimates({ N: estimate(34, "low") });
  assert.equal(result?.confidence, "low");
  assert.equal(result?.geometricAssumption, "circular");
  assert.ok(result?.qualityFlags.includes("limited_view_count"));
});

test("sin bordes utilizables el tamaño permanece null", () => {
  assert.equal(combineTrunkEstimates({ N: null, E: null }), null);
});

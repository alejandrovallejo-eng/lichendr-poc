import assert from "node:assert/strict";
import test from "node:test";
import { classificationLabel, detectionMessage, reprojectionLabel } from "./assistance";
import type { FrameDetectionDetails } from "./types";

function detection(overrides: Partial<FrameDetectionDetails> = {}): FrameDetectionDetails {
  return {
    classification: null,
    method: "aruco_partial_frame_contour",
    confidence: 0.8,
    detected_marker_ids: [2, 3],
    missing_marker_ids: [0, 1],
    rejected_candidate_count: 4,
    successful_resolution: { width: 1512, height: 2016 },
    successful_variant: "clahe",
    reprojection_error_px: 1.25,
    rejection_reason: "markers_incomplete",
    proposal_source: "frame_contour",
    assisted_eligible: false,
    user_confirmed: false,
    source_width: 1512,
    source_height: 2016,
    ...overrides,
  };
}

test("describe marcadores detectados y faltantes por posición", () => {
  assert.equal(
    detectionMessage(detection()),
    "Detectamos 2 de 4 marcadores: faltan superior izquierdo y superior derecho.",
  );
});

test("explica la trazabilidad automática, asistida y manual", () => {
  assert.equal(classificationLabel("validated"), "Automático validado");
  assert.equal(classificationLabel("assisted"), "Automático asistido");
  assert.equal(classificationLabel("manual_assisted"), "Manual asistido");
  assert.equal(reprojectionLabel(null), "No disponible (confirmación manual)");
  assert.equal(reprojectionLabel(0.567), "0.57 px");
});

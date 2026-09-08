import assert from "node:assert/strict";
import test from "node:test";

import { canFinalizeReview, reviewedCoverage } from "./coverage.ts";

const WIDTH = 10;
const HEIGHT = 10;

function rectangleMask(x: number, y: number, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      mask[row * WIDTH + column] = 1;
    }
  }
  return mask;
}

const ROI = rectangleMask(0, 0, 10, 5); // 50 píxeles válidos.

test("la cobertura revisada es unión ∩ ROI sobre ROI", () => {
  const result = reviewedCoverage({
    acceptedLichenMasks: [rectangleMask(0, 0, 5, 5)],
    roiMask: ROI,
    width: WIDTH,
    height: HEIGHT,
    completenessReviewed: true,
    roiSource: "trunk_confirmed",
  });
  assert.equal(result.available, true);
  assert.equal(result.roiPixels, 50);
  assert.equal(result.intersectionPixels, 25);
  assert.equal(result.coveragePercent, 50);
});

test("las regiones solapadas no se cuentan dos veces", () => {
  const result = reviewedCoverage({
    acceptedLichenMasks: [rectangleMask(0, 0, 5, 5), rectangleMask(2, 0, 5, 5)],
    roiMask: ROI,
    width: WIDTH,
    height: HEIGHT,
    completenessReviewed: true,
    roiSource: "trunk_confirmed",
  });
  // Unión = columnas 0..6 en 5 filas = 35 píxeles, no 50.
  assert.equal(result.acceptedUnionPixels, 35);
  assert.equal(result.intersectionPixels, 35);
  assert.equal(result.coveragePercent, 70);
});

test("el liquen fuera del ROI no entra en el numerador y el resultado queda en 0–100", () => {
  const result = reviewedCoverage({
    acceptedLichenMasks: [rectangleMask(0, 0, 10, 10)],
    roiMask: ROI,
    width: WIDTH,
    height: HEIGHT,
    completenessReviewed: true,
    roiSource: "trunk_confirmed",
  });
  assert.equal(result.acceptedUnionPixels, 100);
  assert.equal(result.intersectionPixels, 50);
  assert.equal(result.coveragePercent, 100);
  assert.ok(result.coveragePercent! >= 0 && result.coveragePercent! <= 100);
});

test("sin regiones aceptadas la cobertura es cero, no indeterminada", () => {
  const result = reviewedCoverage({
    acceptedLichenMasks: [],
    roiMask: ROI,
    width: WIDTH,
    height: HEIGHT,
    completenessReviewed: true,
    roiSource: "trunk_confirmed",
  });
  assert.equal(result.available, true);
  assert.equal(result.coveragePercent, 0);
});

test("un ROI de área cero no produce porcentaje", () => {
  const result = reviewedCoverage({
    acceptedLichenMasks: [rectangleMask(0, 0, 5, 5)],
    roiMask: new Uint8Array(WIDTH * HEIGHT),
    width: WIDTH,
    height: HEIGHT,
    completenessReviewed: true,
    roiSource: "trunk_confirmed",
  });
  assert.equal(result.available, false);
  assert.equal(result.unavailableReason, "roi_zero_area");
  assert.equal(result.coveragePercent, null);
});

test("las dimensiones incompatibles se rechazan", () => {
  const result = reviewedCoverage({
    acceptedLichenMasks: [new Uint8Array(9)],
    roiMask: ROI,
    width: WIDTH,
    height: HEIGHT,
    completenessReviewed: true,
    roiSource: "trunk_confirmed",
  });
  assert.equal(result.available, false);
  assert.equal(result.unavailableReason, "mask_dimension_mismatch");
  assert.throws(
    () => reviewedCoverage({
      acceptedLichenMasks: [],
      roiMask: ROI,
      width: 0,
      height: HEIGHT,
      completenessReviewed: true,
      roiSource: "trunk_confirmed",
    }),
    /no son válidas/,
  );
});

test("sin revisión de completitud no se entrega porcentaje", () => {
  const result = reviewedCoverage({
    acceptedLichenMasks: [rectangleMask(0, 0, 5, 5)],
    roiMask: ROI,
    width: WIDTH,
    height: HEIGHT,
    completenessReviewed: false,
    roiSource: "trunk_confirmed",
  });
  assert.equal(result.available, false);
  assert.equal(result.unavailableReason, "completeness_not_reviewed");
  assert.equal(result.coveragePercent, null);
});

test("sin calibración el porcentaje es exploratorio y no entra en agregados científicos", () => {
  const result = reviewedCoverage({
    acceptedLichenMasks: [rectangleMask(0, 0, 5, 5)],
    roiMask: ROI,
    width: WIDTH,
    height: HEIGHT,
    completenessReviewed: true,
    roiSource: "trunk_confirmed",
  });
  assert.equal(result.exploratory, true);
  assert.equal(result.excludedFromScientificAggregates, true);
  assert.match(result.notice, /no equivale a cm²/);
  assert.match(result.notice, /calidad del aire/);
});

test("no se finaliza con regiones pendientes ni sin revisar la completitud del ROI", () => {
  assert.deepEqual(canFinalizeReview({ pendingCount: 2, completenessReviewed: true }), {
    canFinalize: false,
    reason: "Quedan 2 regiones sin revisar.",
  });
  const withoutCompleteness = canFinalizeReview({ pendingCount: 0, completenessReviewed: false });
  assert.equal(withoutCompleteness.canFinalize, false);
  assert.match(withoutCompleteness.reason!, /no demuestra ausencia/);
  assert.deepEqual(canFinalizeReview({ pendingCount: 0, completenessReviewed: true }), {
    canFinalize: true,
    reason: null,
  });
});

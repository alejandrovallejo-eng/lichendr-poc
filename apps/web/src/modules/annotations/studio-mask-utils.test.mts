import assert from "node:assert/strict";
import test from "node:test";
import { calculateWeightedCoverage } from "../analysis/metrics.ts";
import { calculateAnnotationMetricSummary } from "./studio-mask-utils.ts";

test("calcula una sola máscara", () => {
  const result = calculateAnnotationMetricSummary(
    new Uint8Array([1, 1, 1, 1]),
    [new Uint8Array([1, 0, 1, 0])],
  );

  assert.equal(result.lichenUnionInsideTrunkPixels, 2);
  assert.equal(result.overlappingLichenPixels, 0);
  assert.equal(result.coveragePercent, 50);
});

test("une dos máscaras sin solapamiento", () => {
  const result = calculateAnnotationMetricSummary(
    new Uint8Array([1, 1, 1, 1]),
    [new Uint8Array([1, 0, 0, 0]), new Uint8Array([0, 1, 0, 0])],
  );

  assert.equal(result.lichenUnionInsideTrunkPixels, 2);
  assert.equal(result.overlappingLichenPixels, 0);
});

test("cuenta el solapamiento de dos máscaras dentro del tronco", () => {
  const result = calculateAnnotationMetricSummary(
    new Uint8Array([1, 1, 1, 1]),
    [new Uint8Array([1, 1, 0, 0]), new Uint8Array([0, 1, 1, 0])],
  );

  assert.equal(result.lichenUnionInsideTrunkPixels, 3);
  assert.equal(result.overlappingLichenPixels, 1);
  assert.ok(result.qualityFlags.includes("high_lichen_overlap"));
});

test("separa el liquen parcialmente fuera del tronco", () => {
  const result = calculateAnnotationMetricSummary(
    new Uint8Array([1, 1, 0, 0]),
    [new Uint8Array([0, 1, 1, 0])],
  );

  assert.equal(result.lichenUnionInsideTrunkPixels, 1);
  assert.equal(result.lichenOutsideTrunkPixels, 1);
  assert.equal(result.overlappingLichenPixels, 0);
  assert.equal(result.coveragePercent, 50);
});

test("no mezcla solapamiento fuera del tronco", () => {
  const result = calculateAnnotationMetricSummary(
    new Uint8Array([1, 1, 0, 0]),
    [new Uint8Array([1, 0, 1, 0]), new Uint8Array([0, 1, 1, 0])],
  );

  assert.equal(result.lichenOutsideTrunkPixels, 1);
  assert.equal(result.overlappingLichenPixels, 0);
});

test("calcula cobertura cero", () => {
  const result = calculateAnnotationMetricSummary(
    new Uint8Array([1, 1]),
    [new Uint8Array([0, 0])],
  );

  assert.equal(result.coveragePercent, 0);
});

test("calcula cobertura completa", () => {
  const result = calculateAnnotationMetricSummary(
    new Uint8Array([1, 1, 0]),
    [new Uint8Array([1, 1, 0])],
  );

  assert.equal(result.coveragePercent, 100);
});

test("marca un tronco vacío", () => {
  const result = calculateAnnotationMetricSummary(
    new Uint8Array([0, 0]),
    [new Uint8Array([1, 0])],
  );

  assert.equal(result.trunkAreaPixels, 0);
  assert.equal(result.coveragePercent, null);
  assert.ok(result.qualityFlags.includes("zero_trunk_area"));
});

test("marca dimensiones incompatibles", () => {
  const result = calculateAnnotationMetricSummary(
    new Uint8Array([1, 1]),
    [new Uint8Array([1])],
  );

  assert.equal(result.lichenUnionInsideTrunkPixels, null);
  assert.equal(result.coveragePercent, null);
  assert.ok(result.qualityFlags.includes("mask_dimension_mismatch"));
});

test("marca la ausencia de tronco", () => {
  const result = calculateAnnotationMetricSummary(
    null,
    [new Uint8Array([1, 0])],
  );

  assert.equal(result.trunkAreaPixels, null);
  assert.equal(result.coveragePercent, null);
  assert.ok(result.qualityFlags.includes("missing_trunk"));
});

test("pondera múltiples imágenes por área de tronco", () => {
  const result = calculateWeightedCoverage([
    { trunk_area_pixels: 100, lichen_union_area_pixels: 25 },
    { trunk_area_pixels: 300, lichen_union_area_pixels: 225 },
    null,
    { trunk_area_pixels: 0, lichen_union_area_pixels: null },
  ]);

  assert.equal(result, 62.5);
});

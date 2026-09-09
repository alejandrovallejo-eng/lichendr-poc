import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEditedMask,
  applyServerGeometry,
  buildSuggestionPayload,
  gridPromptPoints,
  manualRegion,
  maskPixelHash,
  regionsFromMasks,
} from "./client.ts";
import { applyBrush } from "./mask-edit.ts";
import { decodeMaskRle, maskArea } from "./mask-codec.ts";
import { reviewedCoverage } from "./coverage.ts";
import { applyDecision, applyMaskEdit, mergeReviews } from "./review.ts";
import type { WorkingGrid } from "./client.ts";

const GRID: WorkingGrid = {
  width: 8,
  height: 4,
  originalWidth: 4284,
  originalHeight: 5712,
  orientationAppliedUpstream: true,
  rectified: false,
};

function maskFromRows(rows: string[]): Uint8Array {
  const mask = new Uint8Array(rows[0].length * rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      mask[y * rows[0].length + x] = cell === "#" ? 1 : 0;
    });
  });
  return mask;
}

const BLOB = maskFromRows([
  "........",
  "..####..",
  "..####..",
  "........",
]);
const OTHER = maskFromRows([
  "##......",
  "##......",
  "........",
  "........",
]);
const EMPTY = maskFromRows([
  "........",
  "........",
  "........",
  "........",
]);

test("la rejilla de prompts es fija y reproducible", () => {
  const points = gridPromptPoints(5, 2);
  assert.equal(points.length, 10);
  assert.deepEqual(points[0], { x: 0.25, y: 0.1 });
  assert.deepEqual(gridPromptPoints(5, 2), points);
  assert.throws(() => gridPromptPoints(0, 2), /rejilla/);
});

test("las regiones conservan los píxeles de la máscara, no sólo la caja", () => {
  const [region] = regionsFromMasks([{ regionId: "a", mask: BLOB, samScore: 0.9 }], GRID, 24);
  assert.deepEqual(region.box, { x: 2, y: 1, width: 4, height: 2 });
  assert.equal(region.maskAreaPixels, 8);
  const decoded = decodeMaskRle(region.maskRle);
  assert.equal(decoded.width, GRID.width);
  assert.equal(decoded.height, GRID.height);
  assert.deepEqual(Array.from(decoded.mask), Array.from(BLOB));
  // La caja NO se expande en el cliente: el contexto lo añade el servidor.
  assert.equal(region.cropBoxNormalized, null);
});

test("máscaras vacías se descartan y los duplicados de píxeles se colapsan", () => {
  const regions = regionsFromMasks(
    [
      { regionId: "a", mask: BLOB, samScore: 0.9 },
      { regionId: "b", mask: BLOB, samScore: 0.8 },
      { regionId: "c", mask: EMPTY, samScore: 0.7 },
      { regionId: "d", mask: OTHER, samScore: 0.6 },
    ],
    GRID,
    24,
  );
  assert.deepEqual(regions.map((region) => region.regionId), ["a", "d"]);
});

test("el número de regiones está acotado", () => {
  const regions = regionsFromMasks(
    [
      { regionId: "a", mask: BLOB, samScore: 0.9 },
      { regionId: "d", mask: OTHER, samScore: 0.6 },
    ],
    GRID,
    1,
  );
  assert.equal(regions.length, 1);
});

test("el hash de máscara depende de los píxeles", () => {
  const [first] = regionsFromMasks([{ regionId: "a", mask: BLOB, samScore: 0.9 }], GRID, 24);
  const [second] = regionsFromMasks([{ regionId: "a", mask: OTHER, samScore: 0.9 }], GRID, 24);
  assert.notEqual(first.maskSha, second.maskSha);
  assert.equal(first.maskSha, maskPixelHash(first.maskRle));
});

test("el payload lleva identificadores, cajas ajustadas y hashes, nunca bytes ni URLs", () => {
  const regions = regionsFromMasks([{ regionId: "a", mask: BLOB, samScore: 0.9 }], GRID, 24);
  const payload = buildSuggestionPayload(
    {
      imageId: "img-1",
      treeSampleId: "tree-1",
      direction: "N",
      requestToken: "token-1",
    },
    regions,
    { width: GRID.width, height: GRID.height },
  );
  assert.equal(payload.sourceWidth, 8);
  assert.equal(payload.sourceHeight, 4);
  assert.deepEqual(payload.regions[0], {
    regionId: "a",
    box: { x: 2, y: 1, width: 4, height: 2 },
    maskAreaPixels: 8,
    maskSha: regions[0].maskSha,
    samScore: 0.9,
  });
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes("http"));
  assert.ok(!serialized.includes("data:image"));
  assert.ok(!serialized.includes("maskRle"));
});

test("la geometría del servidor se aplica al overlay una sola vez", () => {
  const regions = regionsFromMasks([{ regionId: "a", mask: BLOB, samScore: 0.9 }], GRID, 24);
  const cropBoxNormalized = { x: 0.2, y: 0.1, width: 0.6, height: 0.7 };
  const withGeometry = applyServerGeometry(regions, [{ regionId: "a", cropBoxNormalized }]);
  assert.deepEqual(withGeometry[0].cropBoxNormalized, cropBoxNormalized);
  const steps = withGeometry[0].transformChain.filter((step) => step.step === "server_crop");
  assert.equal(steps.length, 1);
  const again = applyServerGeometry(withGeometry, [{ regionId: "a", cropBoxNormalized }]);
  assert.equal(again[0].transformChain.filter((step) => step.step === "server_crop").length, 1);
});

test("una máscara omitida se puede crear sin ninguna propuesta y se dibuja con píxeles", () => {
  // Que MobileSAM no proponga nada no demuestra ausencia: el revisor añade la
  // región y la pinta.
  const region = manualRegion("manual-1", GRID);
  assert.equal(region.maskAreaPixels, 0);
  assert.equal(region.samScore, 0);
  assert.deepEqual(region.box, { x: 0, y: 0, width: 0, height: 0 });

  const decoded = decodeMaskRle(region.maskRle);
  const painted = applyBrush(decoded.mask, decoded.width, decoded.height, {
    x: 3,
    y: 2,
    radius: 1,
    mode: "add",
  });
  const edited = applyEditedMask(region, painted, decoded.width, decoded.height);
  assert.ok(edited.maskAreaPixels > 0);
  assert.equal(edited.maskAreaPixels, maskArea(painted));
  // El recuadro sigue a los píxeles pintados: no es un booleano.
  assert.ok(edited.box.width > 0 && edited.box.height > 0);
  assert.notEqual(edited.maskSha, region.maskSha);
  // El recorte del servidor anterior ya no describe esta máscara.
  assert.equal(edited.cropBoxNormalized, null);
});

test("la cobertura sólo cuenta el liquen aceptado dentro del ROI delimitado", () => {
  const region = manualRegion("manual-1", GRID);
  const decoded = decodeMaskRle(region.maskRle);
  const mask = new Uint8Array(decoded.mask);
  mask[0] = 1;
  mask[1] = 1;
  const edited = applyEditedMask(region, mask, decoded.width, decoded.height);

  // ROI de tronco delimitado a mano: sólo la primera fila.
  const roi = new Uint8Array(GRID.width * GRID.height);
  for (let index = 0; index < GRID.width; index += 1) roi[index] = 1;

  const reviews = applyDecision(mergeReviews([], [edited]), {
    regionId: "manual-1",
    decision: "accepted",
    label: "lichen",
    reviewedBy: "revisor",
    reviewedAt: new Date().toISOString(),
  });
  assert.equal(reviews[0].decision, "accepted");

  const coverage = reviewedCoverage({
    acceptedLichenMasks: [decodeMaskRle(edited.maskRle).mask],
    roiMask: roi,
    width: GRID.width,
    height: GRID.height,
    completenessReviewed: true,
    roiSource: "tronco delimitado a mano por el revisor sobre la fotografía",
  });
  assert.equal(coverage.available, true);
  assert.equal(coverage.roiPixels, GRID.width);
  assert.equal(coverage.intersectionPixels, 2);
  assert.equal(coverage.coveragePercent, (2 / GRID.width) * 100);
});

test("reintentar la clasificación no puede perder los píxeles editados", () => {
  // El reintento sólo vuelve a pedir etiquetas: recibe las MISMAS regiones y
  // únicamente les aplica la geometría del recorte.
  const proposed = regionsFromMasks([{ regionId: "a", mask: BLOB, samScore: 0.9 }], GRID, 24);
  const decoded = decodeMaskRle(proposed[0].maskRle);
  const painted = applyBrush(decoded.mask, decoded.width, decoded.height, {
    x: 6,
    y: 3,
    radius: 1,
    mode: "add",
  });
  const edited = applyEditedMask(proposed[0], painted, decoded.width, decoded.height);
  const reviews = applyMaskEdit(mergeReviews([], proposed), "a", edited.maskSha, proposed[0].maskSha);

  const afterRetry = applyServerGeometry(
    [edited],
    [{ regionId: "a", cropBoxNormalized: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } }],
  );
  assert.equal(afterRetry[0].maskRle, edited.maskRle);
  assert.equal(afterRetry[0].maskSha, edited.maskSha);
  assert.equal(afterRetry[0].maskAreaPixels, edited.maskAreaPixels);
  // Y la revisión sigue clavada sobre los píxeles editados.
  const merged = mergeReviews(reviews, afterRetry);
  assert.equal(merged[0].maskSha, edited.maskSha);
  assert.equal(merged[0].maskEdited, true);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  applyServerGeometry,
  buildSuggestionPayload,
  gridPromptPoints,
  maskPixelHash,
  regionsFromMasks,
} from "./client.ts";
import { decodeMaskRle } from "./mask-codec.ts";
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

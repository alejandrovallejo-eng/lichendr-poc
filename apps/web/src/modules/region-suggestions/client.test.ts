import assert from "node:assert/strict";
import { test } from "node:test";
import { gridPromptPoints, regionsFromCandidates } from "./client.ts";
import { parseSavedBatch, savedBatchStorageKey } from "./storage.ts";

function squareMask(size: number, x0: number, y0: number, side: number): number[][] {
  const mask: number[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < size; x += 1) {
      row.push(x >= x0 && x < x0 + side && y >= y0 && y < y0 + side ? 1 : 0);
    }
    mask.push(row);
  }
  return mask;
}

test("la rejilla de prompts es fija y reproducible", () => {
  const points = gridPromptPoints();
  assert.equal(points.length, 10);
  assert.deepEqual(points[0], { x: 0.25, y: 0.1 });
  assert.deepEqual(gridPromptPoints(), points);
  assert.throws(() => gridPromptPoints(0, 2));
});

test("las candidatas se convierten en regiones con cadena de transformaciones", () => {
  const regions = regionsFromCandidates(
    [
      { id: "a", score: 0.8, mask: squareMask(100, 10, 10, 20), width: 100, height: 100 },
      // Empty mask: it must be dropped, never turned into an empty region.
      { id: "b", score: 0.9, mask: squareMask(100, 0, 0, 0), width: 100, height: 100 },
    ],
    {
      orientation: 6,
      proxyScale: 0.5,
      rectified: true,
      canonicalWidth: 400,
      canonicalHeight: 2000,
      preprocessMode: "whole_crop_pad",
    },
  );
  assert.equal(regions.length, 1);
  const region = regions[0];
  assert.equal(region.regionId, "a");
  assert.equal(region.maskAreaPixels, 400);
  assert.equal(region.samScore, 0.8);
  // The crop keeps the whole region plus context; it never cuts it.
  assert.ok(region.box.x <= 10 && region.box.y <= 10);
  assert.ok(region.box.x + region.box.width >= 30);
  assert.ok(region.box.y + region.box.height >= 30);
  const steps = region.transformChain.map((step) => step.step);
  assert.deepEqual(steps, [
    "exif_orientation",
    "analysis_proxy",
    "rectification",
    "mask_bounding_box",
    "context_expansion",
    "crop_downscale",
    "encoder_preprocess",
  ]);
  const orientation = region.transformChain[0];
  assert.equal(orientation.step === "exif_orientation" ? orientation.orientation : null, 6);
  const preprocess = region.transformChain[6];
  assert.equal(preprocess.step === "encoder_preprocess" ? preprocess.centerCrop : true, false);
});

test("la clave de almacenamiento está acotada al propietario", () => {
  assert.equal(
    savedBatchStorageKey("owner-1", "image-1"),
    "lichendr:region-suggestions:owner-1:image-1",
  );
  assert.throws(() => savedBatchStorageKey("", "image-1"));
});

test("el estado guardado se valida antes de restaurarse", () => {
  assert.equal(parseSavedBatch(null), null);
  assert.equal(parseSavedBatch("{"), null);
  assert.equal(parseSavedBatch('{"regions":[]}'), null);
  const parsed = parseSavedBatch(
    '{"regions":[],"suggestions":[],"reviews":[],"backend":"zeroshot","completenessReviewed":true}',
  );
  assert.ok(parsed);
  assert.equal(parsed.backend, "zeroshot");
  assert.equal(parsed.completenessReviewed, true);
});

import { strict as assert } from "node:assert";
import test from "node:test";
import { annotationRasterPath, isMaskCompatibleWithTarget } from "./annotation-target.ts";

test("las anotaciones de captura usan la imagen rectificada", () => {
  const target = {
    target_storage_path: "series/view/rectified.jpg",
    target_width_px: 400,
    target_height_px: 2000,
  };
  assert.equal(annotationRasterPath(target, "series/view/original.jpg"), target.target_storage_path);
});

test("una anotación histórica sin target conserva la imagen original", () => {
  assert.equal(annotationRasterPath({
    target_storage_path: null,
    target_width_px: null,
    target_height_px: null,
  }, "legacy/original.jpg"), "legacy/original.jpg");
});

test("acepta únicamente máscaras con las dimensiones del target rectificado", () => {
  const target = {
    target_storage_path: "series/view/rectified.jpg",
    target_width_px: 400,
    target_height_px: 2000,
  };
  assert.equal(isMaskCompatibleWithTarget({
    mask_width_px: 400,
    mask_height_px: 2000,
  }, target, 400, 2000), true);
  assert.equal(isMaskCompatibleWithTarget({
    mask_width_px: 205,
    mask_height_px: 1024,
  }, target, 400, 2000), false);
});

test("una máscara incompatible puede omitirse sin invalidar las compatibles", () => {
  const target = {
    target_storage_path: "series/view/rectified.jpg",
    target_width_px: 400,
    target_height_px: 2000,
  };
  const regions = [
    { mask_width_px: 400, mask_height_px: 2000 },
    { mask_width_px: 1200, mask_height_px: 1600 },
    { mask_width_px: 400, mask_height_px: 2000 },
  ];
  assert.deepEqual(
    regions.filter((region) => isMaskCompatibleWithTarget(region, target, 400, 2000)),
    [regions[0], regions[2]],
  );
});

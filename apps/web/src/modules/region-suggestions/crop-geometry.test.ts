import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTEXT_MARGIN_RATIO,
  MAX_CROP_SIDE,
  applyExifOrientationToBox,
  deduplicateBoxes,
  expandWithContext,
  intersectionOverUnion,
  maskBoundingBox,
  planCrop,
  planCropBatch,
  scaleToMaxSide,
} from "./crop-geometry.ts";

function maskFromRows(rows: string[]): { mask: Uint8Array; width: number; height: number } {
  const height = rows.length;
  const width = rows[0].length;
  const mask = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      mask[y * width + x] = cell === "#" ? 1 : 0;
    });
  });
  return { mask, width, height };
}

test("el recuadro cubre todos los píxeles de la máscara", () => {
  const { mask, width, height } = maskFromRows([
    "....",
    ".##.",
    "..#.",
    "....",
  ]);
  assert.deepEqual(maskBoundingBox(mask, width, height), { x: 1, y: 1, width: 2, height: 2 });
});

test("una máscara vacía no produce recorte", () => {
  const { mask, width, height } = maskFromRows(["..", ".."]);
  assert.equal(maskBoundingBox(mask, width, height), null);
  assert.equal(planCrop({
    mask,
    maskWidth: width,
    maskHeight: height,
    orientation: 1,
    proxyScale: 1,
    rectified: false,
    canonicalWidth: width,
    canonicalHeight: height,
    preprocessMode: "whole_crop_pad",
  }), null);
});

test("la máscara debe coincidir con las dimensiones declaradas", () => {
  assert.throws(() => maskBoundingBox(new Uint8Array(9), 4, 4), /no coincide/);
});

test("el contexto se añade sin recortar nunca la región", () => {
  const box = { x: 40, y: 30, width: 40, height: 20 };
  const expanded = expandWithContext(box, 400, 300);
  assert.ok(expanded.x <= box.x);
  assert.ok(expanded.y <= box.y);
  assert.ok(expanded.x + expanded.width >= box.x + box.width);
  assert.ok(expanded.y + expanded.height >= box.y + box.height);
  assert.ok(expanded.width >= box.width * (1 + CONTEXT_MARGIN_RATIO));
});

test("una región pegada al borde conserva sus extremos", () => {
  const expanded = expandWithContext({ x: 0, y: 0, width: 20, height: 200 }, 100, 200);
  assert.equal(expanded.x, 0);
  assert.equal(expanded.y, 0);
  assert.equal(expanded.height, 200);
  assert.ok(expanded.width >= 20);
});

test("una región diminuta crece hasta el lado mínimo", () => {
  const expanded = expandWithContext({ x: 50, y: 50, width: 4, height: 4 }, 200, 200);
  assert.ok(expanded.width >= 48);
  assert.ok(expanded.height >= 48);
});

test("las regiones grandes se reescalan, no se truncan", () => {
  assert.equal(scaleToMaxSide({ x: 0, y: 0, width: 4096, height: 2048 }), MAX_CROP_SIDE / 4096);
  assert.equal(scaleToMaxSide({ x: 0, y: 0, width: 100, height: 100 }), 1);
});

test("los duplicados se colapsan y las regiones distintas sobreviven", () => {
  const first = { x: 0, y: 0, width: 100, height: 100 };
  const almost = { x: 1, y: 1, width: 100, height: 100 };
  const other = { x: 300, y: 300, width: 100, height: 100 };
  assert.ok(intersectionOverUnion(first, almost) > 0.9);
  assert.equal(intersectionOverUnion(first, other), 0);
  assert.deepEqual(deduplicateBoxes([first, almost, other]), [first, other]);
});

test("la orientación EXIF 6 reubica las coordenadas y las inválidas se rechazan", () => {
  const box = { x: 10, y: 20, width: 30, height: 40 };
  assert.deepEqual(applyExifOrientationToBox(box, 6, 100, 200), {
    x: 200 - 20 - 40,
    y: 10,
    width: 40,
    height: 30,
  });
  assert.deepEqual(applyExifOrientationToBox(box, 1, 100, 200), box);
  assert.throws(() => applyExifOrientationToBox(box, 42, 100, 200), /Orientación EXIF/);
});

test("el plan de recorte registra la cadena completa de transformaciones", () => {
  const { mask, width, height } = maskFromRows([
    "........",
    "..####..",
    "..####..",
    "........",
  ]);
  const plan = planCrop({
    mask,
    maskWidth: width,
    maskHeight: height,
    orientation: 6,
    proxyScale: 0.5,
    rectified: true,
    canonicalWidth: 400,
    canonicalHeight: 2000,
    preprocessMode: "whole_crop_pad",
  });
  assert.ok(plan);
  assert.deepEqual(plan!.transformChain.map((step) => step.step), [
    "exif_orientation",
    "analysis_proxy",
    "rectification",
    "mask_bounding_box",
    "context_expansion",
    "crop_downscale",
    "encoder_preprocess",
  ]);
  const preprocess = plan!.transformChain.at(-1) as { centerCrop: boolean };
  // Nunca se aplica un center crop accidental sobre el recorte propuesto.
  assert.equal(preprocess.centerCrop, false);
});

test("el lote descarta máscaras vacías, duplicados y respeta el tope de regiones", () => {
  const big = maskFromRows([
    "........",
    "..####..",
    "..####..",
    "........",
  ]);
  const duplicate = maskFromRows([
    "........",
    "..####..",
    "..####..",
    "........",
  ]);
  const empty = maskFromRows([
    "........",
    "........",
    "........",
    "........",
  ]);
  const far = maskFromRows([
    "##......",
    "##......",
    "........",
    "........",
  ]);
  const common = {
    orientation: 1,
    proxyScale: 1,
    rectified: false,
    canonicalWidth: 8,
    canonicalHeight: 4,
    preprocessMode: "whole_crop_pad",
  };
  const planned = planCropBatch([
    { regionId: "a", mask: big.mask, maskWidth: big.width, maskHeight: big.height, ...common },
    { regionId: "b", mask: duplicate.mask, maskWidth: duplicate.width, maskHeight: duplicate.height, ...common },
    { regionId: "c", mask: empty.mask, maskWidth: empty.width, maskHeight: empty.height, ...common },
    { regionId: "d", mask: far.mask, maskWidth: far.width, maskHeight: far.height, ...common },
  ]);
  assert.deepEqual(planned.map((item) => item.regionId), ["a"]);

  const capped = planCropBatch(
    [
      { regionId: "a", mask: big.mask, maskWidth: big.width, maskHeight: big.height, ...common },
      { regionId: "d", mask: far.mask, maskWidth: far.width, maskHeight: far.height, ...common },
    ],
    1,
  );
  assert.equal(capped.length, 1);
});

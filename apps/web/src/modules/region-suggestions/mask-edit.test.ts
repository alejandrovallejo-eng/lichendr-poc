import assert from "node:assert/strict";
import test from "node:test";

import { applyBrush, maskFromRgba, masksEqual } from "./mask-edit.ts";
import { maskArea } from "./mask-codec.ts";

test("el pincel cambia píxeles reales, no un booleano", () => {
  const width = 16;
  const height = 16;
  const original = new Uint8Array(width * height);
  const painted = applyBrush(original, width, height, { x: 8, y: 8, radius: 3, mode: "add" });
  assert.notEqual(maskArea(painted), 0);
  assert.equal(maskArea(original), 0, "la máscara original no se muta");
  assert.equal(masksEqual(original, painted), false);

  const erased = applyBrush(painted, width, height, { x: 8, y: 8, radius: 4, mode: "erase" });
  assert.equal(maskArea(erased), 0);
  assert.equal(masksEqual(original, erased), true);
});

test("el pincel se recorta a la imagen y respeta el radio", () => {
  const width = 8;
  const height = 8;
  const mask = new Uint8Array(width * height);
  const painted = applyBrush(mask, width, height, { x: 0, y: 0, radius: 2, mode: "add" });
  assert.equal(painted[0], 1);
  assert.equal(painted[width * height - 1], 0);
  assert.throws(
    () => applyBrush(mask, width, height, { x: 1, y: 1, radius: 0, mode: "add" }),
    /pincel/,
  );
  assert.throws(() => applyBrush(new Uint8Array(3), width, height, { x: 1, y: 1, radius: 1, mode: "add" }), /no coincide/);
});

test("la máscara PNG de MobileSAM se convierte por canal alfa", () => {
  const width = 2;
  const height = 2;
  const rgba = new Uint8ClampedArray([
    255, 255, 255, 0,
    255, 255, 255, 255,
    255, 255, 255, 7,
    255, 255, 255, 8,
  ]);
  assert.deepEqual(Array.from(maskFromRgba(rgba, width, height)), [0, 1, 0, 1]);
  assert.throws(() => maskFromRgba(rgba, 3, 3), /no coinciden/);
});

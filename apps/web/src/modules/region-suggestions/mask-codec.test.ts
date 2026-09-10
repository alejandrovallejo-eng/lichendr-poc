import assert from "node:assert/strict";
import test from "node:test";

import { decodeMaskRle, encodeMaskRle, maskArea } from "./mask-codec.ts";

function maskFromRows(rows: string[]): { mask: Uint8Array; width: number; height: number } {
  const width = rows[0].length;
  const height = rows.length;
  const mask = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      mask[y * width + x] = cell === "#" ? 1 : 0;
    });
  });
  return { mask, width, height };
}

test("los píxeles de la máscara sobreviven al viaje de ida y vuelta", () => {
  const { mask, width, height } = maskFromRows([
    "..##....",
    ".####...",
    "..###...",
    "........",
  ]);
  const encoded = encodeMaskRle(mask, width, height);
  const decoded = decodeMaskRle(encoded);
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  assert.deepEqual(Array.from(decoded.mask), Array.from(mask));
  assert.equal(maskArea(decoded.mask), maskArea(mask));
});

test("una máscara llena y una vacía se codifican sin perder área", () => {
  const full = new Uint8Array(12).fill(1);
  assert.equal(maskArea(decodeMaskRle(encodeMaskRle(full, 4, 3)).mask), 12);
  const empty = new Uint8Array(12);
  assert.equal(maskArea(decodeMaskRle(encodeMaskRle(empty, 4, 3)).mask), 0);
});

test("una máscara codificada corrupta se rechaza en vez de dar una cobertura falsa", () => {
  assert.throws(() => decodeMaskRle("4:3"), /no es válida/);
  assert.throws(() => decodeMaskRle("0:3:12"), /no son válidas/);
  assert.throws(() => decodeMaskRle("4:3:5"), /incompleta/);
  assert.throws(() => decodeMaskRle("4:3:20"), /excede/);
  assert.throws(() => decodeMaskRle("4:3:x"), /no es válida/);
});

test("codificar exige dimensiones coherentes", () => {
  assert.throws(() => encodeMaskRle(new Uint8Array(9), 4, 3), /no coincide/);
  assert.throws(() => encodeMaskRle(new Uint8Array(0), 0, 3), /no son válidas/);
});

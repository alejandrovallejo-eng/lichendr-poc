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
  scaleBoxToSpace,
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

// --- Contrato único de geometría -------------------------------------------
//
// Original 4284x5712 con EXIF 6: la orientación ya está aplicada aguas arriba
// (proxy con `.rotate()` y servicio con `exif_transpose`), así que el original
// canónico y el proxy comparten espacio y sólo cambian de escala.

const ORIGINAL = { width: 4284, height: 5712 };
const PROXY = { width: 1536, height: 2048 };
const WORKING = { width: 768, height: 1024 };

test("una caja de la rejilla de trabajo se escala al proxy sin perder la región", () => {
  const box = { x: 100, y: 200, width: 50, height: 40 };
  const onProxy = scaleBoxToSpace(box, WORKING.width, WORKING.height, PROXY.width, PROXY.height);
  assert.deepEqual(onProxy, { x: 200, y: 400, width: 100, height: 80 });
  // La escala trabajo→proxy es la misma que trabajo→original salvo el factor.
  const onOriginal = scaleBoxToSpace(
    box,
    WORKING.width,
    WORKING.height,
    ORIGINAL.width,
    ORIGINAL.height,
  );
  assert.ok(onOriginal.x <= Math.floor((box.x / WORKING.width) * ORIGINAL.width));
  assert.ok(
    onOriginal.x + onOriginal.width
      >= Math.floor(((box.x + box.width) / WORKING.width) * ORIGINAL.width),
  );
});

test("el recorte del servidor coincide con el overlay del panel, también en los bordes", () => {
  // Región pegada al borde inferior derecho de la vista.
  const box = { x: WORKING.width - 20, y: WORKING.height - 30, width: 20, height: 30 };
  const onProxy = scaleBoxToSpace(box, WORKING.width, WORKING.height, PROXY.width, PROXY.height);
  assert.equal(onProxy.x + onProxy.width, PROXY.width);
  assert.equal(onProxy.y + onProxy.height, PROXY.height);

  // El contexto se añade UNA sola vez, en el servidor.
  const crop = expandWithContext(onProxy, PROXY.width, PROXY.height);
  assert.ok(crop.x <= onProxy.x && crop.y <= onProxy.y);
  assert.equal(crop.x + crop.width, PROXY.width);
  assert.equal(crop.y + crop.height, PROXY.height);

  // El overlay dibuja el recorte normalizado que devuelve el servidor: al
  // llevarlo a píxeles del proxy vuelve a ser exactamente el mismo recorte.
  const normalized = {
    x: crop.x / PROXY.width,
    y: crop.y / PROXY.height,
    width: crop.width / PROXY.width,
    height: crop.height / PROXY.height,
  };
  assert.deepEqual(
    {
      x: Math.round(normalized.x * PROXY.width),
      y: Math.round(normalized.y * PROXY.height),
      width: Math.round(normalized.width * PROXY.width),
      height: Math.round(normalized.height * PROXY.height),
    },
    crop,
  );
  // Expandir otra vez (doble contexto) daría un recorte distinto: por eso la
  // expansión sólo ocurre en el servidor.
  const doubleExpanded = expandWithContext(crop, PROXY.width, PROXY.height);
  assert.notDeepEqual(doubleExpanded, crop);
});

test("las dimensiones del espacio de coordenadas se validan", () => {
  assert.throws(
    () => scaleBoxToSpace({ x: 0, y: 0, width: 1, height: 1 }, 0, 10, 10, 10),
    /espacio de coordenadas/,
  );
});

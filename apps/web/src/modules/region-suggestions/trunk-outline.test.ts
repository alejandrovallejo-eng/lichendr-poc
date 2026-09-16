import assert from "node:assert/strict";
import test from "node:test";
import { clipToTrunk, parseTrunkOutline, rasterizeTrunk, trunkOutlineError, trunkPromptPoints, trunkStorageKey } from "./trunk-outline.ts";

const trunk = [{ x: .44, y: 0 }, { x: .58, y: 0 }, { x: .64, y: 1 }, { x: .51, y: 1 }];
test("el tronco central sí recibe puntos; ninguno cae fuera, incluso en polígonos cóncavos", () => {
  for (const outline of [trunk, [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .6, y: .9 }, { x: .6, y: .4 }, { x: .4, y: .4 }, { x: .4, y: .9 }, { x: .1, y: .9 }]]) {
    const mask = rasterizeTrunk(outline, 100, 160);
    const points = trunkPromptPoints(mask, 100, 160);
    assert.equal(points.length, 15);
    assert.deepEqual(points, trunkPromptPoints(mask, 100, 160));
    for (const p of points) assert.equal(mask[Math.floor(p.y * 160) * 100 + Math.floor(p.x * 100)], 1);
    assert.deepEqual(mask, rasterizeTrunk([...outline].reverse(), 100, 160));
  }
  assert.ok(trunkPromptPoints(rasterizeTrunk(trunk, 100, 160), 100, 160).every(p => p.x > .4 && p.x < .65));
});
test("las propuestas no pueden conservar píxeles de fondo fuera del tronco", () => {
  const roi = rasterizeTrunk(trunk, 100, 160);
  const full = new Uint8Array(16000).fill(1);
  assert.deepEqual(clipToTrunk(full, roi), roi);
  assert.equal(full.reduce((a, b) => a + b, 0), 16000, "input mask never modified");
  assert.throws(() => clipToTrunk(full, new Uint8Array(1)));
});
test("el contorno rechaza cruces, líneas, duplicados, coordenadas inválidas y exceso de puntos", () => {
  assert.match(trunkOutlineError([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }]) ?? "", /cruzan/);
  assert.ok(trunkOutlineError([{ x: .1, y: .1 }, { x: .5, y: .5 }, { x: .9, y: .9 }]));
  assert.ok(trunkOutlineError([trunk[0], trunk[0], ...trunk.slice(1)]));
  assert.ok(trunkOutlineError([{ x: NaN, y: 0 }, ...trunk]));
  assert.ok(trunkOutlineError([{ x: 1.1, y: 0 }, ...trunk]));
  assert.ok(trunkOutlineError(Array(65).fill(trunk[0])));
  assert.throws(() => rasterizeTrunk(trunk, 1e9, 1e9));
  assert.equal(parseTrunkOutline('{"version":1,"points":[null,null,null]}'), null);
});
test("persistencia normalizada separada por dueño, árbol, vista e imagen; versión y JSON inválidos no se aplican", () => {
  const id = { ownerId: "a", treeSampleId: "b", direction: "N", imageId: "c" };
  const key = trunkStorageKey(id);
  for (const field of Object.keys(id)) assert.notEqual(key, trunkStorageKey({ ...id, [field]: "different" }));
  assert.deepEqual(parseTrunkOutline(JSON.stringify({ version: 1, points: trunk })), trunk);
  assert.equal(parseTrunkOutline(JSON.stringify({ version: 9, points: trunk })), null);
  assert.equal(parseTrunkOutline("invalid"), null);
  assert.equal(parseTrunkOutline(null), null);
});

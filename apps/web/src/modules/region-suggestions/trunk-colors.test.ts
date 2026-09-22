import assert from "node:assert/strict";
import test from "node:test";
import { classifyTrunkColors, colorStorageKey, colorWorkingSize, initialColorConfig, parseColorConfig, rgbToLab, sampleColor,
  type ColorSample, type RGB } from "./trunk-colors.ts";
import { rasterizeTrunk } from "./trunk-outline.ts";

const whole = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const bark: RGB = [70, 40, 20], lichen: RGB = [210, 220, 170], other: RGB = [30, 80, 210];
const samples: ColorSample[] = [{ x: .2, y: .5, rgb: bark, label: 2 }, { x: .6, y: .5, rgb: lichen, label: 3 }];
const rgba = (colors: RGB[]) => new Uint8ClampedArray(colors.flatMap(c => [...c, 255]));

test("Lab colour references and bounded image size", () => {
  assert.ok(Math.abs(rgbToLab([255, 255, 255])[0] - 100) < .001);
  assert.deepEqual(rgbToLab([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(colorWorkingSize(6000, 8000), { width: 768, height: 1024 });
  assert.deepEqual(colorWorkingSize(3, 2), { width: 3, height: 2 });
  assert.throws(() => colorWorkingSize(0, 2));
});

test("colour classes are exclusive; unknown remains in the coverage denominator", async () => {
  const result = await classifyTrunkColors(rgba([bark, bark, lichen, lichen, other]), 5, 1, whole,
    { ...initialColorConfig(), samples: [...samples, { ...samples[1], x: .7 }] });
  assert.deepEqual([...result.labels], [2, 2, 3, 3, 1]);
  assert.equal(result.total, 5); assert.equal(result.lichen, 2);
  assert.equal(result.counts.reduce((a, b) => a + b), result.total);
});

test("competing bark/lichen or lichen tone samples stay unknown rather than double count", async () => {
  for (const competing of [2, 4] as const) {
    const result = await classifyTrunkColors(rgba([lichen]), 1, 1, whole, { ...initialColorConfig(), samples: [
      ...samples, { x: .5, y: .5, rgb: lichen, label: competing },
    ] });
    assert.equal(result.labels[0], 1); assert.equal(result.lichen, 0);
  }
});

test("no classification or sampling outside ROI; sample averaging excludes background", async () => {
  const outline = [{ x: .25, y: 0 }, { x: .75, y: 0 }, { x: .75, y: 1 }, { x: .25, y: 1 }];
  const data = rgba([other, bark, lichen, other]);
  const roi = rasterizeTrunk(outline, 4, 1);
  assert.equal(sampleColor(data, 4, 1, roi, .1, .5, 2), null);
  const sampled = sampleColor(data, 4, 1, roi, .3, .5, 2);
  assert.deepEqual(sampled?.rgb, [140, 130, 95]);
  const result = await classifyTrunkColors(data, 4, 1, outline, { ...initialColorConfig(), samples: [
    { ...samples[0], x: .3 }, { ...samples[1], x: .6 },
  ] });
  assert.deepEqual([...result.labels], [0, 2, 3, 0]); assert.equal(result.total, 2);
  await assert.rejects(classifyTrunkColors(data, 4, 1, outline, { ...initialColorConfig(), samples }), /fuera del tronco/);
});

test("reject corrupt configuration and isolate every outline and photo", () => {
  const c = { ...initialColorConfig(), samples };
  assert.deepEqual(parseColorConfig(JSON.stringify(c)), c);
  for (const value of ["bad", JSON.stringify({ ...c, tolerance: 100 }), JSON.stringify({ ...c, version: 2 }),
    JSON.stringify({ ...c, samples: [{ ...samples[0], label: 9 }] }), JSON.stringify({ ...c, samples: Array(25).fill(samples[0]) })])
    assert.equal(parseColorConfig(value), null);
  assert.notEqual(colorStorageKey("owner/tree/N/photoA", whole), colorStorageKey("owner/tree/E/photoA", whole));
  assert.notEqual(colorStorageKey("photoA", whole), colorStorageKey("photoB", whole));
  assert.notEqual(colorStorageKey("photoA", whole), colorStorageKey("photoA", whole.map(p => ({ ...p, x: p.x * .9 }))));
});

test("obsolete work cancels and images cannot exceed bounded grid", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(classifyTrunkColors(rgba([bark]), 1, 1, whole, { ...initialColorConfig(), samples }, controller.signal), { name: "AbortError" });
  await assert.rejects(classifyTrunkColors(new Uint8ClampedArray(), 2048, 2048, whole, { ...initialColorConfig(), samples }), /seguro/);
});

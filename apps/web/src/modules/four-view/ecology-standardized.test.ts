import test from "node:test";
import assert from "node:assert/strict";
import { encodeMaskRle } from "../region-suggestions/mask-codec";
import { emptyEcologyConfig, frameContinuationReady, parseEcologyReview, quadratFromFrame, sameEcologySource, selectMorph } from "./ecology";

const morphA = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", event_id: "event", ordinal: 1 };
const morphB = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", event_id: "event", ordinal: 2 };
const allAbsent = () => Object.fromEntries(Array.from({ length: 5 }, (_, index) => [String(index), "not_observed"]));
const outline = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

test("a confirmed frame derives the usable quadrat without a second click and rejects invalid frames", () => {
  assert.deepEqual(quadratFromFrame({ corners: [{ x: .2, y: .1 }, { x: .8, y: .1 }, { x: .8, y: .9 }, { x: .2, y: .9 }] }, outline, 100, 100),
    { x: 20, y: 10, width: 60, height: 80 });
  assert.equal(quadratFromFrame({ corners: [{ x: 0, y: 0 }, { x: .01, y: 0 }, { x: .01, y: .02 }, { x: 0, y: .02 }] }, outline, 100, 100), null);
  assert.equal(quadratFromFrame({ corners: [{ x: .2, y: .1 }, { x: .8, y: .1 }, { x: .8, y: .9 }, { x: .2, y: .9 }] },
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .4 }, { x: 0, y: .4 }], 100, 100), null);
  const valid = { x: 20, y: 10, width: 60, height: 80 };
  assert.equal(frameContinuationReady(true, { corners: [{ x: .2, y: .1 }, { x: .8, y: .1 }, { x: .8, y: .9 }, { x: .2, y: .9 }] }, true, valid), true);
  assert.equal(frameContinuationReady(true, { corners: [{ x: .2, y: .1 }] }, true, valid), false);
  assert.equal(frameContinuationReady(true, { corners: [{ x: .2, y: .1 }, { x: .8, y: .1 }, { x: .8, y: .9 }, { x: .2, y: .9 }] }, true, null), false);
});

function review() {
  const config = selectMorph(selectMorph(emptyEcologyConfig(), morphA).config, morphB).config;
  const mask = encodeMaskRle(new Uint8Array(10 * 50), 10, 50);
  const standardized = {
    method: "cell-frequency-v2",
    frame: { corners: outline, widthCm: 10, heightCm: 50 },
    frameConfirmed: true,
    calibration: {
      pixelsPerCm: 1, method: "manual_confirmed", width: 10, height: 50, imageId: "image",
      proxyPath: "analysis-proxy:image", transformationId: "manual-frame:image", sourceCorners: outline,
    },
    maskWidth: 10, maskHeight: 50, masksByMorph: { [morphA.id]: mask, [morphB.id]: mask },
    decisions: { [morphA.id]: allAbsent(), [morphB.id]: allAbsent() },
    reviewedAt: "2026-09-22T00:00:00Z", sourceFingerprint: "manual-frame:image",
  };
  return {
    version: 1, scale: "uncalibrated", sourceOutline: outline, quadrat: { x: 0, y: 0, width: 10, height: 10 },
    width: 10, height: 10, config, counts: [0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0], total: 100,
    savedAt: "2026-09-22T00:00:00Z", standardized,
  };
}

test("standardized review survives a JSON round trip and rejects incomplete matrices", () => {
  const raw = review();
  const parsed = parseEcologyReview(JSON.parse(JSON.stringify(raw)));
  assert.ok(parsed);
  const source = parsed!.standardized!.calibration;
  assert.equal(sameEcologySource(parsed!, outline, 10, 10, { imageId: source.imageId, calibration: source }), true);
  assert.equal(sameEcologySource(parsed!, outline, 10, 10, { imageId: source.imageId }), true);
  assert.equal(sameEcologySource(parsed!, outline, 10, 10, {
    imageId: source.imageId,
    calibration: { ...source, transformationId: "rectified:changed" },
  }), false);
  assert.equal(sameEcologySource(parsed!, outline, 10, 10, {
    imageId: source.imageId,
    calibration: { ...source, sourceCorners: [{ x: .01, y: 0 }, ...source.sourceCorners.slice(1)] },
  }), false);
  assert.equal(parseEcologyReview({
    ...raw,
    standardized: { ...raw.standardized, decisions: { [morphA.id]: { "0": "observed" }, [morphB.id]: allAbsent() } },
  }), null);
  assert.equal(parseEcologyReview({ ...raw, padding: "x".repeat(200_001) }), null);
  assert.equal(parseEcologyReview({ ...raw, padding: "😀".repeat(50_001) }), null);
});

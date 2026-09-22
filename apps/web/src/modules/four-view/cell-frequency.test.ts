import test from "node:test";
import assert from "node:assert/strict";
import { encodeMaskRle } from "../region-suggestions/mask-codec";
import { confirmedFrequency, occupiedCellsFromMask, proposeCellDecisions, verticalFrameCells } from "./cell-frequency";

const frame = { x: 0, y: 0, width: 1, height: 1, widthCm: 10 as const, heightCm: 50 as const };

test("the physical frame is 10 wide by 50 high and cells stack vertically", () => {
  const cells = verticalFrameCells(frame, 10, 50);
  assert.equal(cells[0].width, 1);
  assert.equal(cells[0].height, .2);
  assert.equal(cells[0].pixel.top, 0);
  assert.equal(cells[1].pixel.top, 10);
  assert.equal(cells[4].pixel.bottom, 50);
});

test("cell proposals use mask pixels, including a mask crossing cells", () => {
  const mask = new Uint8Array(10 * 50);
  for (let y = 9; y <= 11; y++) for (let x = 2; x < 4; x++) mask[y * 10 + x] = 1;
  assert.deepEqual(occupiedCellsFromMask(mask, 10, 50, frame), [0, 1]);
  const decisions = proposeCellDecisions({
    frame, maskWidth: 10, maskHeight: 50,
    masksByMorph: { same: encodeMaskRle(mask, 10, 50) },
  });
  assert.deepEqual(decisions.same, {
    "0": "proposed", "1": "proposed", "2": "not_evaluated", "3": "not_evaluated", "4": "not_evaluated",
  });
});

test("tones of one morphospecies deduplicate and pending is not zero", () => {
  assert.equal(confirmedFrequency({ same: { "0": "proposed", "1": "not_observed" } }), null);
  assert.equal(confirmedFrequency({ same: { "0": "observed" } }), null);
  assert.deepEqual(confirmedFrequency({
    same: { "0": "observed", "1": "not_observed", "2": "not_observed", "3": "not_observed", "4": "not_observed" },
    toneTwoOfSame: { "0": "observed", "1": "not_observed", "2": "not_observed", "3": "not_observed", "4": "not_observed" },
  }), { occupiedCells: 1, totalCells: 5 });
});

test("an explicit five-cell absence is complete while an empty matrix is pending", () => {
  assert.equal(confirmedFrequency({}), null);
  assert.deepEqual(confirmedFrequency({
    same: { "0": "not_observed", "1": "not_observed", "2": "not_observed", "3": "not_observed", "4": "not_observed" },
  }), { occupiedCells: 0, totalCells: 5 });
});

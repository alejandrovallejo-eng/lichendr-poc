import test from "node:test";
import assert from "node:assert/strict";
import { encodeMaskRle } from "../region-suggestions/mask-codec";
import { confirmedFrequency, confirmedFrequencyByMorph, frameCellPolygons, occupiedCellsFromMask, pendingCellDecision, proposeCellDecisions, verticalFrameCells, type CellDecision } from "./cell-frequency";

const frame = { corners: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] as [{x:number;y:number},{x:number;y:number},{x:number;y:number},{x:number;y:number}], widthCm: 10 as const, heightCm: 50 as const };

test("the physical frame is 10 wide by 50 high and cells stack vertically", () => {
  const cells = verticalFrameCells(frame, 10, 50);
  assert.equal(cells[0].corners[2].y, .2);
  assert.equal(cells[1].corners[0].y, .2);
  assert.equal(cells[4].corners[2].y, 1);
});

test("perspective frame keeps pixels outside the quad out of every cell", () => {
  const perspective = { ...frame, corners: [{x:.2,y:.1},{x:.8,y:.05},{x:.9,y:.95},{x:.1,y:.9}] as typeof frame.corners };
  const mask = new Uint8Array(10 * 10);
  mask[0] = 1;
  assert.deepEqual(occupiedCellsFromMask(mask, 10, 10, perspective), []);
});

test("perspective subdivisions keep an interior point in its physical cell", () => {
  const perspective = { ...frame, corners: [{x:.15,y:.05},{x:.85,y:.1},{x:.95,y:.95},{x:.05,y:.8}] as typeof frame.corners };
  const polygons = frameCellPolygons(perspective.corners);
  const mask = new Uint8Array(100 * 100);
  const edge = polygons[2][0], next = polygons[2][2];
  const x = Math.round((edge.x * .25 + next.x * .75) * 100 - .5);
  const y = Math.round((edge.y * .25 + next.y * .75) * 100 - .5);
  mask[y * 100 + x] = 1;
  assert.deepEqual(occupiedCellsFromMask(mask, 100, 100, perspective), [2]);
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

test("frequency remains separate for each morphospecies across views", () => {
  const complete = (occupied: number): Record<string, CellDecision> => Object.fromEntries(Array.from({ length: 5 }, (_, index) =>
    [String(index), (index === occupied ? "observed" : "not_observed") as CellDecision]));
  assert.deepEqual(confirmedFrequencyByMorph({ A: complete(0), B: complete(1) }, ["A", "B"]), {
    A: { occupiedCells: 1, totalCells: 5 }, B: { occupiedCells: 1, totalCells: 5 },
  });

  test("all five terminal cells are required independently for every group", () => {
    const complete = (state: CellDecision) => Object.fromEntries(Array.from({ length: 5 }, (_, index) => [String(index), state]));
    assert.equal(pendingCellDecision({ A: complete("observed") }, ["A"]), null);
    assert.deepEqual(pendingCellDecision({ A: { ...complete("observed"), "4": "proposed" } }, ["A"]), { morphId: "A", cell: 5, state: "proposed" });
    assert.deepEqual(pendingCellDecision({ A: complete("observed") }, ["A", "B"]), { morphId: "B", cell: 1, state: "missing" });
    assert.deepEqual(pendingCellDecision({ A: complete("observed"), B: complete("not_observed") }, ["A", "B"]), null);
  });
  assert.equal(confirmedFrequencyByMorph({ A: complete(0), B: { "0": "observed" } }, ["A", "B"]).B, null);
});

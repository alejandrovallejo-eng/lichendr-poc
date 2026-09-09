import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_WORKING_SIDE,
  pickBestCandidate,
  workingSize,
  type ServiceCandidate,
} from "./sam-service.ts";

function candidate(id: string, score: number, areaPixels: number): ServiceCandidate {
  return {
    id,
    score,
    maskDataUrl: "data:image/png;base64,AA==",
    width: 8,
    height: 8,
    areaPixels,
    modelName: "MobileSAM vit_t",
  };
}

test("la rejilla de trabajo conserva la proporción y está acotada", () => {
  const big = workingSize(4284, 5712);
  assert.equal(Math.max(big.width, big.height), MAX_WORKING_SIDE);
  assert.ok(Math.abs(big.width / big.height - 4284 / 5712) < 0.01);
  const small = workingSize(300, 200);
  assert.deepEqual(small, { width: 300, height: 200, scale: 1 });
  assert.throws(() => workingSize(0, 10), /no son válidas/);
});

test("se elige la candidata recomendada de MobileSAM salvo que esté vacía", () => {
  const candidates = [candidate("a", 0.4, 100), candidate("b", 0.9, 50)];
  assert.equal(pickBestCandidate(candidates, 1)?.id, "b");
  assert.equal(pickBestCandidate([candidate("a", 0.4, 0), candidate("b", 0.9, 50)], 0)?.id, "b");
  assert.equal(pickBestCandidate([candidate("a", 0.4, 0)], 0), null);
  assert.equal(pickBestCandidate([], 0), null);
});

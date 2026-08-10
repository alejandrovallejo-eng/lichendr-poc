import { strict as assert } from "node:assert";
import test from "node:test";
import { nextFourViewDestination, nextTreeDestination } from "./navigation.ts";

test("avanza a la próxima vista de la misma serie", () => {
  assert.equal(
    nextFourViewDestination("series-1", 1),
    "/annotations?captureSeriesId=series-1&view=2&tool=ai",
  );
});

test("después de la cuarta vista abre los resultados", () => {
  assert.equal(
    nextFourViewDestination("series-1", 3),
    "/analysis?captureSeriesId=series-1",
  );
});

test("finalizar permite trabajar con otro árbol", () => {
  assert.equal(nextTreeDestination(), "/images");
});

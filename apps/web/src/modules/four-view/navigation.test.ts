import { strict as assert } from "node:assert";
import test from "node:test";
import {
  captureToAnnotationsDestination,
  nextFourViewDestination,
  nextTreeDestination,
  orderFourViewTargets,
} from "./navigation.ts";

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

test("captura calibrada abre el workspace de la misma serie", () => {
  assert.equal(
    captureToAnnotationsDestination("series-1"),
    "/annotations?captureSeriesId=series-1&view=0&tool=ai",
  );
});

test("el workspace recibe las cuatro imágenes rectificadas en orden N/E/S/O", () => {
  const targets = orderFourViewTargets([
    { direction: "W" as const, annotation_set_id: "set-w" },
    { direction: "N" as const, annotation_set_id: "set-n" },
    { direction: "S" as const, annotation_set_id: "set-s" },
    { direction: "E" as const, annotation_set_id: "set-e" },
  ]);
  assert.deepEqual(targets.map((target) => target.direction), ["N", "E", "S", "W"]);
  assert.equal(targets.length, 4);
});

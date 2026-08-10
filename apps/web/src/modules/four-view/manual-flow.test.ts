import assert from "node:assert/strict";
import test from "node:test";
import {
  ManualOperationGate,
  cornerGeometryError,
  defaultManualCorners,
  runManualOperation,
} from "./manual-flow";

test("acepta cuatro puntos válidos y rechaza puntos cruzados", () => {
  const valid = defaultManualCorners(1500, 2000);
  assert.equal(cornerGeometryError(valid, 1500, 2000), null);
  assert.match(
    cornerGeometryError([valid[0], valid[2], valid[1], valid[3]], 1500, 2000) ?? "",
    /convexo|cruces/,
  );
});

test("una confirmación manual termina analizada", async () => {
  const gate = new ManualOperationGate();
  let status = "Cuatro puntos listos";
  const outcome = await runManualOperation({
    gate,
    key: "N",
    request: async () => ({ status: "provisional_ai" }),
    onStart: () => { status = "Procesando análisis"; },
    onSuccess: () => { status = "Analizada"; },
    onError: () => { status = "Error recuperable"; },
  });
  assert.equal(outcome, "success");
  assert.equal(status, "Analizada");
});

test("un error conserva puntos y permite un reintento exitoso", async () => {
  const gate = new ManualOperationGate();
  const corners = defaultManualCorners(1500, 2000);
  const state = { status: "Cuatro puntos listos", corners, error: "" };
  const failed = await runManualOperation({
    gate,
    key: "E",
    request: async () => { throw new Error("Geometría rechazada"); },
    onStart: () => { state.status = "Procesando análisis"; },
    onSuccess: () => { state.status = "Analizada"; },
    onError: (error) => { state.status = "Error recuperable"; state.error = error.message; },
  });
  assert.equal(failed, "error");
  assert.equal(state.corners, corners);
  assert.equal(state.error, "Geometría rechazada");

  const retried = await runManualOperation({
    gate,
    key: "E",
    request: async () => ({ status: "provisional_ai" }),
    onStart: () => { state.status = "Procesando análisis"; },
    onSuccess: () => { state.status = "Analizada"; },
    onError: () => { state.status = "Error recuperable"; },
  });
  assert.equal(retried, "success");
  assert.equal(state.status, "Analizada");
  assert.equal(state.corners, corners);
});

test("un clic doble no crea solicitudes duplicadas", async () => {
  const gate = new ManualOperationGate();
  let resolve!: (value: string) => void;
  let requests = 0;
  const first = runManualOperation({
    gate,
    key: "S",
    request: () => { requests += 1; return new Promise<string>((done) => { resolve = done; }); },
    onStart: () => undefined,
    onSuccess: () => undefined,
    onError: () => undefined,
  });
  const duplicate = await runManualOperation({
    gate,
    key: "S",
    request: async () => { requests += 1; return "duplicate"; },
    onStart: () => undefined,
    onSuccess: () => undefined,
    onError: () => undefined,
  });
  assert.equal(duplicate, "duplicate");
  assert.equal(requests, 1);
  resolve("ok");
  assert.equal(await first, "success");
});

test("un resultado obsoleto no sobrescribe una solicitud nueva", async () => {
  const gate = new ManualOperationGate();
  let resolveOld!: (value: string) => void;
  let applied = "";
  const oldRequest = runManualOperation({
    gate,
    key: "W",
    request: () => new Promise<string>((done) => { resolveOld = done; }),
    onStart: () => undefined,
    onSuccess: (value) => { applied = value; },
    onError: () => undefined,
  });
  gate.invalidate("W");
  const current = await runManualOperation({
    gate,
    key: "W",
    request: async () => "new",
    onStart: () => undefined,
    onSuccess: (value) => { applied = value; },
    onError: () => undefined,
  });
  resolveOld("old");
  assert.equal(current, "success");
  assert.equal(await oldRequest, "stale");
  assert.equal(applied, "new");
});

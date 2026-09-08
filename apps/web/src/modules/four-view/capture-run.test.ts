import { strict as assert } from "node:assert";
import test from "node:test";
import { runSeriesCapture, runSingleViewRetry, type RunSlot, type SeriesRunServices } from "./capture-run.ts";
import type { StoredViewIdentity } from "./capture-flow.ts";
import { DIRECTIONS, type Direction } from "./types.ts";

// Simulated services: no browser, no Supabase, no vision model. They record the
// exact order of the calls so the "four saved photographs before any inference"
// rule can be asserted.
interface Recorded {
  calls: string[];
  stored: Direction[];
  analyzed: Direction[];
}

function emptySlot(): RunSlot<string> {
  return { file: null, view: null, requestKey: crypto.randomUUID(), status: "empty", analyzed: false };
}

function selectedSlot(): RunSlot<string> {
  return { file: "foto.jpg", view: null, requestKey: crypto.randomUUID(), status: "ready", analyzed: false };
}

function storedSlot(direction: Direction, seriesId = "serie-1"): RunSlot<string> {
  return {
    file: null,
    view: { viewId: `view-${direction}`, imageId: `img-${direction}`, seriesId },
    requestKey: crypto.randomUUID(),
    status: "stored",
    analyzed: false,
  };
}

function slots(overrides: Partial<Record<Direction, RunSlot<string>>>): Record<Direction, RunSlot<string>> {
  return {
    N: emptySlot(),
    E: emptySlot(),
    S: emptySlot(),
    W: emptySlot(),
    ...overrides,
  } as Record<Direction, RunSlot<string>>;
}

function services(
  recorded: Recorded,
  options: {
    failUploadOn?: Direction;
    failPrepareOn?: Direction;
    failAnalysisOn?: Direction;
    seriesId?: string;
  } = {},
): SeriesRunServices<string> {
  const seriesId = options.seriesId ?? "serie-1";
  return {
    ensureContext: async () => {
      recorded.calls.push("ensureContext");
      return { treeSampleId: "muestra-1", seriesId };
    },
    storeView: async (direction): Promise<StoredViewIdentity> => {
      recorded.calls.push(`store:${direction}`);
      if (options.failUploadOn === direction) throw new Error("No se pudo subir la fotografía.");
      recorded.stored.push(direction);
      return { viewId: `view-${direction}`, imageId: `img-${direction}`, seriesId };
    },
    prepareView: async (direction) => {
      recorded.calls.push(`prepare:${direction}`);
      if (options.failPrepareOn === direction) throw new Error("No se pudo preparar la fotografía.");
    },
    analyzeView: async (direction) => {
      recorded.calls.push(`analyze:${direction}`);
      if (options.failAnalysisOn === direction) throw new Error("La IA no respondió.");
      recorded.analyzed.push(direction);
      return "usable";
    },
    finalize: async () => {
      recorded.calls.push("finalize");
    },
  };
}

function callbacks(overrides: Partial<{
  isCurrentRequest: (direction: Direction, requestKey: string) => boolean;
  isCurrentContext: () => boolean;
}> = {}) {
  const statuses: string[] = [];
  const errors: string[] = [];
  return {
    statuses,
    errors,
    handlers: {
      onSlotStatus: (direction: Direction, _requestKey: string, status: string) => {
        statuses.push(`${direction}:${status}`);
      },
      onStoredView: () => undefined,
      isCurrentRequest: overrides.isCurrentRequest ?? (() => true),
      isCurrentContext: overrides.isCurrentContext ?? (() => true),
      onError: (message: string) => errors.push(message),
    },
  };
}

function recorder(): Recorded {
  return { calls: [], stored: [], analyzed: [] };
}

test("con 1, 2 o 3 fotografías no se ejecuta ninguna inferencia", async () => {
  for (const count of [1, 2, 3]) {
    const chosen: Partial<Record<Direction, RunSlot<string>>> = {};
    DIRECTIONS.slice(0, count).forEach((direction) => {
      chosen[direction] = selectedSlot();
    });
    const recorded = recorder();
    const events = callbacks();
    const result = await runSeriesCapture(slots(chosen), services(recorded), events.handlers);
    assert.equal(result.uploadsCompleted, false);
    assert.equal(result.analysisStarted, false);
    assert.equal(recorded.analyzed.length, 0);
    assert.ok(!recorded.calls.some((call) => call.startsWith("analyze:")));
    assert.ok(!recorded.calls.includes("finalize"));
    assert.ok(events.errors.length > 0);
  }
});

test("con las cuatro fotografías se guardan las cuatro antes de la primera inferencia", async () => {
  const recorded = recorder();
  const events = callbacks();
  const result = await runSeriesCapture(
    slots({ N: selectedSlot(), E: selectedSlot(), S: selectedSlot(), W: selectedSlot() }),
    services(recorded),
    events.handlers,
  );
  assert.equal(result.uploadsCompleted, true);
  assert.equal(result.completed, true);
  assert.deepEqual(result.analyzed, ["N", "E", "S", "W"]);
  const firstAnalysis = recorded.calls.findIndex((call) => call.startsWith("analyze:"));
  const lastUpload = recorded.calls.map((call, index) => (call.startsWith("prepare:") ? index : -1))
    .reduce((max, index) => Math.max(max, index), -1);
  assert.ok(firstAnalysis > lastUpload, "ninguna inferencia empieza antes del último guardado");
  assert.equal(recorded.stored.length, 4);
  // La inferencia sigue siendo serial.
  const analyses = recorded.calls.filter((call) => call.startsWith("analyze:"));
  assert.deepEqual(analyses, ["analyze:N", "analyze:E", "analyze:S", "analyze:W"]);
  assert.equal(recorded.calls.filter((call) => call === "finalize").length, 1);
});

test("una carga fallida impide la inferencia de toda la serie y conserva lo guardado", async () => {
  const recorded = recorder();
  const events = callbacks();
  const result = await runSeriesCapture(
    slots({ N: selectedSlot(), E: selectedSlot(), S: selectedSlot(), W: selectedSlot() }),
    services(recorded, { failUploadOn: "S" }),
    events.handlers,
  );
  assert.equal(result.uploadsCompleted, false);
  assert.equal(result.analysisStarted, false);
  assert.deepEqual(result.uploadFailures, ["S"]);
  assert.equal(recorded.analyzed.length, 0);
  // Las otras tres fotografías siguen guardadas: no hay que rehacer la captura.
  assert.deepEqual(recorded.stored, ["N", "E", "W"]);
  assert.ok(events.statuses.includes("S:error"));
  assert.ok(events.errors.some((message) => /no empieza/.test(message)));
});

test("reintentar reutiliza los originales guardados y no duplica registros", async () => {
  const recorded = recorder();
  const events = callbacks();
  const result = await runSeriesCapture(
    slots({
      N: storedSlot("N"),
      E: storedSlot("E"),
      S: selectedSlot(),
      W: storedSlot("W"),
    }),
    services(recorded),
    events.handlers,
  );
  assert.equal(result.completed, true);
  // Solo se vuelve a subir la vista que faltaba.
  assert.deepEqual(recorded.stored, ["S"]);
  assert.equal(recorded.calls.filter((call) => call.startsWith("store:")).length, 1);
  assert.equal(recorded.analyzed.length, 4);
});

test("una vista ya analizada no se vuelve a analizar al reintentar", async () => {
  const recorded = recorder();
  const events = callbacks();
  const analyzedSlot = { ...storedSlot("N"), analyzed: true };
  await runSeriesCapture(
    slots({ N: analyzedSlot, E: storedSlot("E"), S: storedSlot("S"), W: storedSlot("W") }),
    services(recorded),
    events.handlers,
  );
  assert.deepEqual(recorded.analyzed, ["E", "S", "W"]);
  assert.equal(recorded.stored.length, 0);
});

test("una respuesta tardía de una foto reemplazada no se aplica ni se analiza", async () => {
  const recorded = recorder();
  const events = callbacks({ isCurrentRequest: (direction) => direction !== "E" });
  const result = await runSeriesCapture(
    slots({ N: selectedSlot(), E: selectedSlot(), S: selectedSlot(), W: selectedSlot() }),
    services(recorded),
    events.handlers,
  );
  // La vista reemplazada no cuenta como guardada, así que la serie no se analiza.
  assert.equal(result.uploadsCompleted, false);
  assert.equal(recorded.analyzed.length, 0);
  assert.ok(!events.statuses.includes("E:stored"));
});

test("cambiar de árbol durante la ejecución detiene el trabajo sin escribir en el nuevo contexto", async () => {
  const recorded = recorder();
  let valid = true;
  const events = callbacks({ isCurrentContext: () => valid });
  const running = runSeriesCapture(
    slots({ N: selectedSlot(), E: selectedSlot(), S: selectedSlot(), W: selectedSlot() }),
    {
      ...services(recorded),
      storeView: async (direction) => {
        recorded.calls.push(`store:${direction}`);
        if (direction === "E") valid = false;
        recorded.stored.push(direction);
        return { viewId: `view-${direction}`, imageId: `img-${direction}`, seriesId: "serie-1" };
      },
    },
    events.handlers,
  );
  const result = await running;
  assert.equal(result.analysisStarted, false);
  assert.equal(recorded.analyzed.length, 0);
  assert.ok(!recorded.calls.includes("finalize"));
});

test("un contexto obsoleto impide incluso empezar a guardar", async () => {
  const recorded = recorder();
  const events = callbacks({ isCurrentContext: () => false });
  const result = await runSeriesCapture(
    slots({ N: selectedSlot(), E: selectedSlot(), S: selectedSlot(), W: selectedSlot() }),
    services(recorded),
    events.handlers,
  );
  assert.equal(result.uploadsCompleted, false);
  assert.deepEqual(recorded.calls, ["ensureContext"]);
});

test("un fallo de inferencia conserva las fotografías guardadas y los resultados válidos", async () => {
  const recorded = recorder();
  const events = callbacks();
  const result = await runSeriesCapture(
    slots({ N: selectedSlot(), E: selectedSlot(), S: selectedSlot(), W: selectedSlot() }),
    services(recorded, { failAnalysisOn: "S" }),
    events.handlers,
  );
  assert.equal(result.uploadsCompleted, true);
  assert.deepEqual(result.analyzed, ["N", "E", "W"]);
  assert.equal(recorded.stored.length, 4);
  assert.ok(events.statuses.includes("S:error"));
  // El resumen de la serie se actualiza igualmente con lo que sí es válido.
  assert.ok(recorded.calls.includes("finalize"));
});

test("las fotografías de otra serie no se aceptan como parte de esta", async () => {
  const recorded = recorder();
  const events = callbacks();
  const result = await runSeriesCapture(
    slots({
      N: storedSlot("N"),
      E: storedSlot("E"),
      S: storedSlot("S"),
      W: storedSlot("W", "serie-de-otro-arbol"),
    }),
    services(recorded),
    events.handlers,
  );
  assert.equal(result.uploadsCompleted, false);
  assert.equal(recorded.analyzed.length, 0);
  assert.ok(events.errors.some((message) => /no pertenecen/.test(message)));
});

test("una vista ya guardada vuelve a prepararse antes de cualquier inferencia", async () => {
  const recorded = recorder();
  const events = callbacks();
  const result = await runSeriesCapture(
    slots({ N: storedSlot("N"), E: storedSlot("E"), S: storedSlot("S"), W: storedSlot("W") }),
    services(recorded),
    events.handlers,
  );
  assert.equal(result.completed, true);
  // No se vuelve a subir el original, pero sí se revalida su derivado.
  assert.equal(recorded.calls.filter((call) => call.startsWith("store:")).length, 0);
  assert.deepEqual(result.prepared, ["N", "E", "S", "W"]);
  const firstAnalysis = recorded.calls.findIndex((call) => call.startsWith("analyze:"));
  const lastPrepare = recorded.calls.map((call, index) => (call.startsWith("prepare:") ? index : -1))
    .reduce((max, index) => Math.max(max, index), -1);
  assert.ok(firstAnalysis > lastPrepare, "ninguna inferencia empieza antes de preparar las cuatro");
});

test("una preparación fallida conserva el original pero impide la inferencia de la serie", async () => {
  const recorded = recorder();
  const events = callbacks();
  const result = await runSeriesCapture(
    slots({ N: selectedSlot(), E: selectedSlot(), S: selectedSlot(), W: selectedSlot() }),
    services(recorded, { failPrepareOn: "N" }),
    events.handlers,
  );
  assert.equal(result.analysisStarted, false);
  assert.ok(!recorded.calls.some((call) => call.startsWith("analyze:")));
  assert.deepEqual(result.uploadFailures, ["N"]);
  // El original sí quedó guardado: el siguiente intento no pide otra fotografía.
  assert.deepEqual(recorded.stored, ["N", "E", "S", "W"]);
  assert.ok(events.statuses.includes("N:error"));
});

test("tras una preparación fallida el reintento la revalida y no analiza si vuelve a fallar", async () => {
  const recorded = recorder();
  const events = callbacks();
  const restored = slots({
    N: { ...storedSlot("N"), status: "error" },
    E: storedSlot("E"),
    S: storedSlot("S"),
    W: storedSlot("W"),
  });
  const result = await runSeriesCapture(restored, services(recorded, { failPrepareOn: "N" }), events.handlers);
  assert.ok(recorded.calls.includes("prepare:N"), "el reintento revalida el derivado que falló");
  assert.equal(result.analysisStarted, false);
  assert.ok(!recorded.calls.some((call) => call.startsWith("analyze:")));
});

test("cambiar de contexto durante la carga no lanza las cargas siguientes", async () => {
  const recorded = recorder();
  let valid = true;
  const events = callbacks({ isCurrentContext: () => valid });
  const result = await runSeriesCapture(
    slots({ N: selectedSlot(), E: selectedSlot(), S: selectedSlot(), W: selectedSlot() }),
    {
      ...services(recorded),
      storeView: async (direction) => {
        recorded.calls.push(`store:${direction}`);
        if (direction === "N") valid = false;
        recorded.stored.push(direction);
        return { viewId: `view-${direction}`, imageId: `img-${direction}`, seriesId: "serie-1" };
      },
    },
    events.handlers,
  );
  assert.deepEqual(recorded.calls, ["ensureContext", "store:N"]);
  assert.equal(result.uploadsCompleted, false);
  assert.ok(!recorded.calls.includes("finalize"));
});

test("cambiar de contexto durante la primera inferencia no analiza las demás vistas", async () => {
  const recorded = recorder();
  let valid = true;
  const events = callbacks({ isCurrentRequest: () => true, isCurrentContext: () => valid });
  const result = await runSeriesCapture(
    slots({ N: selectedSlot(), E: selectedSlot(), S: selectedSlot(), W: selectedSlot() }),
    {
      ...services(recorded),
      analyzeView: async (direction) => {
        recorded.calls.push(`analyze:${direction}`);
        if (direction === "N") valid = false;
        recorded.analyzed.push(direction);
        return "usable";
      },
    },
    events.handlers,
  );
  assert.deepEqual(recorded.calls.filter((call) => call.startsWith("analyze:")), ["analyze:N"]);
  assert.ok(!recorded.calls.includes("finalize"));
  assert.deepEqual(result.analyzed, []);
  assert.equal(result.completed, false);
});

// El botón «Reintentar solo esta vista» llama exactamente a este adaptador, así
// que las reglas de la serie se comprueban aquí, no solo en un helper suelto.
test("el reintento por vista no analiza nada si falta una fotografía de la serie", async () => {
  const recorded = recorder();
  const events = callbacks();
  const result = await runSingleViewRetry(
    "N",
    slots({ N: storedSlot("N"), E: storedSlot("E"), S: storedSlot("S") }),
    services(recorded),
    events.handlers,
  );
  assert.equal(result.analysisStarted, false);
  assert.ok(!recorded.calls.some((call) => call.startsWith("analyze:")));
  assert.ok(!recorded.calls.includes("finalize"));
  assert.ok(events.errors.length > 0);
});

test("el reintento por vista no analiza si falla la preparación de otra vista", async () => {
  const recorded = recorder();
  const events = callbacks();
  const result = await runSingleViewRetry(
    "N",
    slots({ N: storedSlot("N"), E: storedSlot("E"), S: storedSlot("S"), W: storedSlot("W") }),
    services(recorded, { failPrepareOn: "S" }),
    events.handlers,
  );
  assert.equal(result.analysisStarted, false);
  assert.ok(!recorded.calls.some((call) => call.startsWith("analyze:")));
  // El original de la vista que falló se conserva: no se pide otra fotografía.
  assert.equal(recorded.calls.filter((call) => call.startsWith("store:")).length, 0);
  assert.ok(events.statuses.includes("S:error"));
});

test("con las cuatro preparadas el reintento analiza solo la vista elegida", async () => {
  const recorded = recorder();
  const events = callbacks();
  const analyzed = (direction: Direction) => ({ ...storedSlot(direction), analyzed: true });
  const result = await runSingleViewRetry(
    "S",
    slots({ N: analyzed("N"), E: analyzed("E"), S: storedSlot("S"), W: analyzed("W") }),
    services(recorded),
    events.handlers,
  );
  assert.equal(result.completed, true);
  assert.deepEqual(recorded.calls.filter((call) => call.startsWith("analyze:")), ["analyze:S"]);
  // Ni re-subida de originales ni recálculo de las propuestas ya válidas.
  assert.equal(recorded.calls.filter((call) => call.startsWith("store:")).length, 0);
  assert.deepEqual(result.prepared, ["S"]);
  assert.ok(recorded.calls.includes("finalize"));
});

test("el reintento revalida el proxy de la vista elegida aunque ya tuviera resultado", async () => {
  const recorded = recorder();
  const events = callbacks();
  const analyzed = (direction: Direction) => ({ ...storedSlot(direction), analyzed: true });
  await runSingleViewRetry(
    "N",
    slots({ N: analyzed("N"), E: analyzed("E"), S: analyzed("S"), W: analyzed("W") }),
    services(recorded),
    events.handlers,
  );
  assert.deepEqual(recorded.calls.filter((call) => call.startsWith("prepare:")), ["prepare:N"]);
  assert.deepEqual(recorded.calls.filter((call) => call.startsWith("analyze:")), ["analyze:N"]);
});

test("un rechazo al abrir la serie no lanza ninguna carga ni inferencia", async () => {
  const recorded = recorder();
  const events = callbacks();
  const result = await runSeriesCapture(
    slots({ N: selectedSlot(), E: selectedSlot(), S: selectedSlot(), W: selectedSlot() }),
    {
      ...services(recorded),
      ensureContext: async () => {
        recorded.calls.push("ensureContext");
        throw new Error("El contexto cambió antes de abrir la serie de este árbol.");
      },
    },
    events.handlers,
  );
  assert.deepEqual(recorded.calls, ["ensureContext"]);
  assert.equal(result.uploadsCompleted, false);
  assert.ok(events.errors.some((message) => /contexto/.test(message)));
});

test("un rechazo de carga por cambio de contexto detiene la fase de guardado", async () => {
  const recorded = recorder();
  let valid = true;
  const events = callbacks({ isCurrentContext: () => valid });
  const result = await runSeriesCapture(
    slots({ N: selectedSlot(), E: selectedSlot(), S: selectedSlot(), W: selectedSlot() }),
    {
      ...services(recorded),
      storeView: async (direction) => {
        recorded.calls.push(`store:${direction}`);
        valid = false;
        throw new Error("La subida se interrumpió.");
      },
    },
    events.handlers,
  );
  assert.deepEqual(recorded.calls, ["ensureContext", "store:N"]);
  assert.equal(result.analysisStarted, false);
});

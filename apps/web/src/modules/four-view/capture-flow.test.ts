import { strict as assert } from "node:assert";
import test from "node:test";
import {
  SeriesAnalysisGate,
  captureProgress,
  captureProgressLabel,
  contextMatchesTree,
  describeFailure,
  evaluateSeriesReadiness,
  isStaleSlotResponse,
  readySlotCount,
  restoredSlotStatus,
  safeDiagnosticDetail,
  seriesAttemptSignature,
  sharedSeriesAnalysisGate,
  slotStatusLabel,
  summarizeCaptureContext,
  verifyStoredSeries,
  type SlotSnapshot,
} from "./capture-flow.ts";
import { DIRECTIONS, type Direction } from "./types.ts";

const empty: SlotSnapshot = { status: "empty", hasPhoto: false, hasStoredView: false, hasResult: false };
const ready: SlotSnapshot = { status: "ready", hasPhoto: true, hasStoredView: false, hasResult: false };
const stored: SlotSnapshot = { status: "stored", hasPhoto: true, hasStoredView: true, hasResult: false };
const saved: SlotSnapshot = { status: "saved", hasPhoto: true, hasStoredView: true, hasResult: true };

function slots(overrides: Partial<Record<Direction, SlotSnapshot>> = {}): Record<Direction, SlotSnapshot> {
  return {
    N: empty,
    E: empty,
    S: empty,
    W: empty,
    ...overrides,
  };
}

test("con 0, 1, 2 o 3 vistas listas no empieza el análisis de la serie", () => {
  const filled: Partial<Record<Direction, SlotSnapshot>> = {};
  for (let count = 0; count < 4; count += 1) {
    const readiness = evaluateSeriesReadiness(slots(filled));
    assert.equal(readiness.ready, false);
    assert.equal(readiness.readyCount, count);
    assert.ok(readiness.reason);
    filled[DIRECTIONS[count]] = ready;
  }
});

test("con las cuatro vistas listas la serie queda habilitada", () => {
  const readiness = evaluateSeriesReadiness(slots({ N: ready, E: ready, S: saved, W: ready }));
  assert.equal(readiness.ready, true);
  assert.equal(readiness.readyCount, 4);
  assert.equal(readiness.reason, null);
  assert.deepEqual(readiness.missing, []);
});

test("una carga fallida impide tratar la serie como completa", () => {
  const readiness = evaluateSeriesReadiness(slots({
    N: ready,
    E: ready,
    S: ready,
    W: { status: "error", hasPhoto: true, hasStoredView: false, hasResult: false },
  }));
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing, ["W"]);
  assert.match(readiness.reason ?? "", /Oeste/);
});

test("una vista pendiente de calibración manual mantiene bloqueada la serie", () => {
  const readiness = evaluateSeriesReadiness(slots({
    N: ready,
    E: ready,
    S: ready,
    W: { status: "needs_confirmation", hasPhoto: true, hasStoredView: true, hasResult: false },
  }));
  assert.equal(readiness.ready, false);
  assert.match(readiness.reason ?? "", /revisión/);
});

test("una carga en curso no habilita el análisis aunque haya cuatro fotografías", () => {
  const readiness = evaluateSeriesReadiness(slots({
    N: { status: "saving_original", hasPhoto: true, hasStoredView: false, hasResult: false },
    E: ready,
    S: ready,
    W: ready,
  }));
  assert.equal(readiness.ready, false);
  assert.match(readiness.reason ?? "", /preparando/i);
  assert.equal(readySlotCount(slots({ E: ready, S: ready, W: ready })), 3);
  assert.equal(
    captureProgressLabel(captureProgress(slots({ E: ready, S: ready, W: ready }))),
    "3 de 4 fotografías seleccionadas · 0 guardadas · 0 analizadas",
  );
});

test("con las cuatro vistas listas el análisis empieza una sola vez", () => {
  const gate = new SeriesAnalysisGate();
  const signature = seriesAttemptSignature("series-1", { N: "a", E: "b", S: "c", W: "d" });
  assert.equal(gate.begin(signature), true);
  // Doble clic y efectos de React durante la ejecución.
  assert.equal(gate.begin(signature), false);
  gate.finish(signature, true);
  // Un nuevo render o una recarga no vuelven a lanzarlo.
  assert.equal(gate.begin(signature), false);
});

test("reintentar no duplica registros ni análisis y respeta la identidad de la serie", () => {
  const gate = new SeriesAnalysisGate();
  const signature = seriesAttemptSignature("series-1", { N: "a", E: "b", S: "c", W: "d" });
  assert.equal(gate.begin(signature), true);
  gate.finish(signature, false);
  // Un fallo permite reintentar manualmente con las mismas fotografías…
  assert.equal(gate.begin(signature), true);
  gate.finish(signature, true);
  assert.equal(gate.begin(signature), false);
  // …y al reemplazar una fotografía la firma cambia, así que es otro intento.
  const replaced = seriesAttemptSignature("series-1", { N: "a2", E: "b", S: "c", W: "d" });
  assert.notEqual(replaced, signature);
  assert.equal(gate.begin(replaced), true);
});

test("reemplazar una imagen invalida las respuestas antiguas de esa vista", () => {
  assert.equal(isStaleSlotResponse("nueva", "antigua"), true);
  assert.equal(isStaleSlotResponse("nueva", "nueva"), false);
});

test("un fallo de carga se distingue de un fallo de análisis y conserva lo válido", () => {
  const upload = describeFailure("upload", "network error while uploading");
  assert.equal(upload.retriable, true);
  assert.match(upload.message, /sigue en tu dispositivo/);
  const analysis = describeFailure("analysis", "La IA no está disponible en este momento.");
  assert.equal(analysis.retriable, true);
  assert.match(analysis.message, /quedó guardada/);
  assert.notEqual(upload.message, analysis.message);
});

test("un problema permanente no se presenta como recuperable", () => {
  const failure = describeFailure("upload", "El formato del archivo es incompatible.");
  assert.equal(failure.retriable, false);
  // No hay reintentos automáticos en el flujo: la recuperación es siempre
  // explícita, por vista o por serie.
  const transient = describeFailure("analysis", "Se agotó el tiempo de espera del servicio.");
  assert.equal(transient.retriable, true);
});

test("los detalles de diagnóstico no exponen enlaces firmados ni tokens", () => {
  const detail = safeDiagnosticDetail(
    "fallo en https://storage.example.com/o/foto.jpg?token=abc123 con signature=xyz",
  );
  assert.ok(detail);
  assert.doesNotMatch(detail!, /abc123/);
  assert.doesNotMatch(detail!, /https:\/\//);
  assert.match(detail!, /signature=\[omitido\]/);
});

test("el contexto se muestra con nombres comprensibles y nunca con UUID", () => {
  const entries = summarizeCaptureContext({
    project: "Proyecto Norte",
    site: "Parque Mirador",
    event: "Jornada 2026-03-04",
    tree: "550e8400-e29b-41d4-a716-446655440000",
  });
  assert.deepEqual(entries.map((entry) => entry.label), ["Proyecto", "Sitio", "Jornada", "Árbol"]);
  assert.equal(entries[3].value, "Sin nombre disponible");
  assert.equal(entries[0].value, "Proyecto Norte");
});

test("el contexto de un árbol no se mezcla con otro", () => {
  const base = { projectId: "p", siteId: "s", eventId: "e", treeId: "t1", treeSampleId: "ts1" };
  assert.equal(contextMatchesTree(base, { ...base }), true);
  assert.equal(contextMatchesTree(base, { ...base, treeId: "t2" }), false);
  assert.equal(contextMatchesTree(base, { ...base, treeSampleId: "ts2" }), false);
  assert.equal(contextMatchesTree(base, null), false);
});

test("siguiente árbol conserva proyecto, sitio y jornada y solo cambia el árbol", () => {
  const previous = { projectId: "p", siteId: "s", eventId: "e", treeId: "t1", treeSampleId: "ts1" };
  const next = { ...previous, treeId: "t2", treeSampleId: "ts2" };
  assert.equal(next.projectId, previous.projectId);
  assert.equal(next.siteId, previous.siteId);
  assert.equal(next.eventId, previous.eventId);
  assert.equal(contextMatchesTree(previous, next), false);
});

test("los estados se nombran en español sencillo", () => {
  assert.equal(slotStatusLabel(empty), "Falta fotografía");
  assert.equal(slotStatusLabel({ status: "saving_original", hasPhoto: true, hasStoredView: false, hasResult: false }), "Subiendo");
  assert.equal(slotStatusLabel({ status: "preparing_ai", hasPhoto: true, hasStoredView: false, hasResult: false }), "Preparando fotografía");
  assert.equal(slotStatusLabel(ready), "Lista para guardar");
  assert.equal(slotStatusLabel(stored), "Fotografía guardada; falta analizar");
  assert.equal(slotStatusLabel({ status: "analyzing", hasPhoto: true, hasStoredView: true, hasResult: false }), "Analizando");
  assert.equal(slotStatusLabel({ status: "needs_confirmation", hasPhoto: true, hasStoredView: true, hasResult: false }), "Requiere revisión");
  assert.equal(slotStatusLabel(saved), "Completado");
  assert.equal(slotStatusLabel({ status: "error", hasPhoto: true, hasStoredView: false, hasResult: false }), "No se pudo completar");
});

test("las fotografías guardadas no desaparecen del progreso cuando requieren revisión", () => {
  const review: SlotSnapshot = {
    status: "four_points_ready",
    hasPhoto: true,
    hasStoredView: true,
    hasResult: false,
  };
  const progress = captureProgress(slots({ N: saved, E: saved, S: review, W: review }));
  assert.equal(progress.selected, 4);
  assert.equal(progress.stored, 4);
  assert.equal(progress.processed, 2);
  assert.equal(progress.needsReview, 2);
  assert.equal(
    captureProgressLabel(progress),
    "4 de 4 fotografías seleccionadas · 4 guardadas · 2 analizadas · 2 requieren revisión",
  );
});

test("el progreso no se contradice mientras una vista se está analizando", () => {
  const analyzing: SlotSnapshot = {
    status: "processing",
    hasPhoto: true,
    hasStoredView: true,
    hasResult: false,
  };
  const progress = captureProgress(slots({ N: analyzing, E: stored, S: stored, W: stored }));
  assert.equal(progress.selected, 4);
  assert.equal(progress.stored, 4);
  assert.equal(progress.processed, 0);
  assert.equal(progress.failed, 0);
});

test("la inferencia exige cuatro originales guardados de la misma serie", () => {
  const identity = (viewId: string, seriesId = "serie-1") => ({
    viewId,
    imageId: `img-${viewId}`,
    seriesId,
  });
  const complete = verifyStoredSeries(
    { N: identity("n"), E: identity("e"), S: identity("s"), W: identity("w") },
    "serie-1",
  );
  assert.equal(complete.ok, true);
  const incomplete = verifyStoredSeries(
    { N: identity("n"), E: identity("e"), S: identity("s"), W: null },
    "serie-1",
  );
  assert.equal(incomplete.ok, false);
  assert.deepEqual(incomplete.missing, ["W"]);
  assert.match(incomplete.reason ?? "", /no empieza/);
  const foreign = verifyStoredSeries(
    { N: identity("n"), E: identity("e"), S: identity("s"), W: identity("w", "serie-2") },
    "serie-1",
  );
  assert.equal(foreign.ok, false);
  assert.deepEqual(foreign.mismatched, ["W"]);
});

test("al reabrir la misma serie las fotografías guardadas no se muestran como ausentes", () => {
  assert.equal(
    restoredSlotStatus({ hasStoredView: true, hasUsableResult: true, repeat: false, hasCornerProposal: false }),
    "saved",
  );
  assert.equal(
    restoredSlotStatus({ hasStoredView: true, hasUsableResult: false, repeat: false, hasCornerProposal: true }),
    "four_points_ready",
  );
  assert.equal(
    restoredSlotStatus({ hasStoredView: true, hasUsableResult: false, repeat: false, hasCornerProposal: false }),
    "stored",
  );
  assert.equal(
    restoredSlotStatus({ hasStoredView: false, hasUsableResult: false, repeat: false, hasCornerProposal: false }),
    "empty",
  );
});

test("una serie restaurada sigue habilitada para analizarse sin volver a subir nada", () => {
  const readiness = evaluateSeriesReadiness(slots({ N: stored, E: stored, S: stored, W: stored }));
  assert.equal(readiness.ready, true);
  const progress = captureProgress(slots({ N: stored, E: stored, S: stored, W: stored }));
  assert.equal(progress.stored, 4);
  assert.equal(progress.processed, 0);
});

test("la compuerta compartida sobrevive a un remontaje del componente", () => {
  const signature = seriesAttemptSignature("serie-1", { N: "a", E: "b", S: "c", W: "d" });
  const gate = sharedSeriesAnalysisGate();
  gate.reset();
  assert.equal(gate.begin(signature), true);
  gate.finish(signature, true);
  // Una nueva instancia del componente obtiene la misma compuerta.
  assert.equal(sharedSeriesAnalysisGate().begin(signature), false);
  gate.reset();
});

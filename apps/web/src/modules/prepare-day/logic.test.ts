import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContextQuery,
  deriveTreeEvaluationStatus,
  formatLocalDate,
  mergeDraftWithSelection,
  planCreationsForRetry,
  resetIncompatibleSelections,
  suggestSamplingEventName,
  suggestTreeCode,
  treeStatusLabel,
  withPreservedContext,
} from "./logic.ts";

test("formatLocalDate formats a date in local YYYY-MM-DD", () => {
  const date = new Date(2026, 8, 8, 15, 30);
  assert.equal(formatLocalDate(date), "2026-09-08");
});

test("formatLocalDate rejects invalid input", () => {
  assert.throws(() => formatLocalDate(new Date("not-a-date")));
});

test("suggestSamplingEventName uses local ISO date when no collision", () => {
  const suggestion = suggestSamplingEventName(new Date(2026, 8, 8), []);
  assert.equal(suggestion, "Jornada 2026-09-08");
});

test("suggestSamplingEventName appends numeric suffix when the base collides", () => {
  const suggestion = suggestSamplingEventName(new Date(2026, 8, 8), [{ name: "Jornada 2026-09-08" }]);
  assert.equal(suggestion, "Jornada 2026-09-08 (2)");
});

test("suggestSamplingEventName is case-insensitive when detecting collisions", () => {
  const suggestion = suggestSamplingEventName(new Date(2026, 8, 8), [
    { name: "jornada 2026-09-08" },
    { name: "JORNADA 2026-09-08 (2)" },
  ]);
  assert.equal(suggestion, "Jornada 2026-09-08 (3)");
});

test("suggestSamplingEventName ignores empty and whitespace names", () => {
  const suggestion = suggestSamplingEventName(new Date(2026, 8, 8), [{ name: "   " }]);
  assert.equal(suggestion, "Jornada 2026-09-08");
});

test("suggestTreeCode proposes Árbol 001 when no trees exist", () => {
  assert.equal(suggestTreeCode([]), "Árbol 001");
});

test("suggestTreeCode continues from highest existing sequential Árbol code", () => {
  const suggestion = suggestTreeCode([
    { code: "Árbol 001" },
    { code: "Árbol 002" },
    { code: "Árbol 010" },
  ]);
  assert.equal(suggestion, "Árbol 011");
});

test("suggestTreeCode ignores unrelated codes without introducing collisions", () => {
  const suggestion = suggestTreeCode([
    { code: "T-001" },
    { code: "El Sauce" },
    { code: "Árbol 5" },
  ]);
  // Highest matching is "Árbol 5" so suggestion should be "Árbol 006".
  assert.equal(suggestion, "Árbol 006");
});

test("deriveTreeEvaluationStatus returns sin_muestreo when there is no tree sample", () => {
  assert.equal(deriveTreeEvaluationStatus({ hasSample: false }), "sin_muestreo");
});

test("deriveTreeEvaluationStatus returns sin_fotografias when a sample exists but there is no capture series", () => {
  assert.equal(
    deriveTreeEvaluationStatus({ hasSample: true, captureSeries: null }),
    "sin_fotografias",
  );
});

test("deriveTreeEvaluationStatus returns fotografias_pendientes when photos are in progress", () => {
  assert.equal(
    deriveTreeEvaluationStatus({
      hasSample: true,
      captureSeries: { validViewCount: 2, pendingViewCount: 2, status: "capturing" },
    }),
    "fotografias_pendientes",
  );
});

test("deriveTreeEvaluationStatus returns listo_para_revisar when all four views are captured but not confirmed", () => {
  assert.equal(
    deriveTreeEvaluationStatus({
      hasSample: true,
      captureSeries: { validViewCount: 4, pendingViewCount: 0, status: "provisional_ai" },
    }),
    "listo_para_revisar",
  );
});

test("deriveTreeEvaluationStatus returns evaluacion_completada only when the series is explicitly confirmed", () => {
  assert.equal(
    deriveTreeEvaluationStatus({
      hasSample: true,
      captureSeries: {
        validViewCount: 4,
        pendingViewCount: 0,
        status: "confirmed",
        confirmedAt: "2026-09-08T00:00:00Z",
      },
    }),
    "evaluacion_completada",
  );
});

test("deriveTreeEvaluationStatus never marks completada from photos alone", () => {
  // A series that has 4 views but is only marked "provisional_ai" or "processing"
  // must not be reported as completada. The status is derived from
  // confirmation, not from the number of pictures.
  const provisional = deriveTreeEvaluationStatus({
    hasSample: true,
    captureSeries: { validViewCount: 4, pendingViewCount: 0, status: "provisional_ai" },
  });
  assert.notEqual(provisional, "evaluacion_completada");
});

test("deriveTreeEvaluationStatus surfaces requiere_repetir when the series was rejected", () => {
  assert.equal(
    deriveTreeEvaluationStatus({
      hasSample: true,
      captureSeries: { validViewCount: 2, pendingViewCount: 2, status: "needs_retake" },
    }),
    "requiere_repetir",
  );
});

test("treeStatusLabel returns Spanish text for each status", () => {
  assert.equal(treeStatusLabel("sin_muestreo"), "Sin muestrear en esta jornada");
  assert.equal(treeStatusLabel("evaluacion_completada"), "Evaluación completada");
});

test("buildContextQuery encodes only the provided context fields", () => {
  const query = buildContextQuery({ projectId: "p1", siteId: "s1", eventId: "e1", treeSampleId: "ts1" });
  const parsed = new URLSearchParams(query);
  assert.equal(parsed.get("projectId"), "p1");
  assert.equal(parsed.get("siteId"), "s1");
  assert.equal(parsed.get("eventId"), "e1");
  assert.equal(parsed.get("treeSampleId"), "ts1");
});

test("buildContextQuery omits missing fields and returns an empty string when empty", () => {
  assert.equal(buildContextQuery({}), "");
  const query = buildContextQuery({ projectId: "p1", siteId: "s1" });
  const parsed = new URLSearchParams(query);
  assert.equal(parsed.get("projectId"), "p1");
  assert.equal(parsed.get("siteId"), "s1");
  assert.equal(parsed.has("eventId"), false);
});

test("withPreservedContext preserves the context for a page that opens capture", () => {
  const url = withPreservedContext("/images", { projectId: "p1", siteId: "s1", eventId: "e1" });
  assert.match(url, /^\/images\?/);
  const query = new URL(url, "http://example.com").searchParams;
  assert.equal(query.get("projectId"), "p1");
  assert.equal(query.get("siteId"), "s1");
  assert.equal(query.get("eventId"), "e1");
});

test("withPreservedContext merges into an existing query string when the base already has parameters", () => {
  const url = withPreservedContext("/annotations?tool=ai", { treeSampleId: "ts1" });
  const parsed = new URL(url, "http://example.com").searchParams;
  assert.equal(parsed.get("tool"), "ai");
  assert.equal(parsed.get("treeSampleId"), "ts1");
});

test("withPreservedContext returns the base path unchanged when there is no context", () => {
  assert.equal(withPreservedContext("/images/advanced", {}), "/images/advanced");
});

test("resetIncompatibleSelections clears site and event when the project changes", () => {
  const next = resetIncompatibleSelections(
    { projectId: "p1", siteId: "s1", eventId: "e1" },
    "project",
    "p2",
  );
  assert.deepEqual(next, { projectId: "p2", siteId: undefined, eventId: undefined });
});

test("resetIncompatibleSelections clears event when the site changes but keeps the project", () => {
  const next = resetIncompatibleSelections(
    { projectId: "p1", siteId: "s1", eventId: "e1" },
    "site",
    "s2",
  );
  assert.deepEqual(next, { projectId: "p1", siteId: "s2", eventId: undefined });
});

test("resetIncompatibleSelections keeps project and site when only the event changes", () => {
  const next = resetIncompatibleSelections(
    { projectId: "p1", siteId: "s1", eventId: "e1" },
    "event",
    "e2",
  );
  assert.deepEqual(next, { projectId: "p1", siteId: "s1", eventId: "e2" });
});

test("mergeDraftWithSelection restores identifiers persisted from a previous partial failure", () => {
  const merged = mergeDraftWithSelection(
    { projectId: "p1", siteId: "s1" },
    { projectId: undefined, siteId: undefined, eventId: undefined },
  );
  assert.deepEqual(merged, { projectId: "p1", siteId: "s1", eventId: undefined });
});

test("mergeDraftWithSelection prefers the current selection over stale drafts", () => {
  const merged = mergeDraftWithSelection(
    { projectId: "p-old", siteId: "s-old", eventId: "e-old" },
    { projectId: "p-new", siteId: "s-new" },
  );
  assert.equal(merged.projectId, "p-new");
  assert.equal(merged.siteId, "s-new");
  assert.equal(merged.eventId, "e-old");
});

test("mergeDraftWithSelection returns the current selection unchanged when there is no draft", () => {
  const current = { projectId: "p1", siteId: "s1", eventId: "e1" };
  assert.deepEqual(mergeDraftWithSelection(null, current), current);
});

test("planCreationsForRetry skips creation for identifiers already stored in the draft", () => {
  const plan = planCreationsForRetry({
    draft: { projectId: "p1", siteId: "s1" },
    chosenProjectId: undefined,
    chosenSiteId: undefined,
    chosenEventId: undefined,
  });
  assert.deepEqual(plan, { createProject: false, createSite: false, createEvent: true });
});

test("planCreationsForRetry re-uses ids selected by the user without recreating them", () => {
  const plan = planCreationsForRetry({
    draft: null,
    chosenProjectId: "p1",
    chosenSiteId: "s1",
    chosenEventId: "e1",
  });
  assert.deepEqual(plan, { createProject: false, createSite: false, createEvent: false });
});

test("planCreationsForRetry requires creation of anything that has no id yet", () => {
  const plan = planCreationsForRetry({
    draft: null,
    chosenProjectId: undefined,
    chosenSiteId: undefined,
    chosenEventId: undefined,
  });
  assert.deepEqual(plan, { createProject: true, createSite: true, createEvent: true });
});

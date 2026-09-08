import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContextQuery,
  datetimeLocalToIsoString,
  deriveTreeEvaluationStatus,
  formatLocalDate,
  formatLocalDatetimeInputValue,
  mergeDraftWithSelection,
  narrowDraftScope,
  planCreationsForRetry,
  resetIncompatibleSelections,
  resolveHierarchyFromTreeSample,
  suggestSamplingEventName,
  suggestTreeCode,
  treeStatusLabel,
  validateExpectedContext,
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

test("mergeDraftWithSelection prefers the current selection over stale drafts and drops incompatible descendants", () => {
  const merged = mergeDraftWithSelection(
    { projectId: "p-old", siteId: "s-old", eventId: "e-old" },
    { projectId: "p-new", siteId: "s-new" },
  );
  assert.equal(merged.projectId, "p-new");
  assert.equal(merged.siteId, "s-new");
  // Because BOTH the project and the site changed, the draft's event no
  // longer belongs to the new hierarchy and must be discarded.
  assert.equal(merged.eventId, undefined);
});

test("mergeDraftWithSelection drops draft site+event when the current project differs (Bloqueante Chrome)", () => {
  // Scenario reported by QA: draft {projectId: A, siteId: A} + selección
  // {projectId: B, siteId: undefined} used to return "proyecto B con sitio A".
  const merged = mergeDraftWithSelection(
    { projectId: "project-A", siteId: "site-A" },
    { projectId: "project-B" },
  );
  assert.equal(merged.projectId, "project-B");
  assert.equal(merged.siteId, undefined, "site from project A must not be reused under project B");
  assert.equal(merged.eventId, undefined);
});

test("mergeDraftWithSelection drops draft event when the current site differs", () => {
  const merged = mergeDraftWithSelection(
    { projectId: "p1", siteId: "s1", eventId: "e1" },
    { projectId: "p1", siteId: "s2" },
  );
  assert.equal(merged.projectId, "p1");
  assert.equal(merged.siteId, "s2");
  assert.equal(merged.eventId, undefined);
});

test("mergeDraftWithSelection keeps the draft's descendants when the ancestors match", () => {
  // Legitimate partial-failure retry: same project + site as the draft,
  // no event yet chosen — the draft supplies the persisted event.
  const merged = mergeDraftWithSelection(
    { projectId: "p1", siteId: "s1", eventId: "e1" },
    { projectId: "p1", siteId: "s1" },
  );
  assert.deepEqual(merged, { projectId: "p1", siteId: "s1", eventId: "e1" });
});

test("mergeDraftWithSelection returns the current selection unchanged when there is no draft", () => {
  const current = { projectId: "p1", siteId: "s1", eventId: "e1" };
  assert.deepEqual(mergeDraftWithSelection(null, current), current);
});

test("narrowDraftScope keeps everything with keep_all", () => {
  assert.deepEqual(
    narrowDraftScope({ projectId: "p", siteId: "s", eventId: "e" }, "keep_all"),
    { projectId: "p", siteId: "s", eventId: "e" },
  );
});

test("narrowDraftScope drops descendants below project", () => {
  assert.deepEqual(
    narrowDraftScope({ projectId: "p", siteId: "s", eventId: "e" }, "drop_below_project"),
    { projectId: "p" },
  );
});

test("narrowDraftScope drops descendants below site", () => {
  assert.deepEqual(
    narrowDraftScope({ projectId: "p", siteId: "s", eventId: "e" }, "drop_below_site"),
    { projectId: "p", siteId: "s" },
  );
});

test("narrowDraftScope with drop_all discards the whole draft", () => {
  assert.equal(narrowDraftScope({ projectId: "p", siteId: "s" }, "drop_all"), null);
});

test("narrowDraftScope is a no-op on null drafts", () => {
  assert.equal(narrowDraftScope(null, "drop_below_project"), null);
  assert.equal(narrowDraftScope(undefined, "keep_all"), null);
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

// ---------------------------------------------------------------------------
// Datetime-local round-trip tests. Historically the workflow subtracted the
// timezone offset twice, so 2026-09-08T00:30 typed in America/Santo_Domingo
// (UTC-4) was persisted as 2026-09-08T00:30:00Z and shown as the previous day.
// These tests lock in the correct behavior: the input value is interpreted
// as LOCAL time and toISOString() returns the same instant in UTC.
// ---------------------------------------------------------------------------

test("datetimeLocalToIsoString: 2026-09-08T00:30 becomes the same instant in UTC", () => {
  const local = "2026-09-08T00:30";
  const iso = datetimeLocalToIsoString(local);

  // The ISO string represents THE SAME INSTANT as the local input, expressed
  // in UTC. So parsing the ISO string back and formatting it as local time
  // must round-trip to the same "YYYY-MM-DDTHH:mm" value.
  const roundTrip = formatLocalDatetimeInputValue(new Date(iso));
  assert.equal(roundTrip, local, `round-trip failed: ${iso}`);
});

test("datetimeLocalToIsoString: no matter the local zone, the offset is applied only once", () => {
  const local = "2026-09-08T00:30";
  const iso = datetimeLocalToIsoString(local);

  const expectedOffsetMinutes = new Date(local).getTimezoneOffset(); // local minus UTC in minutes (positive when local is behind UTC)
  const parsed = new Date(iso);
  const localComponents = {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
    hour: parsed.getHours(),
    minute: parsed.getMinutes(),
  };
  // The parsed date, when read as local, must equal the original input.
  const expected = new Date(local);
  assert.equal(localComponents.year, expected.getFullYear());
  assert.equal(localComponents.month, expected.getMonth() + 1);
  assert.equal(localComponents.day, expected.getDate());
  assert.equal(localComponents.hour, expected.getHours());
  assert.equal(localComponents.minute, expected.getMinutes());
  // Sanity: the ISO string differs from the local value by exactly the offset.
  const isoMs = parsed.getTime();
  const localMs = expected.getTime();
  assert.equal(isoMs, localMs);
  // The offset must be non-negative if local is behind UTC (Santo Domingo),
  // but the exact sign depends on the runtime TZ. Either way the offset only
  // enters the equation once, which is what this test guards against.
  assert.ok(Number.isFinite(expectedOffsetMinutes));
});

test("datetimeLocalToIsoString: date change on midnight boundary is preserved", () => {
  // 2026-09-08 00:15 must not be persisted as 2026-09-07.
  const local = "2026-09-08T00:15";
  const iso = datetimeLocalToIsoString(local);
  // Reparse and read the LOCAL day — this must always be the 8th, no matter
  // the runtime timezone. This is the exact regression the QA hit in
  // America/Santo_Domingo.
  const parsedLocalDay = new Date(iso).getDate();
  assert.equal(parsedLocalDay, 8);
});

test("datetimeLocalToIsoString rejects blank input", () => {
  assert.throws(() => datetimeLocalToIsoString(""));
  assert.throws(() => datetimeLocalToIsoString("   "));
});

test("datetimeLocalToIsoString rejects garbage input", () => {
  assert.throws(() => datetimeLocalToIsoString("not-a-date"));
});

test("formatLocalDatetimeInputValue produces a 'YYYY-MM-DDTHH:mm' value with local components", () => {
  const date = new Date(2026, 8, 8, 0, 30);
  const value = formatLocalDatetimeInputValue(date);
  assert.equal(value, "2026-09-08T00:30");
});

test("formatLocalDatetimeInputValue rejects invalid dates", () => {
  assert.throws(() => formatLocalDatetimeInputValue(new Date("not-a-date")));
});

// ---------------------------------------------------------------------------
// Hierarchy resolution for the four-view capture screen. Previously the screen
// silently picked the first tree at the site, ignoring the ?treeSampleId
// parameter. These tests use fixtures with several projects, sites, jornadas
// and trees, and verify that the sample id (never the first record) drives
// which tree the user ends up capturing.
// ---------------------------------------------------------------------------

const MULTI_HIERARCHY = {
  projects: [
    { id: "proj-A" },
    { id: "proj-B" },
  ],
  sites: [
    { id: "site-A1", projectId: "proj-A" },
    { id: "site-A2", projectId: "proj-A" },
    { id: "site-B1", projectId: "proj-B" },
  ],
  samplingEvents: [
    { id: "event-A1-Jan", siteId: "site-A1" },
    { id: "event-A1-Feb", siteId: "site-A1" },
    { id: "event-B1-Jan", siteId: "site-B1" },
  ],
  trees: [
    { id: "tree-QA-001", siteId: "site-A1" },
    { id: "tree-QA-002", siteId: "site-A1" },
    { id: "tree-QA-003", siteId: "site-A2" },
    { id: "tree-QA-004", siteId: "site-B1" },
  ],
  treeSamples: [
    { id: "sample-A1-Jan-001", treeId: "tree-QA-001", samplingEventId: "event-A1-Jan", siteId: "site-A1" },
    { id: "sample-A1-Jan-002", treeId: "tree-QA-002", samplingEventId: "event-A1-Jan", siteId: "site-A1" },
    // Same tree in a different jornada — must not duplicate identity.
    { id: "sample-A1-Feb-001", treeId: "tree-QA-001", samplingEventId: "event-A1-Feb", siteId: "site-A1" },
    { id: "sample-A2-Jan-003", treeId: "tree-QA-003", samplingEventId: "event-A1-Jan", siteId: "site-A2" },
    { id: "sample-B1-Jan-004", treeId: "tree-QA-004", samplingEventId: "event-B1-Jan", siteId: "site-B1" },
  ],
} as const;

test("resolveHierarchyFromTreeSample picks the tree pointed to by the sample id (never the first)", () => {
  // The QA-reported bug: URL points to sample-002 but the screen selected the
  // FIRST tree (tree-QA-001). The pure resolver must return tree-QA-002.
  const result = resolveHierarchyFromTreeSample({
    treeSampleId: "sample-A1-Jan-002",
    ...MULTI_HIERARCHY,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.resolved.treeId, "tree-QA-002");
    assert.equal(result.resolved.treeSampleId, "sample-A1-Jan-002");
    assert.equal(result.resolved.eventId, "event-A1-Jan");
    assert.equal(result.resolved.siteId, "site-A1");
    assert.equal(result.resolved.projectId, "proj-A");
  }
});

test("resolveHierarchyFromTreeSample allows the same tree in a different jornada", () => {
  // Same tree, two different sampling events. Selecting the February sample
  // must resolve to the same tree.id but a different eventId.
  const jan = resolveHierarchyFromTreeSample({
    treeSampleId: "sample-A1-Jan-001",
    ...MULTI_HIERARCHY,
  });
  const feb = resolveHierarchyFromTreeSample({
    treeSampleId: "sample-A1-Feb-001",
    ...MULTI_HIERARCHY,
  });
  assert.equal(jan.ok && feb.ok, true);
  if (jan.ok && feb.ok) {
    assert.equal(jan.resolved.treeId, feb.resolved.treeId, "tree identity is preserved across jornadas");
    assert.notEqual(jan.resolved.eventId, feb.resolved.eventId);
    assert.notEqual(jan.resolved.treeSampleId, feb.resolved.treeSampleId);
  }
});

test("resolveHierarchyFromTreeSample returns an error when the sample does not exist", () => {
  const result = resolveHierarchyFromTreeSample({
    treeSampleId: "sample-that-does-not-exist",
    ...MULTI_HIERARCHY,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /muestra/);
  }
});

test("resolveHierarchyFromTreeSample rejects a cross-site inconsistency instead of silently picking a tree", () => {
  // Broken fixture: sample says siteId=A1 but the tree it points to lives on
  // a different site. The resolver must refuse rather than pretend everything
  // is fine.
  const broken = {
    ...MULTI_HIERARCHY,
    treeSamples: [
      ...MULTI_HIERARCHY.treeSamples,
      { id: "sample-broken", treeId: "tree-QA-004", samplingEventId: "event-A1-Jan", siteId: "site-A1" },
    ],
  };
  const result = resolveHierarchyFromTreeSample({
    treeSampleId: "sample-broken",
    ...broken,
  });
  assert.equal(result.ok, false);
});

test("validateExpectedContext accepts a URL whose ids match the resolved hierarchy", () => {
  const outcome = validateExpectedContext(
    { projectId: "proj-A", siteId: "site-A1", eventId: "event-A1-Jan" },
    {
      projectId: "proj-A",
      siteId: "site-A1",
      eventId: "event-A1-Jan",
      treeId: "tree-QA-002",
      treeSampleId: "sample-A1-Jan-002",
    },
  );
  assert.equal(outcome.ok, true);
});

test("validateExpectedContext reports mismatched projectId (Bloqueante Chrome)", () => {
  const outcome = validateExpectedContext(
    { projectId: "proj-B", siteId: "site-A1", eventId: "event-A1-Jan" },
    {
      projectId: "proj-A",
      siteId: "site-A1",
      eventId: "event-A1-Jan",
      treeId: "tree-QA-002",
      treeSampleId: "sample-A1-Jan-002",
    },
  );
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.match(outcome.message, /proyecto/);
  }
});

test("validateExpectedContext reports all mismatches, not just the first one", () => {
  const outcome = validateExpectedContext(
    { projectId: "proj-B", siteId: "site-A2", eventId: "event-A1-Feb" },
    {
      projectId: "proj-A",
      siteId: "site-A1",
      eventId: "event-A1-Jan",
      treeId: "tree-QA-002",
      treeSampleId: "sample-A1-Jan-002",
    },
  );
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.match(outcome.message, /proyecto/);
    assert.match(outcome.message, /sitio/);
    assert.match(outcome.message, /jornada/);
  }
});

test("validateExpectedContext ignores missing expected fields (URL may omit them)", () => {
  const outcome = validateExpectedContext(
    {},
    {
      projectId: "proj-A",
      siteId: "site-A1",
      eventId: "event-A1-Jan",
      treeId: "tree-QA-002",
      treeSampleId: "sample-A1-Jan-002",
    },
  );
  assert.equal(outcome.ok, true);
});

// ---------------------------------------------------------------------------
// End-to-end scenario tests that combine the pure helpers to prove the flows
// requested in the QA feedback: adding two consecutive trees without repeating
// context; evaluating the same tree in a second jornada; recovering from a
// partial failure without duplicates.
// ---------------------------------------------------------------------------

test("scenario: two consecutive trees in the same jornada resolve to distinct sample ids", () => {
  const first = resolveHierarchyFromTreeSample({
    treeSampleId: "sample-A1-Jan-001",
    ...MULTI_HIERARCHY,
  });
  const second = resolveHierarchyFromTreeSample({
    treeSampleId: "sample-A1-Jan-002",
    ...MULTI_HIERARCHY,
  });
  assert.equal(first.ok && second.ok, true);
  if (first.ok && second.ok) {
    // Both share the same jornada + site + project.
    assert.equal(first.resolved.eventId, second.resolved.eventId);
    assert.equal(first.resolved.siteId, second.resolved.siteId);
    assert.equal(first.resolved.projectId, second.resolved.projectId);
    // But they are two different trees.
    assert.notEqual(first.resolved.treeId, second.resolved.treeId);
    assert.notEqual(first.resolved.treeSampleId, second.resolved.treeSampleId);
  }
});

test("scenario: partial-failure recovery does not duplicate rows when the user retries the same context", () => {
  // A previous attempt persisted {projectId: p, siteId: s}. The user submits
  // again with the same intent — the merge should keep those ids and only
  // mark the event as needing creation.
  const merged = mergeDraftWithSelection(
    { projectId: "p", siteId: "s" },
    { projectId: "p", siteId: "s" },
  );
  const plan = planCreationsForRetry({
    draft: null, // draft already merged
    chosenProjectId: merged.projectId,
    chosenSiteId: merged.siteId,
    chosenEventId: merged.eventId,
  });
  assert.deepEqual(plan, { createProject: false, createSite: false, createEvent: true });
});

test("scenario: partial-failure recovery drops draft descendants when the user picks a different project", () => {
  const merged = mergeDraftWithSelection(
    { projectId: "p1", siteId: "s1" },
    { projectId: "p2" },
  );
  const plan = planCreationsForRetry({
    draft: null,
    chosenProjectId: merged.projectId,
    chosenSiteId: merged.siteId,
    chosenEventId: merged.eventId,
  });
  // With p2 chosen, s1 is no longer valid → creation is required.
  assert.deepEqual(plan, { createProject: false, createSite: true, createEvent: true });
});

import "../region-suggestions/component-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { DIRECTIONS } from "./types.ts";
import { buildGuidedResults, filterGuidedResults, guidedProgress, guidedResultHref, type ResultSource } from "./guided-results.ts";
import { loadGuidedResults, readResultPages } from "./guided-results-client.ts";
import { GuidedResultsView, GuidedTreeStatus } from "./GuidedResults.tsx";

function review(lichen = 40, total = 100) {
  return { version: 1, outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    config: { version: 1, tolerance: 15, samples: [{ x: .5, y: .5, rgb: [80, 170, 80], label: 3 }] },
    savedAt: "2026-09-15T12:00:00Z", analysis: { counts: [0, total - lichen, 0, lichen, 0, 0], total, lichen, width: 100, height: 100, ai: null } };
}
function source(): ResultSource {
  return { projects: [{ id: "project", name: "Proyecto", owner_id: "owner" }],
    sites: [{ id: "site", name: "Zona", project_id: "project" }],
    events: [{ id: "event", name: "Jornada", site_id: "site", sampled_at: "2026-09-15" }],
    trees: [{ id: "tree", code: "Árbol 1", site_id: "site" }],
    samples: [{ id: "sample", tree_id: "tree", site_id: "site", sampling_event_id: "event" }],
    series: [{ id: "series", tree_sample_id: "sample", created_at: "2026-09-15" }],
    captures: DIRECTIONS.map(d => ({ id: d, image_id: `image-${d}`, capture_series_id: "series", direction: d, active: true })),
    reviews: DIRECTIONS.map(d => ({ image_id: `image-${d}`, tree_sample_id: "sample", owner_id: "owner", direction: d, review: review() })) };
}
test("four saved views belong to one tree evaluation and retain exact per-view percentages", () => {
  const data = source(); data.reviews[0].review = review(0); data.reviews[1].review = review(80, 1000);
  const rows = buildGuidedResults(data, "owner");
  assert.equal(rows.length, 1); assert.equal(rows[0].savedCount, 4); assert.equal(rows[0].complete, true);
  assert.equal(rows[0].views.N.coverage, 0); assert.equal(rows[0].views.E.coverage, 8);
  assert.deepEqual(guidedProgress(rows), { evaluations: 1, trees: 1, complete: 1, started: 0, pending: 0, savedViews: 4 });
  assert.equal("coverage" in rows[0], false); // No invented whole-tree aggregate.
});
test("missing, draft, invalid and real zero are different states", () => {
  const data = source(); data.captures = data.captures.filter(v => v.direction !== "N");
  data.reviews[1].review = { ...review(), savedAt: null };
  data.reviews[2].review = { ...review(), analysis: { ...review().analysis, total: 0 } };
  data.reviews[3].review = review(0);
  const row = buildGuidedResults(data, "owner")[0];
  assert.equal(row.views.N.state, "missing"); assert.equal(row.views.N.coverage, null);
  assert.equal(row.views.E.state, "pending"); assert.equal(row.views.S.state, "invalid");
  assert.equal(row.views.W.state, "saved"); assert.equal(row.views.W.coverage, 0); assert.equal(row.savedCount, 1);
});
test("a replaced photo immediately removes the old saved result", () => {
  const data = source(); data.captures[0].active = false;
  data.captures.push({ ...data.captures[0], id: "replacement", image_id: "new-image", active: true });
  const row = buildGuidedResults(data, "owner")[0];
  assert.equal(row.savedCount, 3); assert.equal(row.views.N.state, "pending"); assert.equal(row.views.N.coverage, null);
});
test("only the latest series supplies views; older saved series is not reused", () => {
  const data = source(); data.series.push({ id: "new-series", tree_sample_id: "sample", created_at: "2026-09-16" });
  assert.equal(buildGuidedResults(data, "owner")[0].savedCount, 0);
});
test("ambiguous active photos fail closed", () => {
  const data = source(); data.captures.push({ ...data.captures[0], id: "duplicate", image_id: "another" });
  assert.equal(buildGuidedResults(data, "owner")[0].views.N.state, "invalid");
});
test("owner, direction and sample boundaries are enforced", () => {
  const data = source(); data.reviews[0].owner_id = "other"; data.reviews[1].direction = "N"; data.reviews[2].tree_sample_id = "other";
  assert.equal(buildGuidedResults(data, "owner")[0].savedCount, 1);
  assert.deepEqual(buildGuidedResults(data, "other"), []);
  data.events[0].site_id = "other-site"; assert.deepEqual(buildGuidedResults(data, "owner"), []);
});
test("the same tree in two jornadas remains two evaluations, without copying saved views", () => {
  const data = source(); data.events.push({ ...data.events[0], id: "event-2" });
  data.samples.push({ ...data.samples[0], id: "sample-2", sampling_event_id: "event-2" });
  const rows = buildGuidedResults(data, "owner");
  assert.equal(guidedProgress(rows).trees, 1); assert.equal(guidedProgress(rows).evaluations, 2);
  assert.equal(filterGuidedResults(rows, { eventId: "event-2" })[0].savedCount, 0);
  assert.equal(filterGuidedResults(rows, { projectId: "wrong", eventId: "event" }).length, 0);
  assert.equal(filterGuidedResults(rows, { treeSampleId: "sample" }).length, 1);
});
test("links retain project, site, jornada and exact tree sample", () => {
  const row = buildGuidedResults(source(), "owner")[0];
  const url = new URL(guidedResultHref(row), "https://test.invalid");
  assert.deepEqual(Object.fromEntries(url.searchParams), { mode: "summary", projectId: "project", siteId: "site", eventId: "event", treeSampleId: "sample" });
  assert.equal(new URL(guidedResultHref(row, false), url).searchParams.has("mode"), false);
});
test("pagination reads beyond one page and surfaces errors instead of zeros", async () => {
  const data = Array.from({ length: 450 }, (_, i) => i), requests: number[] = [];
  const rows = await readResultPages(async (from, to) => { requests.push(from); return { data: data.slice(from, to + 1), error: null }; });
  assert.deepEqual(rows, data); assert.deepEqual(requests, [0, 200, 400]);
  await assert.rejects(readResultPages(async () => ({ data: null, error: new Error("offline") })), /No se pudieron leer/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readResultPages(async () => { throw new Error("Must not query"); }, controller.signal), { name: "AbortError" });
});
test("reader is owner-scoped, batches active images and performs no writes or model calls", async () => {
  const data = source(); const calls: string[] = [];
  const mapping: Record<string, keyof ResultSource> = { projects: "projects", sites: "sites", sampling_events: "events", trees: "trees", tree_samples: "samples", capture_series: "series", capture_views: "captures", guided_capture_reviews: "reviews" };
  const db = { auth: { async getUser() { return { data: { user: { id: "owner" } }, error: null }; } },
    from(table: string) {
      calls.push(table); let rows = data[mapping[table]] as unknown as Record<string, unknown>[];
      const query = { select() { return query; }, order() { return query; }, abortSignal() { return query; },
        eq(column: string, value: unknown) { rows = rows.filter(r => r[column] === value); return query; },
        in(column: string, ids: string[]) { rows = rows.filter(r => ids.includes(String(r[column]))); return query; },
        range(from: number, to: number) { rows = rows.slice(from, to + 1); return query; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: rows, error: null })); } };
      return query;
    } };
  const rows = await loadGuidedResults(db as never, "event");
  assert.equal(rows[0].savedCount, 4); assert.equal(calls.filter(t => t === "guided_capture_reviews").length, 1);
  data.projects[0].owner_id = "other";
  assert.deepEqual(await loadGuidedResults(db as never, "event"), []);
});
test("panel renders one tree, four values, context links and explicit scientific separation", async () => {
  const data = source(); data.reviews[0].review = review(0); data.reviews[1].review = { ...review(), savedAt: null };
  const rows = buildGuidedResults(data, "owner");
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(GuidedResultsView, { rows, filters: { eventId: "event" } })));
    assert.equal(host.querySelectorAll("article").length, 1); assert.equal(host.querySelectorAll("dt").length, 4);
    assert.match(host.textContent!, /3\/4 vistas guardadas/); assert.match(host.textContent!, /0.0%/); assert.match(host.textContent!, /Sin guardar/);
    assert.match(host.textContent!, /Pendientes: Este \(sin guardar\)/);
    assert.match(host.textContent!, /Ver vistas guardadas y pendientes/);
    assert.doesNotMatch(host.textContent!, /Ver las 4 vistas y el 360°/);
    assert.match(host.textContent!, /No es cobertura de todo el árbol ni un índice de calidad del aire/);
    const summary = host.querySelector<HTMLAnchorElement>('a[href^="/images?mode=summary"]')!;
    assert.equal(new URL(summary.href).searchParams.get("treeSampleId"), "sample");
    assert.ok(host.querySelector('a[href="/jornada/event"]'));
    await act(async () => root.render(createElement(GuidedResultsView, { rows, filters: { eventId: "other" } })));
    assert.equal(host.querySelectorAll("article").length, 0); assert.match(host.textContent!, /No hay evaluaciones/);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("a partial tree and an unreadable status never show the complete green badge", async () => {
  const data = source(); data.reviews[1].review = { ...review(), savedAt: null };
  const row = buildGuidedResults(data, "owner")[0];
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(GuidedTreeStatus, { row })));
    assert.match(host.textContent!, /3\/4 vistas guardadas · Pendiente/);
    assert.match(host.textContent!, /Este \(sin guardar\)/);
    assert.equal(host.querySelector(".bg-emerald-100"), null);
    await act(async () => root.render(createElement(GuidedTreeStatus, { row, error: true })));
    assert.match(host.textContent!, /Guardado sin verificar/);
    assert.doesNotMatch(host.textContent!, /vistas guardadas|Pendientes:/);
    assert.equal(host.querySelector(".bg-emerald-100"), null);
    await act(async () => root.render(createElement(GuidedTreeStatus, { row: buildGuidedResults(source(), "owner")[0] })));
    assert.match(host.textContent!, /4\/4 vistas guardadas · Completo/);
    assert.ok(host.querySelector(".bg-emerald-100"));
  } finally { await act(async () => root.unmount()); host.remove(); }
});

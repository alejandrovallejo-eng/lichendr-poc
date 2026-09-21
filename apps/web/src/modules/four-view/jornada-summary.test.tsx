import "../region-suggestions/component-test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import JornadaSummary, { JornadaSummaryView } from "./JornadaSummary";
import { GuidedResultsView } from "./GuidedResults";
import { buildEcologySummary } from "./ecology-summary";
import { emptyEcologyConfig, parseEcologyReview, selectMorph } from "./ecology";
import type { JornadaSummarySnapshot } from "./jornada-summary-client";
import type { GuidedTreeResult } from "./guided-results";
import type { GuidedReview } from "./guided-flow";
import { DIRECTIONS } from "./types";

function fixture(eventId = "event"): JornadaSummarySnapshot {
  const outline = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const morph = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", event_id: eventId, ordinal: 1, custom_name: "Liquen claro" };
  const rows = [1, 2].map(n => ({ sampleId: `s${n}`, tree: { id: `t${n}`, code: `Árbol ${n}`, site_id: "site" },
    project: { id: "project", name: "Proyecto", owner_id: "owner" }, site: { id: "site", name: "Zona", project_id: "project" },
    event: { id: eventId, name: `Jornada ${eventId}`, sampled_at: "2026-09-19", site_id: "site" },
    views: Object.fromEntries(DIRECTIONS.map(d => [d, { state: "saved", imageId: `${n}-${d}`, coverage: 5, savedAt: "2026-09-19T12:00:00Z" }])),
    savedCount: 4, uploadedCount: 4, complete: true, lastSavedAt: "2026-09-19T12:00:00Z",
  } as GuidedTreeResult));
  const snapshot: JornadaSummarySnapshot = { event: { id: eventId, name: `Jornada ${eventId}`, site_id: "site", status: "completed", updated_at: "2026-09-19" },
    data: { rows, catalog: [morph], reviews: [], sources: {} } };
  for (const row of rows) for (const direction of DIRECTIONS) {
    const chosen = selectMorph(emptyEcologyConfig(), morph);
    const config = { ...chosen.config, samples: [{ x: .03, y: .03, label: chosen.label, rgb: [100, 120, 50] as [number, number, number], tolerance: 12, excluded: [] }] };
    const counts = Array(11).fill(0); counts[1] = 80; counts[chosen.label] = 20;
    const review = parseEcologyReview({ version: 1, scale: "uncalibrated", sourceOutline: outline,
      quadrat: { x: 2, y: 2, width: 10, height: 10 }, width: 100, height: 100, config, counts, total: 100, savedAt: "2026-09-19T12:00:00Z" });
    assert.ok(review);
    const imageId = row.views[direction].imageId!;
    snapshot.data.reviews.push({ image_id: imageId, event_id: eventId, tree_sample_id: row.sampleId, direction, revision: 1, review });
    snapshot.data.sources[imageId] = { version: 1, outline, config, savedAt: review.savedAt,
      analysis: { width: 100, height: 100, total: 10000, lichen: 500, counts: [0, 9500, 0, 500], ai: null } } as GuidedReview;
  }
  return snapshot;
}
test("one summary includes both trees, eight views and separate trunk/quadrat percentages", () => {
  const snapshot = fixture(), before = JSON.stringify(snapshot);
  const html = renderToStaticMarkup(<JornadaSummaryView snapshot={snapshot} />);
  const data = buildEcologySummary(snapshot.data, "event");
  assert.equal(data.trees.length, 2); assert.equal(data.quadrats, 8); assert.equal(data.morphs.length, 1); assert.equal(data.morphs[0].trees, 2);
  assert.equal((html.match(/Tronco delimitado: /g) ?? []).length, 8);
  assert.equal((html.match(/5.0 %/g) ?? []).length, 8);
  assert.equal((html.match(/Liquen claro: 20.0 %/g) ?? []).length, 8);
  assert.match(html, /Jornada cerrada/); assert.match(html, /Calidad del aire: todavía no estimada/);
  assert.match(html, /environmental-quality\?eventId=event/);
  assert.equal(JSON.stringify(snapshot), before);
});
test("environmental entry consumes the same data and retains the explicit classic route", () => {
  const snapshot = fixture();
  const html = renderToStaticMarkup(<JornadaSummaryView snapshot={snapshot} environmental />);
  assert.match(html, /8\/8/); assert.match(html, /Liquen claro/); assert.match(html, /analysis\?eventId=event/);
  assert.match(html, /environmental-quality\?mode=classic/);
  const listing = renderToStaticMarkup(<GuidedResultsView rows={snapshot.data.rows} environmental />);
  assert.match(listing, /action="\/environmental-quality"/);
  assert.match(listing, /environmental-quality\?eventId=event/);
  assert.doesNotMatch(html, /0 imágenes completadas/);
});
test("pending, stale and real zero remain distinguishable after closure", () => {
  const snapshot = fixture();
  snapshot.data.rows[0].views.N = { state: "missing", imageId: null, coverage: null, savedAt: null };
  snapshot.data.rows[0].views.S.coverage = 0;
  snapshot.data.rows[0].savedCount = 3; snapshot.data.rows[0].complete = false;
  snapshot.data.sources["1-E"].outline = [{ x: .1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  const html = renderToStaticMarkup(<JornadaSummaryView snapshot={snapshot} />);
  assert.match(html, /Sin foto/); assert.match(html, /Tronco modificado: revisar/); assert.match(html, /0.0 %/);
  assert.match(html, /Resumen parcial/); assert.match(html, /7\/8/);
  assert.match(html, /Cerrar la jornada no completa estos pendientes/);
});
test("empty and unreviewed journeys never invent a diversity measurement", () => {
  const snapshot = fixture(); snapshot.data.reviews = [];
  let html = renderToStaticMarkup(<JornadaSummaryView snapshot={snapshot} />);
  assert.match(html, /Aún no hay cuadrantes revisados/); assert.match(html, /8\/8/);
  snapshot.data.rows = []; snapshot.data.sources = {}; snapshot.data.catalog = [];
  html = renderToStaticMarkup(<JornadaSummaryView snapshot={snapshot} />);
  assert.match(html, /Aún no hay árboles para resumir/);
  assert.doesNotMatch(html, /Las cuatro vistas de cada árbol tienen/);
});
test("changing journeys cancels stale responses; read failures are errors, not zeros", async () => {
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  let resolveOld!: (value: JornadaSummarySnapshot) => void;
  const signals: AbortSignal[] = [];
  const load = (id: string, signal?: AbortSignal) => { if (signal) signals.push(signal); return id === "old"
    ? new Promise<JornadaSummarySnapshot>(resolve => { resolveOld = resolve; }) : Promise.resolve(fixture(id)); };
  try {
    await act(async () => root.render(<JornadaSummary filters={{ eventId: "old" }} load={load} />));
    assert.match(host.textContent!, /Reuniendo/);
    await act(async () => root.render(<JornadaSummary filters={{ eventId: "new" }} load={load} />));
    assert.equal(signals[0].aborted, true);
    await act(async () => resolveOld(fixture("old")));
    assert.match(host.textContent!, /Jornada new/); assert.doesNotMatch(host.textContent!, /Jornada old/);
    const failing = async () => { throw new Error("Lectura interrumpida"); };
    await act(async () => root.render(<JornadaSummary filters={{ eventId: "failure" }} load={failing} />));
    assert.match(host.querySelector('[role="alert"]')!.textContent!, /Lectura interrumpida/);
    assert.equal(host.querySelectorAll("article").length, 0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
test("a mismatched project cannot display another journey's results", async () => {
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(<JornadaSummary filters={{ eventId: "event", projectId: "other" }} load={async () => fixture()} />));
    assert.match(host.textContent!, /no corresponde/); assert.equal(host.querySelectorAll("article").length, 0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

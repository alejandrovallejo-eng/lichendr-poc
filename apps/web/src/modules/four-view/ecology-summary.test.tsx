import "../region-suggestions/component-test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { EcologyData, EcologyServices } from "./ecology-client";
import { emptyEcologyConfig, parseEcologyReview, selectMorph } from "./ecology";
import type { GuidedReview } from "./guided-flow";
import type { GuidedTreeResult } from "./guided-results";
import { DIRECTIONS, type Direction } from "./types";
import { buildEcologySummary, currentQuadrat } from "./ecology-summary";
import EcologySummary from "./EcologySummary";
import EcologyJourney from "./EcologyJourney";

const outline = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const morphA = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", event_id: "event", ordinal: 1, custom_name: "Liquen claro" };
const morphB = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", event_id: "event", ordinal: 2 };
function fixture(): EcologyData {
  const rows = [1, 2, 3].map(n => ({ sampleId: `sample-${n}`, tree: { id: `tree-${n}`, code: `Árbol ${n}`, site_id: "site" },
    project: { id: "project", name: "Proyecto de prueba", owner_id: "owner" }, site: { id: "site", name: "Zona de prueba", project_id: "project" },
    event: { id: "event", name: "Jornada de prueba", site_id: "site", sampled_at: "2026-09-16" },
    views: Object.fromEntries(DIRECTIONS.map(d => [d, { state: "saved", imageId: `${n}-${d}`, coverage: 99, savedAt: "2026-09-16T10:00:00Z" }])),
    savedCount: 4, uploadedCount: 4, complete: true, lastSavedAt: "2026-09-16T10:00:00Z",
  } as GuidedTreeResult));
  const sources: EcologyData["sources"] = {};
  rows.forEach(r => DIRECTIONS.forEach(d => {
    sources[r.views[d].imageId!] = { version: 1, outline, config: emptyEcologyConfig(), savedAt: "2026-09-16T10:00:00Z",
      analysis: { width: 100, height: 100, total: 10000, lichen: 9900, counts: [0, 100, 0, 9900, 0, 0, 0, 0, 0, 0, 0], ai: null } } as GuidedReview;
  }));
  return { rows, sources, catalog: [morphA, morphB], reviews: [] };
}
function add(data: EcologyData, n: number, d: Direction, pixels = 4, side = 4, reverse = false) {
  let config = emptyEcologyConfig();
  if (pixels > 0) {
    if (reverse) config = selectMorph(config, morphB).config;
    const chosen = selectMorph(config, morphA); config = chosen.config;
    config = { ...config, samples: [{ x: .03, y: .03, label: chosen.label, rgb: [100, 120, 50], tolerance: 12, excluded: [] }] };
  }
  const counts = Array(11).fill(0); counts[1] = side * side - pixels;
  if (pixels) counts[config.confirmed!.groups.find(g => g.id === morphA.id)!.label] = pixels;
  const review = parseEcologyReview({ version: 1, scale: "uncalibrated", sourceOutline: outline,
    quadrat: { x: 2, y: 2, width: side, height: side }, width: 100, height: 100, config, counts,
    total: side * side, savedAt: "2026-09-16T12:00:00Z" });
  assert.ok(review);
  data.reviews.push({ image_id: `${n}-${d}`, event_id: "event", tree_sample_id: `sample-${n}`, direction: d, revision: 1, review });
}
test("one tree counts once across directions; denominator excludes unreviewed trees", () => {
  const data = fixture(); add(data, 1, "N"); add(data, 1, "E"); add(data, 2, "N");
  const before = JSON.stringify(data), s = buildEcologySummary(data, "event");
  assert.equal(s.trees.length, 3); assert.equal(s.treesReviewed, 2); assert.equal(s.treesComplete, 0);
  assert.equal(s.quadrats, 3); assert.equal(s.morphs.length, 1); assert.equal(s.morphs[0].trees, 2);
  assert.equal(s.morphs[0].occurrences.length, 3); assert.equal(s.catalogueOnly, 1);
  assert.equal(JSON.stringify(data), before);
});
test("percentages use each quadrat, not trunk counts, shared labels or pooled pixels", () => {
  const data = fixture(); add(data, 1, "N", 4, 4); add(data, 1, "E", 10, 10, true);
  const s = buildEcologySummary(data, "event");
  assert.deepEqual(s.morphs[0].occurrences.map(o => o.percent), [25, 10]);
  assert.equal(s.morphs[0].name, "Liquen claro"); assert.equal(s.morphs.length, 1);
  assert.equal("coverage" in s, false); assert.equal("mean" in s, false);
});
test("an explicit zero review is included but pending quadrats do not become zero", () => {
  const data = fixture(); add(data, 1, "N", 0);
  const s = buildEcologySummary(data, "event");
  assert.equal(s.quadrats, 1); assert.equal(s.morphs.length, 0); assert.equal(s.treesReviewed, 1);
  assert.equal(s.pending, 11); assert.equal(s.trees[0].views[0].row!.review.counts[1], 16);
});
test("changed outline and dimensions exclude old quadrats until reviewed", () => {
  const data = fixture(); add(data, 1, "N"); add(data, 1, "E");
  data.sources["1-N"].outline = [{ x: .1, y: 0 }, ...outline.slice(1)];
  data.sources["1-E"].analysis!.width = 90;
  const s = buildEcologySummary(data, "event"); assert.equal(s.changed, 2); assert.equal(s.quadrats, 0); assert.equal(s.morphs.length, 0);
});
test("replaced image, unsaved view and ambiguous captures do not resurrect old reviews", () => {
  const data = fixture(); add(data, 1, "N"); add(data, 1, "E"); add(data, 1, "S");
  data.rows[0].views.N.imageId = "replacement"; data.rows[0].views.E.state = "pending"; data.rows[0].views.S.state = "invalid";
  const s = buildEcologySummary(data, "event"); assert.equal(s.unavailable, 3); assert.equal(s.quadrats, 0);
});
test("wrong jornada, sample and direction reviews are never counted", () => {
  const data = fixture(); add(data, 1, "N"); add(data, 1, "E"); add(data, 1, "S");
  data.reviews[0].event_id = "other"; data.reviews[1].tree_sample_id = "other"; data.reviews[2].direction = "W";
  assert.equal(buildEcologySummary(data, "event").quadrats, 0);
});
test("duplicate matching reviews are unavailable, not double counted", () => {
  const data = fixture(); add(data, 1, "N"); data.reviews.push(data.reviews[0]);
  assert.equal(currentQuadrat(data, "sample-1", "N").state, "unavailable");
  assert.equal(buildEcologySummary(data, "event").quadrats, 0);
});
test("mixed events, owners, sites and duplicated tree identities fail closed", () => {
  const data = fixture();
  for (const changed of [
    { ...data.rows[1], event: { ...data.rows[1].event, id: "other" } },
    { ...data.rows[1], project: { ...data.rows[1].project, owner_id: "other" } },
    { ...data.rows[1], site: { ...data.rows[1].site, id: "other" } },
    { ...data.rows[1], tree: data.rows[0].tree }, data.rows[0],
  ]) assert.throws(() => buildEcologySummary({ ...data, rows: [data.rows[0], changed] }, "event"), /conciliar/);
});
test("catalogue identity, not names or colours, defines groups; rename is display-only", () => {
  const data = fixture(); add(data, 1, "N"); const before = JSON.stringify(data.reviews);
  data.catalog[0] = { ...morphA, custom_name: "Nombre cambiado" }; data.catalog[1] = { ...morphB, custom_name: "Nombre cambiado" };
  const s = buildEcologySummary(data, "event"); assert.equal(s.morphs.length, 1); assert.equal(s.morphs[0].name, "Nombre cambiado");
  assert.equal(s.catalogueOnly, 1); assert.equal(JSON.stringify(data.reviews), before);
  data.catalog = [morphB]; assert.throws(() => buildEcologySummary(data, "event"), /catálogo/);
});
test("all four quadrats can be reviewed without asserting taxonomic or air-quality validity", () => {
  const data = fixture(); data.rows = [data.rows[0]]; DIRECTIONS.forEach(d => add(data, 1, d));
  const s = buildEcologySummary(data, "event"); assert.equal(s.treesComplete, 1); assert.equal(s.quadrats, 4); assert.equal(s.morphs[0].trees, 1);
  const html = renderToStaticMarkup(<EcologySummary data={data} eventId="event" onReview={() => {}}/>);
  assert.match(html, /No extrapola/); assert.match(html, /ni estima calidad del aire/); assert.match(html, /no validan una identificación/);
  assert.doesNotMatch(html, /Resumen parcial/);
});
test("empty summary has no invented diversity, averages or NaN", () => {
  const data: EcologyData = { rows: [], sources: {}, reviews: [], catalog: [] };
  assert.equal(buildEcologySummary(data, "event").lastSavedAt, null);
  const html = renderToStaticMarkup(<EcologySummary data={data} eventId="event" onReview={() => {}}/>);
  assert.match(html, /Aún no hay árboles/); assert.match(html, /no se puede describir la diversidad/);
  assert.doesNotMatch(html, /NaN|Infinity|aire bueno/);
});
test("summary labels denominators and unknown, retains exact routes and review actions", async () => {
  const data = fixture(); add(data, 1, "N"); let clicked = "";
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(<EcologySummary data={data} eventId="event" onReview={(s, d) => { clicked = `${s}:${d}`; }}/>));
    assert.match(host.textContent!, /Registrada en 1 de 1 árboles/); assert.match(host.textContent!, /Sin clasificar: 75.0 %/);
    assert.match(host.textContent!, /Resumen parcial/); assert.match(host.textContent!, /diversidad pendiente/);
    const button = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Abrir Árbol 1 · Norte")!;
    await act(async () => button.click()); assert.equal(clicked, "sample-1:N");
    const link = host.querySelector<HTMLAnchorElement>('a[href^="/images?mode=summary"]')!;
    assert.equal(new URL(link.href).searchParams.get("treeSampleId"), "sample-1");
    assert.equal(new URL(link.href).searchParams.get("eventId"), "event");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
test("journey switches sections, reloads and reports read errors without model or write calls", async () => {
  const data = fixture(); add(data, 1, "N"); let reads = 0, fail = false;
  const forbidden = async () => { throw new Error("No mutation/model calls allowed"); };
  const services: EcologyServices = { load: async () => { reads++; if (fail) throw new Error("Lectura fallida"); return data; },
    photo: forbidden, createMorph: forbidden, save: forbidden, renameMorph: forbidden };
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const click = async (label: string) => { const b = Array.from(host.querySelectorAll("button")).find(b => b.textContent === label)!; assert.ok(b); await act(async () => b.click()); };
  try {
    await act(async () => root.render(<EcologyJourney eventId="event" services={services}/>));
    assert.equal(reads, 1); assert.ok(host.querySelector('[aria-label="Resumen ecológico de la jornada"]'));
    await click("Cuadrantes y catálogo"); assert.match(host.textContent!, /Catálogo de la jornada/);
    await click("Resumen de jornada"); assert.equal(reads, 1);
    fail = true; await click("Actualizar resultados"); assert.match(host.querySelector('[role="alert"]')!.textContent!, /Lectura fallida/);
    assert.equal(host.querySelector('[aria-label="Resumen ecológico de la jornada"]'), null);
    fail = false; await click("Reintentar lectura"); assert.ok(host.querySelector('[aria-label="Resumen ecológico de la jornada"]')); assert.equal(reads, 3);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
test("late response from previous jornada cannot replace the current summary", async () => {
  const old = fixture(), current = fixture(); current.rows.forEach(r => { r.event = { ...r.event, id: "new", name: "Jornada nueva" }; });
  current.catalog = [];
  let resolveOld!: (value: EcologyData) => void;
  const forbidden = async () => { throw new Error("Unexpected call"); };
  const services: EcologyServices = { load: async (id) => id === "event" ? new Promise(resolve => { resolveOld = resolve; }) : current,
    photo: forbidden, createMorph: forbidden, save: forbidden, renameMorph: forbidden };
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(<EcologyJourney eventId="event" services={services}/>));
    await act(async () => root.render(<EcologyJourney eventId="new" services={services}/>));
    assert.match(host.textContent!, /Jornada nueva/);
    await act(async () => resolveOld(old)); assert.match(host.textContent!, /Jornada nueva/); assert.doesNotMatch(host.textContent!, /Jornada de prueba/);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

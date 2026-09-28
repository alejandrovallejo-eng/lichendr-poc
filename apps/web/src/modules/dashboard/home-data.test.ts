import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardFocusSnapshot, buildDashboardHomeSnapshot } from "./home-logic.ts";
import type { GuidedTreeResult } from "../four-view/guided-results.ts";

function row(overrides: Partial<GuidedTreeResult> = {}): GuidedTreeResult {
  return {
    sampleId: "sample-1",
    tree: { id: "tree-1", code: "Árbol 01", site_id: "site-1" },
    project: { id: "project-1", name: "Proyecto", owner_id: "owner" },
    site: { id: "site-1", name: "Sitio", project_id: "project-1" },
    event: { id: "event-1", name: "Jornada 1", site_id: "site-1", sampled_at: "2026-09-20T09:00:00Z" },
    views: {
      N: { state: "saved", imageId: "n", coverage: 12, savedAt: "2026-09-20T10:00:00Z" },
      E: { state: "saved", imageId: "e", coverage: 15, savedAt: "2026-09-20T10:05:00Z" },
      S: { state: "saved", imageId: "s", coverage: 18, savedAt: "2026-09-20T10:10:00Z" },
      W: { state: "pending", imageId: "w", coverage: null, savedAt: null },
    },
    savedCount: 3,
    uploadedCount: 4,
    complete: false,
    lastSavedAt: "2026-09-20T10:10:00Z",
    ...overrides,
  };
}

test("dashboard snapshot keeps open journeys ahead and resumes the exact pending tree", () => {
  const snapshot = buildDashboardHomeSnapshot({
    projects: [{ id: "project-1", name: "Proyecto", owner_id: "owner" }],
    sites: [{ id: "site-1", name: "Sitio", project_id: "project-1" }],
    events: [
      { id: "event-1", site_id: "site-1", name: "Jornada 1", sampled_at: "2026-09-20T09:00:00Z", status: "draft", updated_at: "2026-09-20T10:10:00Z" },
      { id: "event-2", site_id: "site-1", name: "Jornada 2", sampled_at: "2026-09-19T09:00:00Z", status: "completed", updated_at: "2026-09-19T10:10:00Z" },
    ],
    trees: [{ id: "tree-1", site_id: "site-1" }],
    samples: [{ id: "sample-1", tree_id: "tree-1", sampling_event_id: "event-1" }],
    series: [{ id: "series-1", tree_sample_id: "sample-1", status: "annotation_pending", valid_view_count: 3, pending_view_count: 1, confirmed_at: null, updated_at: "2026-09-20T10:10:00Z" }],
    rows: [row()],
  });
  assert.equal(snapshot.openJourneys.length, 1);
  assert.equal(snapshot.openJourneys[0].workLabel, "Continuar jornada");
  assert.match(snapshot.openJourneys[0].workHref, /treeSampleId=sample-1/);
  assert.equal(snapshot.recentJourneys[0].event.id, "event-1");
});

test("focus snapshot separates saved progress, capture progress and optional diversity", () => {
  const journey = buildDashboardHomeSnapshot({
    projects: [{ id: "project-1", name: "Proyecto", owner_id: "owner" }],
    sites: [{ id: "site-1", name: "Sitio", project_id: "project-1" }],
    events: [{ id: "event-1", site_id: "site-1", name: "Jornada 1", sampled_at: "2026-09-20T09:00:00Z", status: "draft", updated_at: "2026-09-20T10:10:00Z" }],
    trees: [{ id: "tree-1", site_id: "site-1" }],
    samples: [{ id: "sample-1", tree_id: "tree-1", sampling_event_id: "event-1" }],
    series: [{ id: "series-1", tree_sample_id: "sample-1", status: "annotation_pending", valid_view_count: 3, pending_view_count: 1, confirmed_at: null, updated_at: "2026-09-20T10:10:00Z" }],
    rows: [row()],
  }).openJourneys[0];
  const focus = buildDashboardFocusSnapshot(journey, {
    trees: [],
    morphs: [],
    quadrats: 0,
    expectedViews: 0,
    treesReviewed: 0,
    treesComplete: 0,
    pending: 0,
    changed: 0,
    unavailable: 0,
    frequencyViews: 0,
    frequencyTrees: 0,
    catalogueOnly: 0,
    lastSavedAt: null,
  });
  assert.equal(focus.guardado.status, "En progreso");
  assert.match(focus.captura.detail, /3 de 4 vistas revisadas · Falta Oeste/);
  assert.equal(focus.diversidad.status, "Sin iniciar");
  assert.equal(focus.jornada.detail, "Jornada abierta");
});

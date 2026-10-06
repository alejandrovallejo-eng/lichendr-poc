import test from "node:test";
import assert from "node:assert/strict";
import { csv, readDataExport } from "./data";
import { viewExportRows } from "./views";
test("CSV quotes newlines and commas, preserves numeric zero and prevents formulas", () => {
  const value = csv([{ text: '=HYPERLINK("bad")', name: 'a,b\n"c"', coverage: 0, missing: null }], ["text", "name", "coverage", "missing"]);
  assert.match(value, /"'=HYPERLINK/); assert.match(value, /"a,b\n""c"""/);
  assert.match(value, /,"0",""\r\n/);
});
test("exports keep missing views distinct from saved zero and preserve context", () => {
  const snapshot = { schemaVersion: 1 as const, generatedAt: "2026-10-05T12:00:00Z", scope: "current_user" as const, ownerId: "owner", scientificNotice: "descriptive", tables: {
    projects: [{ id: "p", owner_id: "owner", name: "P" }], sites: [{ id: "s", project_id: "p", name: "S" }],
    sampling_events: [{ id: "e", site_id: "s", name: "E", sampled_at: "2026-10-05" }], trees: [{ id: "t", site_id: "s", code: "T" }],
    tree_samples: [{ id: "ts", tree_id: "t", site_id: "s", sampling_event_id: "e" }], capture_series: [{ id: "series", tree_sample_id: "ts", created_at: "2026-10-05" }],
    capture_views: [{ id: "v", capture_series_id: "series", image_id: "i", direction: "N", active: true }],
    guided_capture_reviews: [{ owner_id: "owner", image_id: "i", tree_sample_id: "ts", direction: "N", review: { version: 1,
      outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], config: { version: 1, tolerance: 12, samples: [{ x: .5, y: .5, rgb: [100, 100, 100], label: 3 }] },
      savedAt: "2026-10-05T12:00:00Z", analysis: { counts: [0, 1, 0, 0, 0, 0], total: 1, lichen: 0, width: 1, height: 1, ai: null } } }],
  } };
  const rows = viewExportRows(snapshot as Parameters<typeof viewExportRows>[0]);
  assert.equal(rows.length, 4); assert.equal(rows[0].coverage_percent, 0); assert.equal(rows[0].state, "saved");
  assert.equal(rows[1].coverage_percent, null); assert.equal(rows[1].state, "missing");
  assert.equal(rows[0].event_id, "e");
});
test("unauthenticated snapshots fail before table reads", async () => {
  await assert.rejects(readDataExport({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } } as never), /Inicia sesión/);
});

// The deployed API returns an HTTP application conflict rather than a
// retryable database serialization error; older installations still work.
test("guided saves preserve drafts and explain either conflict response", async () => {
  const { createGuidedCloudStore } = await import("../four-view/guided-cloud");
  for (const code of ["PT409", "40001"]) {
    const db = { rpc: () => ({ single: async () => ({ data: null, error: { code } }) }) };
    const store = createGuidedCloudStore(db as never);
    await assert.rejects(store.write({ ownerId: "owner", imageId: "i", treeSampleId: "ts", direction: "N" },
      { version: 1, outline: [], config: { version: 1, tolerance: 12, samples: [] }, analysis: null, savedAt: null }, 1), /otra pestaña.*borrador/);
  }
});

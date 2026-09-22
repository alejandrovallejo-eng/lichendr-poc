import "../region-suggestions/component-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { closureSummary, closureBlock, closureFingerprint, validateClosureSnapshot, type ClosureSnapshot } from "./closure.ts";
import { changeClosure, readClosure } from "./closure-client.ts";
import ClosureReview, { type ClosureReviewProps } from "./ClosureReview.tsx";

function fixture(): ClosureSnapshot {
  const saved = { state: "saved" as const, coverage: 0, imageId: "image", savedAt: "2026-09-16" };
  return { event: { id: "event", site_id: "site", name: "Jornada de prueba", status: "draft", updated_at: "2026-09-16T10:00:00Z" },
    rows: [{ sampleId: "sample", project: { id: "project", name: "Proyecto", owner_id: "owner" },
      site: { id: "site", name: "Zona", project_id: "project" }, tree: { id: "tree", code: "Árbol 1", site_id: "site" },
      event: { id: "event", site_id: "site", name: "Jornada de prueba", sampled_at: "2026-09-16" },
      views: { N: { ...saved }, E: { ...saved }, S: { ...saved }, W: { ...saved } },
      savedCount: 4, uploadedCount: 4, complete: true, lastSavedAt: saved.savedAt }] };
}
function pending(): ClosureSnapshot {
  const s = fixture();
  s.rows[0].views.E = { state: "missing", coverage: null, imageId: null, savedAt: null };
  s.rows[0].views.S = { state: "pending", coverage: null, imageId: "image-S", savedAt: null };
  s.rows[0].views.W = { state: "invalid", coverage: null, imageId: "image-W", savedAt: null };
  s.rows[0].savedCount = 1; s.rows[0].complete = false;
  return s;
}
function writer(result: unknown = fixture().event, error: unknown = null) {
  const calls: unknown[][] = [];
  const db = { from(table: string) {
    calls.push(["from", table]);
    const q = { update(value: unknown) { calls.push(["update", value]); return q; },
      eq(column: string, value: unknown) { calls.push(["eq", column, value]); return q; },
      select(fields: string) { calls.push(["select", fields]); return q; },
      async maybeSingle() { return { data: result, error }; } };
    return q;
  } } as unknown as SupabaseClient;
  return { db, calls };
}

test("four views are one tree; saved zero is not pending", () => {
  assert.deepEqual(closureSummary(fixture().rows), { trees: 1, complete: 1, saved: 4, total: 4, pending: 0, missing: 0, unsaved: 0, invalid: 0 });
  assert.equal(closureBlock(fixture(), false), null);
});
test("missing, unsaved and invalid remain different and require acknowledgement", () => {
  assert.deepEqual(closureSummary(pending().rows), { trees: 1, complete: 0, saved: 1, total: 4, pending: 3, missing: 1, unsaved: 1, invalid: 1 });
  assert.match(closureBlock(pending(), false)!, /Confirma/);
  assert.equal(closureBlock(pending(), true), null);
});
test("an empty jornada cannot close even with acknowledgement", () => {
  assert.match(closureBlock({ ...fixture(), rows: [] }, true)!, /al menos un árbol/);
});
test("missing, duplicate, foreign samples and wrong hierarchy fail closed", () => {
  assert.doesNotThrow(() => validateClosureSnapshot(fixture(), ["sample"]));
  assert.throws(() => validateClosureSnapshot(fixture(), ["sample", "missing"]));
  assert.throws(() => validateClosureSnapshot(fixture(), ["other"]));
  const bad = fixture(); bad.rows[0].event.id = "other";
  assert.throws(() => validateClosureSnapshot(bad, ["sample"]));
  const duplicate = fixture(); duplicate.rows.push(duplicate.rows[0]);
  assert.throws(() => validateClosureSnapshot(duplicate, ["sample", "sample"]));
  const hierarchy = fixture(); hierarchy.rows[0].tree.site_id = "other";
  assert.throws(() => validateClosureSnapshot(hierarchy, ["sample"]));
});
test("image replacement and changed coverage invalidate the reviewed fingerprint", () => {
  const a = fixture(), b = fixture(); b.rows[0].views.N.imageId = "replacement";
  assert.notEqual(closureFingerprint(a), closureFingerprint(b));
  b.rows[0].views.N.imageId = "image"; b.rows[0].views.N.coverage = 1;
  assert.notEqual(closureFingerprint(a), closureFingerprint(b));
});
test("closure rereads and writes only status with event/site/status/version CAS", async () => {
  const s = fixture(), output = { ...s.event, status: "completed", updated_at: "new" };
  const { db, calls } = writer(output); let reads = 0;
  const result = await changeClosure(db, s, "completed", false, async () => { reads++; return s; });
  assert.equal(reads, 1); assert.equal(result.changed, true); assert.equal(result.snapshot.event.status, "completed");
  assert.deepEqual(calls.filter(c => c[0] === "update"), [["update", { status: "completed" }]]);
  assert.deepEqual(calls.filter(c => c[0] === "from"), [["from", "sampling_events"]]);
  for (const [key, value] of [["id", "event"], ["site_id", "site"], ["status", "draft"], ["updated_at", s.event.updated_at]])
    assert.ok(calls.some(c => c[0] === "eq" && c[1] === key && c[2] === value));
  assert.deepEqual(result.snapshot.rows, s.rows);
});
test("changed snapshot does not write and returns new pending state for review", async () => {
  const { db, calls } = writer();
  const result = await changeClosure(db, fixture(), "completed", true, async () => pending());
  assert.equal(result.changed, false); assert.equal(calls.length, 0);
  assert.equal(closureSummary(result.snapshot.rows).pending, 3);
});
test("failed refresh, missing acknowledgement and empty jornada never write", async () => {
  const { db, calls } = writer(), s = pending();
  await assert.rejects(changeClosure(db, s, "completed", false, async () => s), /Confirma/);
  await assert.rejects(changeClosure(db, s, "completed", true, async () => { throw new Error("offline"); }), /offline/);
  const empty = { ...s, rows: [] };
  await assert.rejects(changeClosure(db, empty, "completed", true, async () => empty), /al menos/);
  assert.equal(calls.length, 0);
});
test("CAS conflict, database error and mismatched response are not success", async () => {
  const s = fixture();
  for (const w of [writer(null), writer(null, "offline"), writer(s.event)])
    await assert.rejects(changeClosure(w.db, s, "completed", true, async () => s), /No se pudo confirmar/);
});
test("reopen preserves reviews; already completed retry is a no-op", async () => {
  const s = pending(); s.event.status = "completed";
  const w = writer({ ...s.event, status: "draft", updated_at: "later" });
  const result = await changeClosure(w.db, s, "draft", false, async () => s);
  assert.equal(result.changed, true); assert.deepEqual(result.snapshot.rows, s.rows);
  const noWrite = writer();
  assert.equal((await changeClosure(noWrite.db, s, "completed", true, async () => s)).changed, false);
  assert.equal(noWrite.calls.length, 0);
});
test("reader requires current session and propagates unreadable jornada", async () => {
  const db = { auth: { getUser: async () => ({ data: { user: null }, error: null }) }, from: () => { throw new Error("must not query"); } };
  await assert.rejects(readClosure(db as never, "event"), /sesión/);
  const bad = { auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) },
    from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: "denied" }) }; return q; } };
  await assert.rejects(readClosure(bad as never, "event"), /No se pudo leer/);
});

async function render(props: Partial<ClosureReviewProps>, run: (host: HTMLDivElement) => Promise<void>) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(ClosureReview, {
      eventId: "event", load: async () => fixture(), change: async snapshot => ({ changed: false, snapshot }), onBack() {}, navigate() {}, ...props,
    })));
    await run(host);
  } finally { await act(async () => root.unmount()); host.remove(); }
}
function findButton(host: HTMLDivElement, label: string) {
  const b = [...host.querySelectorAll("button")].find(b => b.textContent === label);
  assert.ok(b, `Missing button ${label}`); return b;
}
test("review is one tree with four named states and explicit acknowledgement", async () => {
  let calls = 0;
  await render({ load: async () => pending(), change: async s => { calls++; return { changed: true, snapshot: { ...s, event: { ...s.event, status: "completed" } } }; } }, async host => {
    assert.equal(host.querySelectorAll("article").length, 1); assert.equal(host.querySelectorAll("dt").length, 4);
    assert.match(host.textContent!, /Guardada · 0.0%/); assert.match(host.textContent!, /Sin foto/); assert.match(host.textContent!, /Sin guardar/); assert.match(host.textContent!, /Revisar guardado/);
    assert.match(host.textContent!, /No certifica/); assert.match(host.textContent!, /no es obligatorio/);
    const close = findButton(host, "Cerrar con pendientes"); assert.equal(close.disabled, true);
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    assert.equal(close.disabled, false);
    await act(async () => { close.click(); close.click(); });
    assert.equal(calls, 1); assert.match(host.textContent!, /Jornada cerrada/);
    assert.match(host.textContent!, /1 sin foto · 1 sin guardar · 1 para revisar/); // retained, not erased
    assert.ok(findButton(host, "Reabrir jornada"));
  });
});
test("loading and load error offer no closure action", async () => {
  await render({ load: async () => { throw new Error("offline"); } }, async host => {
    assert.ok(host.querySelector('[role="alert"]')); assert.ok(findButton(host, "Reintentar lectura"));
    assert.equal([...host.querySelectorAll("button")].some(b => b.textContent?.startsWith("Confirmar cierre")), false);
  });
  await render({ load: () => new Promise(() => {}) }, async host => {
    assert.match(host.textContent!, /Comprobando/); assert.equal(host.querySelectorAll("article").length, 0);
    assert.equal(findButton(host, "← Volver a los árboles").disabled, true);
  });
});
test("uncertain write requires refresh before another attempt", async () => {
  let calls = 0;
  await render({ change: async () => { calls++; throw new Error("No se pudo confirmar el cambio."); } }, async host => {
    await act(async () => findButton(host, "Confirmar cierre de jornada").click());
    assert.equal(findButton(host, "Confirmar cierre de jornada").disabled, true);
    assert.equal(calls, 1);
    await act(async () => findButton(host, "Actualizar revisión").click());
    assert.equal(findButton(host, "Confirmar cierre de jornada").disabled, false);
  });
});
test("concurrent change clears acknowledgement and requires another review", async () => {
  await render({ load: async () => pending(), change: async s => ({ changed: false, snapshot: s }) }, async host => {
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => findButton(host, "Cerrar con pendientes").click());
    assert.match(host.textContent!, /cambió desde/); assert.equal(findButton(host, "Cerrar con pendientes").disabled, true);
  });
});
test("only a confirmed closure opens the unified summary; reopening stays on the review", async () => {
  const visited: string[] = [];
  await render({ navigate: href => visited.push(href), change: async (s, status) => ({ changed: true, snapshot: { ...s, event: { ...s.event, status } } }) }, async host => {
    await act(async () => findButton(host, "Confirmar cierre de jornada").click());
    assert.deepEqual(visited, ["/analysis?eventId=event"]);
    await act(async () => findButton(host, "Reabrir jornada").click());
    assert.equal(visited.length, 1);
  });
  await render({ navigate: href => visited.push(href), change: async s => ({ changed: false, snapshot: s }) }, async host => {
    await act(async () => findButton(host, "Confirmar cierre de jornada").click());
    assert.equal(visited.length, 1);
  });
});

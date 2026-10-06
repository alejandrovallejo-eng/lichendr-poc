import test from "node:test";
import assert from "node:assert/strict";
import { checkSupabaseConnection, DATABASE_TABLES } from "./readiness.mjs";

const identity = "00000000-0000-4000-8000-000000000001";
function fixture({ failedTable, storageStatus = 200, userStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    if (path === "/auth/v1/settings") return Response.json({ external: { anonymous_users: true, google: true } });
    if (path === "/auth/v1/user") return Response.json({ id: identity }, { status: userStatus });
    if (path.startsWith("/rest/v1/")) return new Response(null, { status: path === `/rest/v1/${failedTable}` ? 404 : 200 });
    if (path === "/storage/v1/object/list/lichen-images") return Response.json([], { status: storageStatus });
    throw new Error("unexpected_request");
  };
  return { calls, fetchImpl };
}
const options = { url: "https://example.supabase.co", key: "sb_publishable_test" };

test("a reachable API without a user never claims database or Storage readiness", async () => {
  const mock = fixture();
  const result = await checkSupabaseConnection({ ...options, fetchImpl: mock.fetchImpl });
  assert.equal(result.status, "needs_session");
  assert.equal(result.checks.database, "not_checked");
  assert.equal(result.checks.storage, "not_checked");
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].init.method, undefined);
});

test("an expired session is verified remotely and cannot enable table probes", async () => {
  const mock = fixture({ userStatus: 401 });
  const result = await checkSupabaseConnection({ ...options, accessToken: "expired", fetchImpl: mock.fetchImpl });
  assert.equal(result.status, "needs_session");
  assert.equal(mock.calls.length, 2);
  assert.equal(result.checks.database, "not_checked");
});

test("a valid session checks the entire schema and only its own Storage prefix", async () => {
  const mock = fixture();
  const result = await checkSupabaseConnection({ ...options, accessToken: "private-token", fetchImpl: mock.fetchImpl });
  assert.equal(result.status, "ok");
  assert.equal(Object.keys(result.tables).length, Object.keys(DATABASE_TABLES).length);
  assert.ok(mock.calls.filter(call => call.path.startsWith("/rest/")).every(call => call.init.method === "HEAD"));
  assert.deepEqual(JSON.parse(mock.calls.at(-1).init.body), { prefix: `${identity}/`, limit: 1, offset: 0 });
  assert.ok(mock.calls.every(call => call.init.cache === "no-store" && call.init.redirect === "error"));
  const encoded = JSON.stringify(result);
  assert.ok(!encoded.includes("private-token") && !encoded.includes(identity) && !encoded.includes(options.key));
});

test("a missing latest migration is reported even when authentication succeeds", async () => {
  const mock = fixture({ failedTable: "ecological_quadrat_reviews" });
  const result = await checkSupabaseConnection({ ...options, accessToken: "token", fetchImpl: mock.fetchImpl });
  assert.equal(result.status, "degraded");
  assert.equal(result.checks.database, "failed");
  assert.equal(result.tables.ecological_quadrat_reviews, "failed");
  assert.equal(result.checks.storage, "ok");
});

test("a failed private bucket probe cannot be presented as a healthy installation", async () => {
  const mock = fixture({ storageStatus: 404 });
  const result = await checkSupabaseConnection({ ...options, accessToken: "token", fetchImpl: mock.fetchImpl });
  assert.equal(result.status, "degraded");
  assert.equal(result.checks.database, "ok");
  assert.equal(result.checks.storage, "failed");
});

test("network failure returns a bounded diagnostic without exception or credentials", async () => {
  const result = await checkSupabaseConnection({ ...options, fetchImpl: async () => { throw new Error(options.key); } });
  assert.equal(result.status, "unavailable");
  assert.equal(result.checks.api, "failed");
  assert.ok(!JSON.stringify(result).includes(options.key));
});

import { strict as assert } from "node:assert";
import { test, beforeEach, afterEach } from "node:test";
import type { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { startGoogle as startWithFactory, finishGoogle as finishWithFactory } from "./google-server";

let factory: typeof createServerClient;
const startGoogle = (request: NextRequest) => startWithFactory(request, factory);
const finishGoogle = (request: NextRequest) => finishWithFactory(request, factory);

const origin = "https://app.example.com";
const anon = { id: "original", is_anonymous: true };
const member = { ...anon, is_anonymous: false, email: "example@example.com", identities: [{ provider: "google" }] };
let current: typeof anon | null;
let exchanged = member;
let projectCount: number | null;
let exchangeFails = false;
let calls: string[];
let write: (cookies: { name: string; value: string; options: object }[]) => void;
const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const oldKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
beforeEach(() => {
  current = anon; exchanged = member; projectCount = 3; calls = []; exchangeFails = false;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-test-placeholder";
  const fake = {
    auth: {
      getUser: async () => ({ data: { user: current }, error: current ? null : { name: "AuthSessionMissingError" } }),
      linkIdentity: async () => { calls.push("link"); write([{ name: "pkce", value: "challenge", options: { path: "/" } }]); return { data: { url: "https://accounts.google.com/o/oauth2/v2/auth" }, error: null }; },
      signInWithOAuth: async () => { calls.push("signin"); return { data: { url: "https://example.supabase.co/auth/v1/authorize" }, error: null }; },
      exchangeCodeForSession: async () => { calls.push("exchange"); write([{ name: "sb-session", value: "new-session", options: { path: "/" } }]); return { data: { user: exchanged }, error: exchangeFails ? { message: "invalid code" } : null }; },
    },
    from: () => ({ select: () => ({ eq: async () => ({ count: projectCount, error: projectCount === null ? { message: "unavailable" } : null }) }) }),
  };
  factory = ((_url: unknown, _key: unknown, options: { cookies: { setAll: typeof write } }) => {
    write = options.cookies.setAll; return fake;
  }) as unknown as typeof createServerClient;
});
afterEach(() => {
  if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
  if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = oldKey;
});
function start(action = "connect", requestOrigin = origin) {
  return new NextRequest(`${origin}/auth/google`, { method: "POST", headers: { origin: requestOrigin }, body: new URLSearchParams({ action }) });
}
function callback(intent = "original", query = "code=valid") {
  return new NextRequest(`${origin}/auth/callback?${query}`, { headers: { cookie: `lichen-google-intent=${intent}; sb-session=old-session` } });
}
test("start links existing UID and sets HTTP-only intent plus PKCE", async () => {
  const response = await startGoogle(start());
  assert.deepEqual(calls, ["link"]);
  assert.equal(response.cookies.get("lichen-google-intent")?.value, "original");
  assert.equal(response.cookies.get("lichen-google-intent")?.httpOnly, true);
  assert.equal(response.cookies.get("pkce")?.value, "challenge");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("cross-site POST rejected before SDK use", async () => {
  assert.equal((await startGoogle(start("connect", "https://evil.example"))).status, 403);
  assert.deepEqual(calls, []);
});
test("recovery cannot abandon saved projects", async () => {
  const response = await startGoogle(start("recover"));
  assert.match(response.headers.get("location")!, /status=protect/); assert.deepEqual(calls, []);
});
test("new browser begins signin, not an anonymous account", async () => {
  current = null; const response = await startGoogle(start());
  assert.deepEqual(calls, ["signin"]); assert.equal(response.cookies.get("lichen-google-intent")?.value, "signin");
});
test("success retains UID and commits cookies only after validation", async () => {
  const response = await finishGoogle(callback());
  assert.match(response.headers.get("location")!, /status=connected/);
  assert.equal(response.cookies.get("sb-session")?.value, "new-session");
  assert.equal(response.cookies.get("lichen-google-intent")?.maxAge, 0);
});
test("UID mismatch does not overwrite existing session", async () => {
  exchanged = { ...member, id: "different" }; const response = await finishGoogle(callback());
  assert.match(response.headers.get("location")!, /status=failed/);
  assert.equal(response.cookies.has("sb-session"), false);
});
test("failed exchange preserves existing session", async () => {
  exchangeFails = true; const response = await finishGoogle(callback());
  assert.equal(response.cookies.has("sb-session"), false); assert.match(response.headers.get("location")!, /status=failed/);
});
test("conflict never exchanges or changes session", async () => {
  const response = await finishGoogle(callback("original", "error=access_denied&error_code=identity_already_exists"));
  assert.match(response.headers.get("location")!, /status=conflict/); assert.deepEqual(calls, []);
  assert.equal(response.cookies.has("sb-session"), false);
});
test("cancelled auth is safe and never reflects a provider description", async () => {
  const response = await finishGoogle(callback("original", "error=access_denied&error_description=secret"));
  assert.equal(response.headers.get("location"), `${origin}/cuenta?status=cancelled`); assert.deepEqual(calls, []);
});
test("missing intent or code cannot exchange a session", async () => {
  assert.match((await finishGoogle(new NextRequest(`${origin}/auth/callback?code=valid`))).headers.get("location")!, /status=expired/);
  assert.match((await finishGoogle(callback("original", ""))).headers.get("location")!, /status=expired/);
  assert.deepEqual(calls, []);
});
test("callback cannot be redirected offsite by next parameter", async () => {
  const response = await finishGoogle(callback("original", "code=valid&next=https://evil.example"));
  assert.equal(response.headers.get("location"), `${origin}/cuenta?status=connected`);
});
test("session changed in another tab blocks a new-browser callback", async () => {
  const response = await finishGoogle(callback("signin"));
  assert.match(response.headers.get("location")!, /status=protect/); assert.deepEqual(calls, []);
});
test("recovery rechecks projects before changing the session", async () => {
  const response = await finishGoogle(callback("recover:original"));
  assert.match(response.headers.get("location")!, /status=protect/); assert.deepEqual(calls, []);
});
test("explicit empty-session recovery can finish", async () => {
  projectCount = 0; exchanged = { ...member, id: "restored" };
  const response = await finishGoogle(callback("recover:original"));
  assert.match(response.headers.get("location")!, /status=connected/);
});

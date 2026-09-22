import test from "node:test";
import assert from "node:assert/strict";
import { createBioclipFetch } from "./bioclip";

const origin = "https://lichendr-bioclip-preview-5ccbk3mcba-ue.a.run.app";
const request = () => new Request("https://app.example/api/region-suggestions", {
  headers: { "x-vercel-oidc-token": "test-invocation-identity" },
});
function fixture(environment = "production", incoming = request(), workerUrl = origin) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    if (url === "https://sts.googleapis.com/v1/token")
      return Response.json({ access_token: "test-exchanged-token" });
    if (url.endsWith(":generateIdToken"))
      return Response.json({ token: "test-google-identity" });
    return Response.json({ ok: true });
  };
  return { calls, fetchImpl, run: createBioclipFetch(incoming, { enabled: true, environment, workerUrl, fetchImpl }) };
}

for (const environment of ["preview", "production"]) {
  test(`${environment}: lazy exchange, private target, independent bearer, per-request reuse`, async () => {
    const { calls, run } = fixture(environment);
    assert.equal(calls.length, 0);
    await run(origin + "/health", { headers: { Authorization: "Bearer test-worker-secret" } });
    await run(origin + "/suggest-regions", { method: "POST", body: "{}", headers: { Authorization: "Bearer test-worker-secret" } });
    assert.equal(calls.length, 4);
    const exchange = JSON.parse(String(calls[0].init?.body));
    assert.equal(exchange.subjectToken, "test-invocation-identity");
    assert.equal(exchange.audience, "//iam.googleapis.com/projects/838586175073/locations/global/workloadIdentityPools/lichendr-vercel-preview/providers/vercel");
    assert.equal(calls[1].url, "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/lichendr-vercel-preview@lichendr.iam.gserviceaccount.com:generateIdToken");
    assert.equal(JSON.parse(String(calls[1].init?.body)).audience, origin);
    for (const call of calls.slice(2)) {
      const headers = new Headers(call.init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer test-worker-secret");
      assert.equal(headers.get("X-Serverless-Authorization"), "Bearer test-google-identity");
      assert.equal(call.init?.redirect, "error");
      assert.equal(call.init?.cache, "no-store");
    }
  });
}

test("Storage requests never trigger or receive Google authentication", async () => {
  const { calls, run } = fixture();
  await run("https://storage.example/signed/photo.jpg");
  assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0].init?.headers).has("X-Serverless-Authorization"), false);
});

for (const environment of ["development", "staging", ""]) {
  test(`reject unapproved environment ${environment || "empty"} before network`, async () => {
    const { calls, run } = fixture(environment);
    await assert.rejects(run(origin + "/health"), /restricted/);
    assert.equal(calls.length, 0);
  });
}

test("reject an unapproved worker before credential exchange", async () => {
  const { calls, run } = fixture("production", request(), "https://unapproved.example");
  await assert.rejects(run("https://unapproved.example/health"), /restricted/);
  assert.equal(calls.length, 0);
});

test("reject unapproved paths before credential exchange", async () => {
  const { calls, run } = fixture();
  await assert.rejects(run(origin + "/admin"), /path not allowed/);
  assert.equal(calls.length, 0);
});

test("missing fresh invocation identity fails without using a build token", async () => {
  const { calls, run } = fixture("production", new Request("https://app.example"));
  await assert.rejects(run(origin + "/health"), /identity unavailable/);
  assert.equal(calls.length, 0);
});

test("disabled IAM preserves the existing local-worker fetch", () => {
  const { fetchImpl } = fixture();
  assert.equal(createBioclipFetch(request(), { enabled: false, fetchImpl }), fetchImpl);
});

test("failed exchanges are redacted and can retry in the same invocation", async () => {
  let exchanges = 0;
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input) === "https://sts.googleapis.com/v1/token") {
      exchanges += 1;
      return exchanges === 1 ? new Response("sensitive-detail", { status: 403 }) : Response.json({ access_token: "test-access" });
    }
    if (String(input).endsWith(":generateIdToken")) return Response.json({ token: "test-id" });
    return Response.json({ ok: true });
  };
  const run = createBioclipFetch(request(), { enabled: true, environment: "production", workerUrl: origin, fetchImpl });
  await assert.rejects(run(origin + "/health"), { message: "BioCLIP identity exchange failed" });
  assert.equal((await run(origin + "/health")).status, 200);
  assert.equal(exchanges, 2);
});

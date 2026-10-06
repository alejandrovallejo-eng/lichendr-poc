import test from "node:test";
import assert from "node:assert/strict";
import { createDeveloperBioclipFetch, BIOCLIP_CLOUD_RUN_ORIGIN as origin } from "./bioclip-developer-auth";

test("developer IAM is lazy, scoped to the approved worker and separate from its bearer", async () => {
  let identities = 0;
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const run = createDeveloperBioclipFetch({ workerUrl: origin,
    identityToken: async () => { identities++; return "test-google-token"; },
    fetchImpl: async (input, init) => { calls.push({ input, init }); return Response.json({ ok: true }); },
  });
  await run("https://storage.example/private.jpg");
  assert.equal(identities, 0);
  assert.equal(new Headers(calls[0].init?.headers).has("X-Serverless-Authorization"), false);
  await run(`${origin}/health`, { headers: { Authorization: "Bearer worker-token" } });
  await run(`${origin}/suggest-regions`, { method: "POST" });
  assert.equal(identities, 1);
  const headers = new Headers(calls[1].init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer worker-token");
  assert.equal(headers.get("X-Serverless-Authorization"), "Bearer test-google-token");
  assert.equal(calls[1].init?.redirect, "error");
});

test("unapproved destinations and paths cannot receive developer credentials", async () => {
  let identities = 0;
  const identityToken = async () => { identities++; return "token"; };
  const wrongWorker = createDeveloperBioclipFetch({ workerUrl: "https://other.example", identityToken });
  await assert.rejects(wrongWorker("https://other.example/health"), /restricted/);
  await assert.rejects(createDeveloperBioclipFetch({ workerUrl: origin, identityToken })(`${origin}/admin`), /path not allowed/);
  assert.equal(identities, 0);
});

test("failed identity refreshes can be retried within the request", async () => {
  let attempts = 0;
  const run = createDeveloperBioclipFetch({ workerUrl: origin,
    identityToken: async () => { if (++attempts === 1) throw new Error("not signed in"); return "token"; },
    fetchImpl: async () => Response.json({ ok: true }),
  });
  await assert.rejects(run(`${origin}/health`), /not signed in/);
  assert.equal((await run(`${origin}/health`)).status, 200);
  assert.equal(attempts, 2);
});

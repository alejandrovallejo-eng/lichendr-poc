import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForVisionReady } from "./vision-ready";

test("waits for cold start, without uploading or retrying an image", async () => {
  const urls: string[] = [];
  const request = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ status: urls.length < 3 ? "loading" : "ready" }));
  }) as typeof fetch;
  await waitForVisionReady(new AbortController().signal, request, async () => {});
  assert.deepEqual(urls, Array(3).fill("/api/vision/ready"));
});

test("stops after bounded failures", async () => {
  let calls = 0;
  const request = (async () => { calls += 1; return new Response("Unavailable", { status: 503 }); }) as typeof fetch;
  await assert.rejects(waitForVisionReady(new AbortController().signal, request, async () => {}));
  assert.equal(calls, 15);
});

test("cancelled requests do not continue polling", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const request = (async () => { calls += 1; return new Response(); }) as typeof fetch;
  await assert.rejects(waitForVisionReady(controller.signal, request, async () => {}), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("cancellation during a failed poll stops before another request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const request = (async () => {
    calls += 1;
    controller.abort();
    return new Response("Unavailable", { status: 503 });
  }) as typeof fetch;
  await assert.rejects(waitForVisionReady(controller.signal, request), { name: "AbortError" });
  assert.equal(calls, 1);
});

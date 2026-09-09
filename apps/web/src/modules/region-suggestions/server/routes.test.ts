// Route-level tests of the assisted journey.
//
// These drive the handlers the Next.js routes delegate to, with injected
// dependencies, so what is exercised is the ROUTE behaviour (flag, session,
// ownership, series readiness, serial coordination, proxy usage, verified
// reuse), not only a helper in isolation.
//
// Every fixture is synthetic: the reviewer's photographs and the trained head
// are not available in this environment, so no claim here is a claim about real
// weights or real photographs.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import sharp from "sharp";
import { handleSamPrepare, handleSamRelease, handleSamSegment } from "./sam-handlers.ts";
import { handleRegionSuggestions } from "./suggest.ts";
import { issueSessionTicket } from "./session-ticket.ts";
import { resetSerialCoordinator } from "./serial.ts";
import { clearSuggestionCache } from "../../../app/api/vision/region-suggestions/cache.ts";

const SUPABASE_URL = "https://project.supabase.co";
const TOKEN = "0123456789abcdef0123456789abcdef";
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.VISION_SERVICE_TOKEN = TOKEN;

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const TREE = "33333333-3333-4333-8333-333333333333";
const SERIES = "series-1";
const IMAGE_IDS: Record<string, string> = {
  N: "44444444-4444-4444-8444-444444444441",
  E: "44444444-4444-4444-8444-444444444442",
  S: "44444444-4444-4444-8444-444444444443",
  W: "44444444-4444-4444-8444-444444444444",
};

// The synthetic original is deliberately larger than the vision service's
// 20 MP decode limit: 5712 x 4284 = 24 470 208 pixels. It is NEVER read by the
// journey; only its 2048 px proxy is.
const ORIGINAL_WIDTH = 5712;
const ORIGINAL_HEIGHT = 4284;
const PROXY_WIDTH = 2048;
const PROXY_HEIGHT = 1536;

let proxyBytesCache: Buffer | null = null;

async function proxyBytes(): Promise<Buffer> {
  if (!proxyBytesCache) {
    proxyBytesCache = await sharp({
      create: {
        width: PROXY_WIDTH,
        height: PROXY_HEIGHT,
        channels: 3,
        background: { r: 90, g: 110, b: 70 },
      },
    })
      .jpeg({ quality: 70 })
      .toBuffer();
  }
  return proxyBytesCache;
}

function sourceOf(imageId: string) {
  return {
    storage_bucket: "lichen-images",
    storage_path: `${OWNER}/originals/${imageId}.jpg`,
    mime_type: "image/jpeg",
    file_size_bytes: 6_037_725,
  };
}

function manifestFor(imageId: string, proxySizeBytes: number) {
  const unsigned = {
    version: 1 as const,
    imageId,
    sourcePath: sourceOf(imageId).storage_path,
    sourceMime: "image/jpeg",
    sourceSizeBytes: sourceOf(imageId).file_size_bytes,
    proxyPath: `${OWNER}/analysis-proxies/${imageId}/v1.jpg`,
    proxyMime: "image/jpeg" as const,
    proxySizeBytes,
    originalWidth: ORIGINAL_WIDTH,
    originalHeight: ORIGINAL_HEIGHT,
    proxyWidth: PROXY_WIDTH,
    proxyHeight: PROXY_HEIGHT,
  };
  return {
    ...unsigned,
    signature: createHmac("sha256", TOKEN).update(JSON.stringify(unsigned)).digest("hex"),
  };
}

interface SupabaseOptions {
  user?: string | null;
  directions?: string[];
  signedPaths: string[];
}

function fakeSupabase(options: SupabaseOptions, proxySize: number) {
  const directions = options.directions ?? ["N", "E", "S", "W"];
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    const query = {
      select() {
        return query;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return query;
      },
      async maybeSingle() {
        if (table === "capture_views") {
          const direction = filters.direction as string;
          if (IMAGE_IDS[direction] !== filters.image_id) return { data: null, error: null };
          return {
            data: {
              id: `view-${direction}`,
              direction,
              image_id: filters.image_id,
              capture_series_id: SERIES,
              capture_series: { id: SERIES, tree_sample_id: TREE },
            },
            error: null,
          };
        }
        if (table === "images") {
          return { data: sourceOf(filters.id as string), error: null };
        }
        return { data: null, error: null };
      },
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        if (table === "capture_views") {
          return Promise.resolve({
            data: directions.map((direction) => ({
              direction,
              image_id: IMAGE_IDS[direction],
            })),
            error: null,
          }).then(resolve);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return query;
  };

  return {
    auth: {
      async getUser() {
        return options.user === null
          ? { data: { user: null }, error: new Error("no session") }
          : { data: { user: { id: options.user ?? OWNER } }, error: null };
      },
    },
    from: builder,
    storage: {
      from() {
        return {
          async info(path: string) {
            const imageId = path.split("/")[2];
            return {
              data: {
                size: proxySize,
                metadata: {
                  analysisManifest: JSON.stringify(manifestFor(imageId, proxySize)),
                },
              },
              error: null,
            };
          },
          async createSignedUrl(path: string) {
            options.signedPaths.push(path);
            const encoded = path.split("/").map(encodeURIComponent).join("/");
            return {
              data: {
                signedUrl: `${SUPABASE_URL}/storage/v1/object/sign/lichen-images/${encoded}?token=abc`,
              },
              error: null,
            };
          },
        };
      },
    },
  } as never;
}

interface FetchLog {
  urls: string[];
  forwardedImages: Buffer[];
  concurrent: number;
  maxConcurrent: number;
}

function fakeFetch(
  log: FetchLog,
  bytes: Buffer,
  overrides: {
    health?: Record<string, unknown> | null;
    suggestDelayMs?: number;
    onSuggest?: () => void;
  } = {},
): typeof fetch {
  let sessionCounter = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    log.urls.push(url);
    if (url.startsWith(SUPABASE_URL)) {
      return new Response(new Uint8Array(bytes), { status: 200 });
    }
    if (url.endsWith("/prepare")) {
      log.concurrent += 1;
      log.maxConcurrent = Math.max(log.maxConcurrent, log.concurrent);
      const form = init?.body as FormData;
      const file = form.get("image") as Blob;
      log.forwardedImages.push(Buffer.from(await file.arrayBuffer()));
      await new Promise((resolve) => setTimeout(resolve, 20));
      log.concurrent -= 1;
      sessionCounter += 1;
      return Response.json({
        sessionId: `session-abcdef-${sessionCounter}`,
        width: PROXY_WIDTH,
        height: PROXY_HEIGHT,
      });
    }
    if (url.endsWith("/segment")) {
      return Response.json({ candidates: [{ id: "c1", score: 0.5 }], recommendedIndex: 0 });
    }
    if (url.endsWith("/health")) {
      if (overrides.health === null) return new Response("nope", { status: 503 });
      return Response.json(
        overrides.health ?? {
          encoderId: "imageomics/bioclip-2@2957b322",
          backend: "zeroshot",
          headSha256: null,
          headError: null,
        },
      );
    }
    if (url.endsWith("/suggest-regions")) {
      overrides.onSuggest?.();
      if (overrides.suggestDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, overrides.suggestDelayMs));
      }
      return Response.json({
        backend: "zeroshot",
        encoderId: "imageomics/bioclip-2@2957b322",
        headSha256: null,
        suggestions: [
          {
            regionId: "sam-0",
            ranking: [{ label: "lichen", labelEs: "liquen", rawScore: 0.4 }],
          },
        ],
      });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

function emptyLog(): FetchLog {
  return { urls: [], forwardedImages: [], concurrent: 0, maxConcurrent: 0 };
}

function jsonRequest(body: unknown): Request {
  const text = JSON.stringify(body);
  return new Request("https://app.example/api", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(text.length) },
    body: text,
  });
}

async function prepareDeps(
  options: Partial<SupabaseOptions> & { log: FetchLog; enabled?: boolean },
) {
  const bytes = await proxyBytes();
  const signedPaths = options.signedPaths ?? [];
  return {
    supabase: fakeSupabase(
      { user: options.user, directions: options.directions, signedPaths },
      bytes.byteLength,
    ),
    enabled: options.enabled ?? true,
    serviceUrl: "http://127.0.0.1:8000",
    authHeaders: {},
    fetchImpl: fakeFetch(options.log, bytes),
    signedPaths,
  };
}

function reset(): void {
  clearSuggestionCache();
  resetSerialCoordinator();
}

test("flag off means not a single MobileSAM call", async () => {
  reset();
  const log = emptyLog();
  const deps = await prepareDeps({ log, enabled: false });
  const result = await handleSamPrepare(
    deps,
    jsonRequest({ imageId: IMAGE_IDS.N, treeSampleId: TREE, direction: "N" }),
  );
  assert.equal(result.status, 503);
  assert.deepEqual(log.urls, []);
});

test("an unauthenticated caller never reaches MobileSAM", async () => {
  reset();
  const log = emptyLog();
  const deps = await prepareDeps({ log, user: null });
  const result = await handleSamPrepare(
    deps,
    jsonRequest({ imageId: IMAGE_IDS.N, treeSampleId: TREE, direction: "N" }),
  );
  assert.equal(result.status, 401);
  assert.deepEqual(log.urls, []);
});

test("a photograph that is not that view of that tree never reaches MobileSAM", async () => {
  reset();
  const log = emptyLog();
  const deps = await prepareDeps({ log });
  const result = await handleSamPrepare(
    deps,
    // The image of the N view announced as the E view.
    jsonRequest({ imageId: IMAGE_IDS.N, treeSampleId: TREE, direction: "E" }),
  );
  assert.equal(result.status, 404);
  assert.deepEqual(log.urls, []);
});

test("an incomplete series never reaches MobileSAM", async () => {
  reset();
  const log = emptyLog();
  const deps = await prepareDeps({ log, directions: ["N", "E", "S"] });
  const result = await handleSamPrepare(
    deps,
    jsonRequest({ imageId: IMAGE_IDS.N, treeSampleId: TREE, direction: "N" }),
  );
  assert.equal(result.status, 409);
  assert.deepEqual(log.urls, []);
});

test("a 24.47 MP original is segmented through its proxy, never itself", async () => {
  reset();
  const log = emptyLog();
  const signedPaths: string[] = [];
  const deps = await prepareDeps({ log, signedPaths });
  const result = await handleSamPrepare(
    deps,
    jsonRequest({ imageId: IMAGE_IDS.N, treeSampleId: TREE, direction: "N" }),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.space, "analysis_proxy");
  assert.equal(result.body.width, PROXY_WIDTH);

  // Only proxy paths were signed: the original was never downloaded again.
  assert.ok(signedPaths.length > 0);
  assert.ok(signedPaths.every((path) => path.includes("/analysis-proxies/")));
  assert.ok(!signedPaths.some((path) => path.includes("/originals/")));

  // What MobileSAM received decodes well under the 20 MP limit that rejects the
  // original ("Decoded image is too large").
  assert.equal(log.forwardedImages.length, 1);
  const metadata = await sharp(log.forwardedImages[0]).metadata();
  assert.ok((metadata.width ?? 0) * (metadata.height ?? 0) < 20_000_000);
  assert.ok(ORIGINAL_WIDTH * ORIGINAL_HEIGHT > 20_000_000);
});

test("four panels preparing at once are serialised within one instance", async () => {
  reset();
  const log = emptyLog();
  const deps = await prepareDeps({ log });
  const results = await Promise.all(
    (["N", "E", "S", "W"] as const).map((direction) =>
      handleSamPrepare(
        deps,
        jsonRequest({ imageId: IMAGE_IDS[direction], treeSampleId: TREE, direction }),
      ),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 200, 200, 200],
  );
  assert.equal(log.maxConcurrent, 1);
});

test("a session prepared in one instance is segmented in another", async () => {
  // Vercel gives no affinity between the invocation that prepares and the one
  // that segments (https://vercel.com/docs/functions). This simulates the second
  // instance in the same way the reviewer reproduced it with a fresh process:
  // NOTHING is carried over except what the browser sends back.
  reset();
  const log = emptyLog();
  const instanceA = await prepareDeps({ log });
  const prepared = await handleSamPrepare(
    instanceA,
    jsonRequest({ imageId: IMAGE_IDS.N, treeSampleId: TREE, direction: "N" }),
  );
  assert.equal(prepared.status, 200);
  const sessionId = prepared.body.sessionId as string;
  const ticket = prepared.body.ticket as string;
  assert.equal(typeof ticket, "string");

  // A cold instance: no shared module state at all.
  reset();
  const instanceB = await prepareDeps({ log: emptyLog() });
  const segmented = await handleSamSegment(
    instanceB,
    jsonRequest({ sessionId, ticket, points: [{ x: 10, y: 10, label: 1 }] }),
  );
  assert.equal(segmented.status, 200);
  assert.equal(segmented.body.space, "analysis_proxy");
});

test("a session of another owner cannot be segmented", async () => {
  reset();
  const log = emptyLog();
  const deps = await prepareDeps({ log });
  const prepared = await handleSamPrepare(
    deps,
    jsonRequest({ imageId: IMAGE_IDS.N, treeSampleId: TREE, direction: "N" }),
  );
  const sessionId = prepared.body.sessionId as string;
  const ticket = prepared.body.ticket as string;

  const intruderLog = emptyLog();
  const intruderDeps = await prepareDeps({ log: intruderLog, user: OTHER_OWNER });
  const result = await handleSamSegment(
    intruderDeps,
    jsonRequest({ sessionId, ticket, points: [{ x: 10, y: 10, label: 1 }] }),
  );
  assert.equal(result.status, 404);
  // A stolen ticket does not reach MobileSAM either.
  assert.ok(!intruderLog.urls.some((url) => url.endsWith("/segment")));

  const owned = await handleSamSegment(
    deps,
    jsonRequest({ sessionId, ticket, points: [{ x: 10, y: 10, label: 1 }] }),
  );
  assert.equal(owned.status, 200);
});

test("a tampered, forged or absent ticket is refused", async () => {
  reset();
  const log = emptyLog();
  const deps = await prepareDeps({ log });
  const prepared = await handleSamPrepare(
    deps,
    jsonRequest({ imageId: IMAGE_IDS.N, treeSampleId: TREE, direction: "N" }),
  );
  const sessionId = prepared.body.sessionId as string;
  const ticket = prepared.body.ticket as string;
  const [payload, signature] = ticket.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

  // Same signature, claims rewritten to another owner and another view.
  const rewritten = Buffer.from(
    JSON.stringify({ ...claims, ownerId: OTHER_OWNER, direction: "E" }),
    "utf8",
  ).toString("base64url");

  const attempts = [
    undefined,
    "",
    "not-a-ticket",
    `${rewritten}.${signature}`,
    `${payload}.${"0".repeat(64)}`,
    // A ticket for a session id that is not the one being segmented.
    issueSessionTicket({
      sessionId: "session-abcdef-999",
      ownerId: OWNER,
      imageId: IMAGE_IDS.N,
      treeSampleId: TREE,
      direction: "N",
      width: PROXY_WIDTH,
      height: PROXY_HEIGHT,
    }),
  ];
  for (const attempt of attempts) {
    const attemptLog = emptyLog();
    const attemptDeps = await prepareDeps({ log: attemptLog });
    const result = await handleSamSegment(
      attemptDeps,
      jsonRequest({ sessionId, ticket: attempt, points: [{ x: 10, y: 10, label: 1 }] }),
    );
    assert.ok(result.status === 400 || result.status === 404, `status ${result.status}`);
    assert.ok(!attemptLog.urls.some((url) => url.endsWith("/segment")));
  }
});

test("an expired ticket is refused even with a valid signature", async () => {
  reset();
  const log = emptyLog();
  const deps = await prepareDeps({ log });
  const expired = issueSessionTicket(
    {
      sessionId: "session-abcdef-1",
      ownerId: OWNER,
      imageId: IMAGE_IDS.N,
      treeSampleId: TREE,
      direction: "N",
      width: PROXY_WIDTH,
      height: PROXY_HEIGHT,
    },
    Date.now() - 60_000,
    1_000,
  );
  const result = await handleSamSegment(
    deps,
    jsonRequest({
      sessionId: "session-abcdef-1",
      ticket: expired,
      points: [{ x: 10, y: 10, label: 1 }],
    }),
  );
  assert.equal(result.status, 404);
  assert.ok(!log.urls.some((url) => url.endsWith("/segment")));
});

test("releasing works from another instance and only for the owner", async () => {
  reset();
  const prepared = await handleSamPrepare(
    await prepareDeps({ log: emptyLog() }),
    jsonRequest({ imageId: IMAGE_IDS.N, treeSampleId: TREE, direction: "N" }),
  );
  const sessionId = prepared.body.sessionId as string;
  const ticket = prepared.body.ticket as string;

  reset();
  const intruderLog = emptyLog();
  const intruder = await handleSamRelease(
    await prepareDeps({ log: intruderLog, user: OTHER_OWNER }),
    sessionId,
    ticket,
  );
  assert.equal(intruder.status, 404);
  assert.ok(!intruderLog.urls.some((url) => url.includes("/sessions/")));

  const ownerLog = emptyLog();
  const released = await handleSamRelease(
    await prepareDeps({ log: ownerLog }),
    sessionId,
    ticket,
  );
  assert.equal(released.status, 200);
  assert.equal(released.body.released, true);
  assert.ok(ownerLog.urls.some((url) => url.includes("/sessions/")));
});

function suggestRequest() {
  return jsonRequest({
    imageId: IMAGE_IDS.N,
    treeSampleId: TREE,
    direction: "N",
    requestToken: "token1",
    sourceWidth: 1024,
    sourceHeight: 768,
    regions: [
      {
        regionId: "sam-0",
        box: { x: 100, y: 100, width: 200, height: 150 },
        maskAreaPixels: 12_000,
        maskSha: "abc123",
        samScore: 0.7,
      },
    ],
  });
}

async function suggestDeps(log: FetchLog, health?: Record<string, unknown> | null) {
  const bytes = await proxyBytes();
  return {
    supabase: fakeSupabase({ signedPaths: [] }, bytes.byteLength),
    enabled: true,
    workerUrl: "http://127.0.0.1:8500",
    authHeaders: {},
    preprocessMode: "whole_crop_pad",
    timeoutMs: 5_000,
    fetchImpl: fakeFetch(log, bytes, { health }),
  };
}

test("a verified identity enables reuse and a changed head invalidates it", async () => {
  reset();
  const log = emptyLog();
  const zeroShot = await suggestDeps(log);
  const first = await handleRegionSuggestions(zeroShot, suggestRequest());
  assert.equal(first.status, 200);
  assert.equal(first.body.cached, false);

  const second = await handleRegionSuggestions(zeroShot, suggestRequest());
  assert.equal(second.status, 200);
  assert.equal(second.body.cached, true);

  // Same pixels and same masks, but the worker now reports a trained head: the
  // previous entry must NOT answer this request.
  const headLog = emptyLog();
  const withHead = await suggestDeps(headLog, {
    encoderId: "imageomics/bioclip-2@2957b322",
    backend: "ridge_head",
    headSha256: "1fbef280fbc574488996c50cdecf83fc05636366c4b4520581f6da3707e4a33e",
    headError: null,
  });
  const third = await handleRegionSuggestions(withHead, suggestRequest());
  assert.equal(third.status, 200);
  assert.equal(third.body.cached, false);
  assert.ok(headLog.urls.some((url) => url.endsWith("/suggest-regions")));
});

test("an unverifiable identity disables reuse instead of guessing one", async () => {
  reset();
  const log = emptyLog();
  const deps = await suggestDeps(log, null);
  const first = await handleRegionSuggestions(deps, suggestRequest());
  assert.equal(first.status, 200);
  assert.equal(first.body.cached, false);
  const second = await handleRegionSuggestions(deps, suggestRequest());
  assert.equal(second.body.cached, false);
  assert.equal(
    log.urls.filter((url) => url.endsWith("/suggest-regions")).length,
    2,
  );
});

test("suggestions are refused before authorisation and with the flag off", async () => {
  reset();
  const log = emptyLog();
  const disabled = { ...(await suggestDeps(log)), enabled: false };
  assert.equal((await handleRegionSuggestions(disabled, suggestRequest())).status, 503);
  assert.deepEqual(log.urls, []);

  const bytes = await proxyBytes();
  const anonymous = {
    ...(await suggestDeps(log)),
    supabase: fakeSupabase({ user: null, signedPaths: [] }, bytes.byteLength),
  };
  assert.equal((await handleRegionSuggestions(anonymous, suggestRequest())).status, 401);
  assert.deepEqual(log.urls, []);
});

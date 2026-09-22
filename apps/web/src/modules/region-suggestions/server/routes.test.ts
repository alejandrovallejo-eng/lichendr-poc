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
import type { Box } from "../types.ts";
import { EXPERIMENTAL_MODEL, EXPERIMENTAL_BUNDLE, EXPERIMENTAL_LABELS } from "../experimental.ts";

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
  suggestBodyBytes: number[];
  suggestCrops: Array<Array<{ regionId: string; pngBytes: number }>>;
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
      // The stand-in worker behaves like the real one: it answers exactly the
      // crops it received, so a crop dropped by the route shows up as a missing
      // label instead of being invisible.
      const body = JSON.parse(String(init?.body)) as {
        regions: { regionId: string; cropPngBase64: string }[];
      };
      log.suggestBodyBytes.push(Buffer.byteLength(String(init?.body), "utf8"));
      log.suggestCrops.push(
        body.regions.map((region) => ({
          regionId: region.regionId,
          pngBytes: Buffer.from(region.cropPngBase64, "base64").byteLength,
        })),
      );
      return Response.json({
        backend: "zeroshot",
        encoderId: "imageomics/bioclip-2@2957b322",
        headSha256: null,
        suggestions: body.regions.map((region) => ({
          regionId: region.regionId,
          ranking: [{ label: "lichen", labelEs: "liquen", rawScore: 0.4 }],
        })),
      });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

function emptyLog(): FetchLog {
  return {
    urls: [],
    forwardedImages: [],
    concurrent: 0,
    maxConcurrent: 0,
    suggestBodyBytes: [],
    suggestCrops: [],
  };
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

test("the sequential journey can analyse North before the other photos exist", async () => {
  reset();
  const log = emptyLog();
  const deps = await prepareDeps({ log, directions: ["N"] });
  const result = await handleSamPrepare(
    deps,
    jsonRequest({ imageId: IMAGE_IDS.N, treeSampleId: TREE, direction: "N" }),
  );
  assert.equal(result.status, 200);
  assert.equal(log.forwardedImages.length, 1);
});

test("sequential readiness still rejects an inactive image and a foreign owner", async () => {
  for (const option of [{ directions: ["E"] }, { user: OTHER_OWNER }]) {
    reset(); const log = emptyLog(); const deps = await prepareDeps({ log, ...option });
    const result = await handleSamPrepare(deps, jsonRequest({ imageId: IMAGE_IDS.N, treeSampleId: TREE, direction: "N" }));
    assert.ok(result.status >= 400); assert.deepEqual(log.urls, []);
  }
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

function suggestRequest(extra: Record<string, unknown> = {}) {
  return jsonRequest({
    imageId: IMAGE_IDS.N,
    treeSampleId: TREE,
    direction: "N",
    requestToken: "token1",
    ...extra,
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

async function suggestDeps(
  log: FetchLog,
  health?: Record<string, unknown> | null,
  overrides: { bytes?: Buffer; workerBodyLimitBytes?: number } = {},
) {
  const bytes = overrides.bytes ?? (await proxyBytes());
  return {
    supabase: fakeSupabase({ signedPaths: [] }, bytes.byteLength),
    enabled: true,
    workerUrl: "http://127.0.0.1:8500",
    authHeaders: {},
    preprocessMode: "whole_crop_pad",
    timeoutMs: 5_000,
    workerBodyLimitBytes: overrides.workerBodyLimitBytes,
    fetchImpl: fakeFetch(log, bytes, { health }),
  };
}

// A FLAT proxy compresses to almost nothing, so it can never show the byte
test("experimental comparison is explicit, complete and isolated from habitual cache", async () => {
  reset(); const log = emptyLog(); const deps = await suggestDeps(log);
  const originalFetch = deps.fetchImpl;
  let calls = 0;
  deps.preprocessMode = "standard_center_crop";
  deps.fetchImpl = (async (input, init) => {
    const response = await originalFetch(input, init);
    if (!String(input).endsWith("/suggest-regions")) return response;
    const payload = JSON.parse(String(init?.body));
    if (!payload.experimental) return response;
    calls++;
    return Response.json({ ...await response.json(), experimental: {
      modelId: EXPERIMENTAL_MODEL, bundleSha256: EXPERIMENTAL_BUNDLE, experimental: true, preprocess: "standard_center_crop",
      suggestions: payload.regions.map((r: { regionId: string }) => ({ regionId: r.regionId, status: "pending", decision: "undetermined",
        ranking: EXPERIMENTAL_LABELS.map((label, i) => ({ label, rawScore: 1 - i * .1 })) })),
    } });
  }) as typeof fetch;
  const first = await handleRegionSuggestions(deps, suggestRequest());
  assert.equal(first.status, 200); assert.equal(first.body.experimental, undefined);
  for (let i = 0; i < 2; i++) {
    const result = await handleRegionSuggestions(deps, suggestRequest({ experimental: true }));
    assert.equal(result.status, 200); assert.equal(result.body.cached, false);
    assert.deepEqual(result.body.suggestions, first.body.suggestions);
    const comparison = result.body.experimental as { suggestions: { decision: string }[] };
    assert.equal(comparison.suggestions[0].decision, "undetermined");
  }
  assert.equal(calls, 2);
  const habitual = await handleRegionSuggestions(deps, suggestRequest());
  assert.equal(habitual.body.cached, true); assert.equal(habitual.body.experimental, undefined);
  assert.equal((await handleRegionSuggestions(deps, suggestRequest({ experimental: "true" }))).status, 400);
  deps.fetchImpl = originalFetch;
  assert.equal((await handleRegionSuggestions(deps, suggestRequest({ experimental: true }))).status, 502);
});

// budget failing. This one is real noise, like the bark the reviewer photographs:
// its crops are megabytes of incompressible PNG.
let texturedBytesCache: Buffer | null = null;

async function texturedProxyBytes(): Promise<Buffer> {
  if (!texturedBytesCache) {
    const raw = Buffer.alloc(PROXY_WIDTH * PROXY_HEIGHT * 3);
    let seed = 12345;
    for (let index = 0; index < raw.length; index += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      raw[index] = (seed >>> 16) & 0xff;
    }
    texturedBytesCache = await sharp(raw, {
      raw: { width: PROXY_WIDTH, height: PROXY_HEIGHT, channels: 3 },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
  }
  return texturedBytesCache;
}

function texturedRegions(count: number) {
  // Boxes spread over the proxy, all different, each large enough that its crop
  // is far over the 1 MiB per-crop cap before being reduced.
  return Array.from({ length: count }, (_, index) => ({
    regionId: `sam-${index}`,
    box: {
      x: 20 + (index % 4) * 230,
      y: 20 + Math.floor(index / 4) * 170,
      width: 220,
      height: 160,
    },
    maskAreaPixels: 10_000 + index,
    maskSha: `mask${index}`,
    samScore: 0.5,
  }));
}

test("a textured batch classifies every region instead of dropping crops silently", async () => {
  reset();
  const log = emptyLog();
  const deps = await suggestDeps(log, undefined, { bytes: await texturedProxyBytes() });
  const regions = texturedRegions(12);
  const result = await handleRegionSuggestions(
    deps,
    jsonRequest({
      imageId: IMAGE_IDS.N,
      treeSampleId: TREE,
      direction: "N",
      requestToken: "textured",
      sourceWidth: 1024,
      sourceHeight: 768,
      regions,
    }),
  );
  assert.equal(result.status, 200);
  // Twelve masks in, twelve labels out. Before the budget fix the crops of a
  // textured photograph were over 1 MiB and were skipped without saying so.
  const suggestions = result.body.suggestions as { regionId: string }[];
  assert.equal(suggestions.length, 12);
  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.regionId).sort(),
    regions.map((region) => region.regionId).sort(),
  );
  assert.equal((result.body.geometry as unknown[]).length, 12);
  // The base64 body really fits what the worker accepts.
  assert.equal(log.suggestBodyBytes.length, 1);
  assert.ok(log.suggestBodyBytes[0] <= 8 * 1024 * 1024, `body ${log.suggestBodyBytes[0]}`);
  assert.equal(log.suggestCrops[0].length, 12);
  for (const crop of log.suggestCrops[0]) {
    assert.ok(crop.pngBytes <= 1024 * 1024, `crop ${crop.regionId} = ${crop.pngBytes}`);
  }
});

test("two different masks with the same box keep both identities", async () => {
  reset();
  const log = emptyLog();
  const deps = await suggestDeps(log);
  const box = { x: 100, y: 100, width: 200, height: 150 };
  const result = await handleRegionSuggestions(
    deps,
    jsonRequest({
      imageId: IMAGE_IDS.N,
      treeSampleId: TREE,
      direction: "N",
      requestToken: "aliases",
      sourceWidth: 1024,
      sourceHeight: 768,
      regions: [
        { regionId: "sam-0", box, maskAreaPixels: 12_000, maskSha: "aaaa", samScore: 0.7 },
        // Same bounding box, DIFFERENT pixels: a hole, a branch crossing it, a
        // mask the reviewer edited. Its identifier must survive.
        { regionId: "sam-1", box, maskAreaPixels: 4_000, maskSha: "bbbb", samScore: 0.6 },
      ],
    }),
  );
  assert.equal(result.status, 200);
  // The identical crop is cut and classified once...
  assert.equal(log.suggestCrops[0].length, 1);
  // ...and its classification belongs to both regions.
  const suggestions = result.body.suggestions as { regionId: string }[];
  assert.deepEqual(suggestions.map((suggestion) => suggestion.regionId).sort(), ["sam-0", "sam-1"]);
  const geometry = result.body.geometry as { regionId: string }[];
  assert.deepEqual(geometry.map((entry) => entry.regionId).sort(), ["sam-0", "sam-1"]);
});

test("crops that merely overlap are classified separately, not shared", async () => {
  reset();
  const log = emptyLog();
  const deps = await suggestDeps(log);
  // Source space equals the proxy here, so the numbers are the reproducible
  // geometry: A expands to {0,0,600,600} and B to {20,0,600,600}. Their IoU is
  // 0.935…, above the old 0.92 threshold, yet they are DIFFERENT pixels.
  const result = await handleRegionSuggestions(
    deps,
    jsonRequest({
      imageId: IMAGE_IDS.N,
      treeSampleId: TREE,
      direction: "N",
      requestToken: "overlap",
      sourceWidth: PROXY_WIDTH,
      sourceHeight: PROXY_HEIGHT,
      regions: [
        {
          regionId: "sam-0",
          box: { x: 100, y: 100, width: 400, height: 400 },
          maskAreaPixels: 120_000,
          maskSha: "aaaa",
          samScore: 0.7,
        },
        {
          regionId: "sam-1",
          box: { x: 120, y: 100, width: 400, height: 400 },
          maskAreaPixels: 118_000,
          maskSha: "bbbb",
          samScore: 0.6,
        },
      ],
    }),
  );
  assert.equal(result.status, 200);
  // Two crops travel to the worker: an approximate overlap is not identity.
  assert.equal(log.suggestCrops[0].length, 2);
  const geometry = result.body.geometry as { regionId: string; cropBoxNormalized: Box }[];
  assert.deepEqual(geometry.map((entry) => entry.regionId).sort(), ["sam-0", "sam-1"]);
  const first = geometry.find((entry) => entry.regionId === "sam-0");
  const second = geometry.find((entry) => entry.regionId === "sam-1");
  assert.equal(first?.cropBoxNormalized.x, 0);
  assert.equal(second?.cropBoxNormalized.x, 20 / PROXY_WIDTH);
  assert.notDeepEqual(first?.cropBoxNormalized, second?.cropBoxNormalized);
});

test("a batch that does not fit fails explicitly instead of classifying part of it", async () => {
  reset();
  const log = emptyLog();
  const deps = await suggestDeps(log, undefined, {
    bytes: await texturedProxyBytes(),
    // A worker configured with a much smaller body limit: not even reducing the
    // crops six times fits 12 textured regions in it.
    workerBodyLimitBytes: 96 * 1024,
  });
  const result = await handleRegionSuggestions(
    deps,
    jsonRequest({
      imageId: IMAGE_IDS.N,
      treeSampleId: TREE,
      direction: "N",
      requestToken: "too-big",
      sourceWidth: 1024,
      sourceHeight: 768,
      regions: texturedRegions(12),
    }),
  );
  assert.equal(result.status, 413);
  assert.match(String(result.body.error), /se conservan/);
  // Nothing was classified partially: the worker was never called.
  assert.equal(log.suggestCrops.length, 0);
});

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

test("Cloud Run waits for startup before inference and allows the observed 100-second cold start", async () => {
  reset(); const log=emptyLog(); const deps=await suggestDeps(log);
  deps.workerUrl="https://test-bioclip.run.app";
  const realTimeout=AbortSignal.timeout, budgets:number[]=[];
  AbortSignal.timeout=(ms:number)=>{budgets.push(ms);return realTimeout(ms);};
  let release!:()=>void, started!:()=>void;
  const healthStarted=new Promise<void>(r=>{started=r;});
  const healthReady=new Promise<void>(r=>{release=r;});
  const originalFetch=deps.fetchImpl;
  deps.fetchImpl=(async(input,init)=>{
    if(String(input).endsWith('/health')){started();await healthReady;}
    return originalFetch(input,init);
  }) as typeof fetch;
  try {
    const pending=handleRegionSuggestions(deps,suggestRequest());
    await healthStarted;
    assert.equal(budgets.at(-1),150_000);
    assert.equal(log.urls.some(url=>url.endsWith('/suggest-regions')),false);
    release(); assert.equal((await pending).status,200);
    assert.equal(log.urls.filter(url=>url.endsWith('/suggest-regions')).length,1);
  } finally {release();AbortSignal.timeout=realTimeout;}
});

test("Cloud Run startup failures do not send crops to an unavailable instance", async () => {
  for(const failure of ['unavailable','timeout']) {
    reset(); const log=emptyLog(); const deps=await suggestDeps(log,null);
    deps.workerUrl="https://test-bioclip.run.app";
    if(failure==='timeout'){
      const originalFetch=deps.fetchImpl;
      deps.fetchImpl=(async(input,init)=>{
        if(String(input).endsWith('/health')) throw new Error('timeout');
        return originalFetch(input,init);
      }) as typeof fetch;
    }
    const result=await handleRegionSuggestions(deps,suggestRequest());
    assert.equal(result.status,503);
    assert.match(String(result.body.error),/selecciones están guardadas/);
    assert.equal(log.urls.some(url=>url.endsWith('/suggest-regions')),false);
  }
});

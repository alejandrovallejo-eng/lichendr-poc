import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  ANALYSIS_PROXY_BUCKET,
  analysisProxyPaths,
  ensureAnalysisProxy,
  type AnalysisSourceImage,
} from "./vision-analysis-proxy";

const userId = "123e4567-e89b-42d3-a456-426614174000";
const imageId = "223e4567-e89b-42d3-a456-426614174000";
const sourcePath = `${userId}/project/event/original.jpg`;

class FakeStorage {
  readonly objects = new Map<string, { body: Blob; metadata?: Record<string, unknown> }>();
  readonly contentTypes: string[] = [];

  from(bucket: string) {
    assert.equal(bucket, ANALYSIS_PROXY_BUCKET);
    return {
      download: async (path: string) => {
        const data = this.objects.get(path);
        return data ? { data: data.body, error: null } : { data: null, error: new Error("missing") };
      },
      createSignedUrl: async (path: string) => ({
        data: {
          signedUrl: `https://project.supabase.co/storage/v1/object/sign/${ANALYSIS_PROXY_BUCKET}/${path}?token=test`,
        },
        error: null,
      }),
      info: async (path: string) => {
        const data = this.objects.get(path);
        return data
          ? { data: { size: data.body.size, metadata: data.metadata }, error: null }
          : { data: null, error: new Error("missing") };
      },
      upload: async (
        path: string,
        value: string | Buffer,
        options: { contentType: string; metadata?: Record<string, unknown> },
      ) => {
        const content = typeof value === "string" ? value : new Uint8Array(value);
        this.contentTypes.push(options.contentType);
        this.objects.set(path, {
          body: new Blob([content], { type: options.contentType }),
          metadata: options.metadata,
        });
        return { error: null };
      },
    };
  }
}

test("stores a deterministic authenticated proxy once and reuses it", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousToken = process.env.VISION_SERVICE_TOKEN;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.VISION_SERVICE_TOKEN = "01234567890123456789012345678901";
  const storage = new FakeStorage();
  const sourceBytes = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: "#668844" },
  }).jpeg().toBuffer();
  const source: AnalysisSourceImage = {
    storage_bucket: ANALYSIS_PROXY_BUCKET,
    storage_path: sourcePath,
    mime_type: "image/jpeg",
    file_size_bytes: sourceBytes.byteLength,
  };
  let downloads = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    downloads += 1;
    const raw = String(url);
    return {
      ok: true,
      body: new Blob([new Uint8Array(sourceBytes)]).stream(),
      url: raw,
      headers: new Headers({
        "content-type": "image/jpeg",
        "content-length": String(sourceBytes.byteLength),
      }),
    } as Response;
  }) as typeof fetch;
  try {
    const supabase = { storage } as unknown as SupabaseClient;
    const first = await ensureAnalysisProxy(supabase, userId, imageId, source);
    const second = await ensureAnalysisProxy(supabase, userId, imageId, source);
    const paths = analysisProxyPaths(userId, imageId);

    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(downloads, 1);
    assert.equal(first.manifest.proxyPath, paths.image);
    assert.equal(first.manifest.proxyWidth, 2048);
    assert.equal(first.manifest.proxyHeight, 1365);
    assert.match(first.manifest.signature, /^[a-f0-9]{64}$/);
    assert.ok(storage.objects.has(paths.image));
    assert.equal(storage.objects.size, 1);
    assert.deepEqual(storage.contentTypes, ["image/jpeg"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.VISION_SERVICE_TOKEN;
    else process.env.VISION_SERVICE_TOKEN = previousToken;
  }
});

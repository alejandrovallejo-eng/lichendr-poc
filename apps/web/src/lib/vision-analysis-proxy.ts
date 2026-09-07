import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAnalysisProxy,
  MAX_PROXY_DIMENSION,
} from "./vision-analysis-image";

export const ANALYSIS_PROXY_BUCKET = "lichen-images";
export const ANALYSIS_PROXY_VERSION = 1;
export const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const ACCEPTED_MIMES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"]);

export interface AnalysisSourceImage {
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
}

export interface AnalysisProxyManifest {
  version: 1;
  imageId: string;
  sourcePath: string;
  sourceMime: string;
  sourceSizeBytes: number;
  proxyPath: string;
  proxyMime: "image/jpeg";
  proxySizeBytes: number;
  originalWidth: number;
  originalHeight: number;
  proxyWidth: number;
  proxyHeight: number;
  signature: string;
}

export function analysisProxyPaths(userId: string, imageId: string) {
  const directory = `${userId}/analysis-proxies/${imageId}`;
  return {
    directory,
    image: `${directory}/v${ANALYSIS_PROXY_VERSION}.jpg`,
  };
}

export function validateAnalysisSource(image: AnalysisSourceImage, userId: string): string | null {
  const mime = image.mime_type.toLowerCase();
  if (
    image.storage_bucket !== ANALYSIS_PROXY_BUCKET
    || !image.storage_path.startsWith(`${userId}/`)
    || image.storage_path.includes("..")
    || !ACCEPTED_MIMES.has(mime)
    || !Number.isSafeInteger(image.file_size_bytes)
    || image.file_size_bytes <= 0
    || image.file_size_bytes > MAX_ORIGINAL_BYTES
  ) {
    return null;
  }
  return mime;
}

export async function ensureAnalysisProxy(
  supabase: SupabaseClient,
  userId: string,
  imageId: string,
  source: AnalysisSourceImage,
): Promise<{ manifest: AnalysisProxyManifest; reused: boolean }> {
  const mime = validateAnalysisSource(source, userId);
  if (!mime) throw new Error("invalid_source");
  const paths = analysisProxyPaths(userId, imageId);
  const existing = await loadExistingManifest(supabase, paths, imageId, source);
  if (existing) return { manifest: existing, reused: true };

  const { data: signed, error: signedError } = await supabase.storage
    .from(ANALYSIS_PROXY_BUCKET)
    .createSignedUrl(source.storage_path, 120);
  if (signedError || !signed || !validSignedStorageUrl(signed.signedUrl, source.storage_path)) {
    throw new Error("source_authorization_failed");
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "lichendr-analysis-"));
  const originalPath = join(temporaryDirectory, "source");
  try {
    await downloadOriginal(signed.signedUrl, mime, source.file_size_bytes, originalPath);
    const generated = await createAnalysisProxy(originalPath, mime);
    const unsignedManifest: Omit<AnalysisProxyManifest, "signature"> = {
      version: ANALYSIS_PROXY_VERSION,
      imageId,
      sourcePath: source.storage_path,
      sourceMime: mime,
      sourceSizeBytes: source.file_size_bytes,
      proxyPath: paths.image,
      proxyMime: "image/jpeg",
      proxySizeBytes: generated.data.byteLength,
      originalWidth: generated.originalWidth,
      originalHeight: generated.originalHeight,
      proxyWidth: generated.proxyWidth,
      proxyHeight: generated.proxyHeight,
    };
    const manifest: AnalysisProxyManifest = {
      ...unsignedManifest,
      signature: signManifest(unsignedManifest),
    };
    const { error: proxyError } = await supabase.storage
      .from(ANALYSIS_PROXY_BUCKET)
      .upload(paths.image, generated.data, {
        cacheControl: "31536000",
        contentType: manifest.proxyMime,
        metadata: { analysisManifest: JSON.stringify(manifest) },
        upsert: true,
      });
    if (proxyError) throw new Error("proxy_upload_failed");
    return { manifest, reused: false };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function loadExistingManifest(
  supabase: SupabaseClient,
  paths: ReturnType<typeof analysisProxyPaths>,
  imageId: string,
  source: AnalysisSourceImage,
): Promise<AnalysisProxyManifest | null> {
  try {
    const { data: proxy, error } = await supabase.storage
      .from(ANALYSIS_PROXY_BUCKET)
      .info(paths.image);
    if (error || !proxy) return null;
    const rawManifest = proxy.metadata?.analysisManifest;
    if (typeof rawManifest !== "string" || rawManifest.length > 16 * 1024) return null;
    const value = JSON.parse(rawManifest) as Partial<AnalysisProxyManifest>;
    if (
      value.version !== ANALYSIS_PROXY_VERSION
      || value.imageId !== imageId
      || value.sourcePath !== source.storage_path
      || value.sourceMime !== source.mime_type.toLowerCase()
      || value.sourceSizeBytes !== source.file_size_bytes
      || value.proxyPath !== paths.image
      || value.proxyMime !== "image/jpeg"
      || !validManifestSignature(value)
      || !positiveInteger(value.proxySizeBytes)
      || !positiveInteger(value.originalWidth)
      || !positiveInteger(value.originalHeight)
      || !positiveInteger(value.proxyWidth)
      || !positiveInteger(value.proxyHeight)
      || Math.max(value.proxyWidth, value.proxyHeight) > MAX_PROXY_DIMENSION
    ) {
      return null;
    }
    const size = Number(proxy.size ?? 0);
    return size === value.proxySizeBytes
      ? value as AnalysisProxyManifest
      : null;
  } catch {
    return null;
  }
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function signManifest(manifest: Omit<AnalysisProxyManifest, "signature">) {
  const secret = process.env.VISION_SERVICE_TOKEN;
  if (!secret || secret.length < 32) throw new Error("proxy_signing_not_configured");
  return createHmac("sha256", secret).update(JSON.stringify(manifest)).digest("hex");
}

function validManifestSignature(value: Partial<AnalysisProxyManifest>) {
  const signature = value.signature;
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const unsigned = { ...value };
  delete unsigned.signature;
  try {
    const expected = Buffer.from(signManifest(unsigned as Omit<AnalysisProxyManifest, "signature">), "hex");
    return timingSafeEqual(expected, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

async function downloadOriginal(url: string, mime: string, expectedBytes: number, destination: string) {
  const response = await fetch(url, {
    headers: { Accept: mime, "User-Agent": "LichenDR-Proxy/1" },
    redirect: "error",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body || response.url !== url) throw new Error("source_download_failed");
  const responseMime = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (responseMime !== mime) throw new Error("source_mime_mismatch");
  const announced = Number(response.headers.get("content-length") ?? expectedBytes);
  if (announced !== expectedBytes || announced > MAX_ORIGINAL_BYTES) throw new Error("source_size_mismatch");
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength;
      callback(received <= expectedBytes ? null : new Error("source_size_mismatch"), chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    limiter,
    createWriteStream(destination, { flags: "wx" }),
  );
  if (received !== expectedBytes) throw new Error("source_size_mismatch");
}

export function validSignedStorageUrl(raw: string, storagePath: string): boolean {
  try {
    const signed = new URL(raw);
    const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const expectedPath = `/storage/v1/object/sign/${ANALYSIS_PROXY_BUCKET}/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
    return signed.protocol === "https:"
      && signed.username === ""
      && signed.password === ""
      && signed.host === configured.host
      && signed.pathname === expectedPath
      && signed.searchParams.has("token");
  } catch {
    return false;
  }
}

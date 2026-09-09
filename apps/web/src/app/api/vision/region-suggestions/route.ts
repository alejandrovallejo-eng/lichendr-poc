import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BIOCLIP_PREPROCESS_MODE,
  BIOCLIP_WORKER_TIMEOUT_MS,
  BIOCLIP_WORKER_URL,
  bioclipAuthHeaders,
} from "@/lib/bioclip";
import {
  ANALYSIS_PROXY_BUCKET,
  ensureAnalysisProxy,
  validSignedStorageUrl,
  validateAnalysisSource,
  type AnalysisSourceImage,
} from "@/lib/vision-analysis-proxy";
import {
  MAX_REGIONS_PER_VIEW,
  expandWithContext,
  intersectionOverUnion,
  scaleBoxToSpace,
  scaleToMaxSide,
} from "@/modules/region-suggestions/crop-geometry";
import {
  regionSuggestionsEnabled,
  regionSuggestionsWorkerConfigured,
} from "@/modules/region-suggestions/flag";
import { suggestionCacheKey } from "@/modules/region-suggestions/review";
import type { Box } from "@/modules/region-suggestions/types";
import { readCachedBatch, writeCachedBatch } from "./cache";

// Only a small JSON reference reaches this route: identifiers, integer boxes on
// the working grid and mask pixel hashes. No photograph travels in the browser
// payload; the crops are cut here from the private analysis proxy.
const MAX_REFERENCE_BYTES = 32 * 1024;
const MAX_PROXY_BYTES = 12 * 1024 * 1024;
// Aligned with the worker: per-crop and aggregate caps are the same on both
// sides, so a batch the route accepts can never be rejected as too large by the
// worker after the crops were already cut.
const MAX_CROP_BYTES = 1024 * 1024;
const MAX_TOTAL_CROP_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_CROP_PIXELS = 24 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 120;
const DIRECTIONS = ["N", "E", "S", "W"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HASH_ID = /^[A-Za-z0-9]{4,64}$/;
const MAX_SOURCE_SIDE = 20_000;
const TOO_LARGE = Symbol("too-large");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Shared serial coordinator: the four views of a series are processed one at a
// time by this route, never as four parallel workers.
let serialTail: Promise<unknown> = Promise.resolve();

function runSerially<T>(task: () => Promise<T>): Promise<T> {
  const result = serialTail.then(task, task);
  serialTail = result.catch(() => undefined);
  return result;
}

export function GET() {
  return Response.json(
    { error: "Las sugerencias de regiones requieren POST con una referencia de imagen." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

interface RegionInput {
  regionId: string;
  box: Box;
  maskAreaPixels: number;
  maskSha: string;
  samScore: number;
}

export async function POST(request: NextRequest) {
  // Flag off by default: with it off no BioCLIP call is possible, even if a
  // client calls this route directly.
  if (!regionSuggestionsEnabled() || !regionSuggestionsWorkerConfigured()) {
    return Response.json(
      { error: "La asistencia de regiones está desactivada en este entorno. Puedes anotar manualmente." },
      { status: 503 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return Response.json({ error: "Debes iniciar sesión para pedir sugerencias." }, { status: 401 });
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return Response.json(
      { error: "La solicitud debe usar JSON y contener solamente referencias pequeñas." },
      { status: 415 },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_REFERENCE_BYTES) {
    return Response.json({ error: "La solicitud excede el tamaño permitido." }, { status: 413 });
  }

  let raw: unknown;
  try {
    // The declared length is only a hint; the real bytes are counted while
    // reading, so a chunked body cannot bypass the limit.
    raw = await readSmallJson(request);
  } catch {
    return Response.json({ error: "La referencia enviada no es JSON válido." }, { status: 400 });
  }
  if (raw === TOO_LARGE) {
    return Response.json({ error: "La solicitud excede el tamaño permitido." }, { status: 413 });
  }

  const parsed = parseRequest(raw);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const { imageId, treeSampleId, direction, requestToken, sourceWidth, sourceHeight, regions } =
    parsed;
  const ownerId = authData.user.id;

  // The image must really belong to this view of this tree sample: an id that
  // exists is not enough.
  const { data: view, error: viewError } = await supabase
    .from("capture_views")
    .select("id, direction, image_id, capture_series_id, capture_series!inner(id, tree_sample_id)")
    .eq("image_id", imageId)
    .eq("direction", direction)
    .eq("active", true)
    .maybeSingle();
  const series = (view as { capture_series?: { tree_sample_id?: string } } | null)?.capture_series;
  if (viewError || !view || series?.tree_sample_id !== treeSampleId) {
    return Response.json(
      { error: "Esa fotografía no corresponde a esta vista de este árbol." },
      { status: 404 },
    );
  }

  // Four originals AND four proxies ready before any inference.
  const readiness = await ensureSeriesReady(supabase, ownerId, view.capture_series_id);
  if ("error" in readiness) {
    return Response.json({ error: readiness.error }, { status: readiness.status });
  }
  const proxy = readiness.proxies.get(imageId);
  if (!proxy) {
    return Response.json(
      { error: "La vista solicitada no está preparada para la asistencia." },
      { status: 422 },
    );
  }

  return runSerially(async () => {
    let proxyBytes: Buffer;
    try {
      proxyBytes = await downloadProxy(
        supabase,
        proxy.manifest.proxyPath,
        proxy.manifest.proxySizeBytes,
      );
    } catch {
      return Response.json(
        { error: "No se pudo leer la versión de análisis de la fotografía." },
        { status: 422 },
      );
    }

    // Real pixel hashes: the manifest signature is an HMAC over metadata and is
    // reported separately, never used as an image hash.
    const proxySha256 = createHash("sha256").update(proxyBytes).digest("hex");
    const maskSetSha256 = createHash("sha256")
      .update(regions.map((region) => `${region.regionId}:${region.maskSha}`).join("|"))
      .digest("hex");

    const identityBase = {
      ownerId,
      imageId,
      proxySha256,
      maskSetSha256,
      preprocessVersion: BIOCLIP_PREPROCESS_MODE,
      suggestionVersion: "1",
    };
    // Bounded reuse: a batch already computed for these exact pixels, masks and
    // versions is answered from the cache instead of re-inferring.
    const provisionalKey = suggestionCacheKey({
      ...identityBase,
      encoderId: "pending",
      headSha256: null,
      backend: "pending",
    });
    const cached = readCachedBatch(provisionalKey, ownerId);
    if (cached) {
      return Response.json({
        ...(cached as Record<string, unknown>),
        cached: true,
        context: { imageId, treeSampleId, direction, requestToken },
      });
    }

    let crops: Array<{ regionId: string; base64: string; cropBoxNormalized: Box }>;
    try {
      crops = await cutCrops(
        proxyBytes,
        proxy.manifest.proxyWidth,
        proxy.manifest.proxyHeight,
        sourceWidth,
        sourceHeight,
        regions,
      );
    } catch {
      return Response.json(
        { error: "Las regiones propuestas no son válidas para esta fotografía." },
        { status: 422 },
      );
    }
    if (crops.length === 0) {
      return Response.json({ error: "No hay regiones válidas que sugerir." }, { status: 422 });
    }

    let workerPayload: {
      backend?: unknown;
      encoderId?: unknown;
      headSha256?: unknown;
      headWarning?: unknown;
      versions?: Record<string, string>;
      suggestions?: unknown;
    };
    try {
      const upstream = await fetch(`${BIOCLIP_WORKER_URL.replace(/\/$/, "")}/suggest-regions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bioclipAuthHeaders() },
        body: JSON.stringify({
          preprocess: BIOCLIP_PREPROCESS_MODE,
          regions: crops.map((crop) => ({ regionId: crop.regionId, cropPngBase64: crop.base64 })),
        }),
        signal: AbortSignal.timeout(BIOCLIP_WORKER_TIMEOUT_MS),
        cache: "no-store",
      });
      const body: unknown = await upstream.json();
      if (!upstream.ok) {
        const detail = (body as { detail?: unknown })?.detail;
        // Upstream text is never forwarded verbatim: it could contain a path.
        const headInvalid = detail === "head_invalid";
        return Response.json(
          {
            error: headInvalid
              ? "La cabeza entrenada configurada no es válida, así que no se emiten sugerencias. Revisa el archivo NPZ; tus fotografías y revisiones se conservan."
              : "El worker BioCLIP rechazó la solicitud. Las fotografías y tus revisiones se conservan.",
          },
          { status: upstream.status === 429 ? 429 : headInvalid ? 502 : 502 },
        );
      }
      workerPayload = (body ?? {}) as typeof workerPayload;
    } catch {
      return Response.json(
        {
          error:
            "El worker BioCLIP no está disponible. Las fotografías y tus revisiones se conservan; puedes anotar manualmente y reintentar.",
        },
        { status: 503 },
      );
    }

    const identity = {
      ...identityBase,
      encoderId: safeText(workerPayload.encoderId, "desconocido"),
      headSha256:
        typeof workerPayload.headSha256 === "string" ? workerPayload.headSha256.slice(0, 64) : null,
      backend: safeText(workerPayload.backend, "zeroshot"),
    };

    const payload = {
      context: { imageId, treeSampleId, direction, requestToken },
      cacheKey: suggestionCacheKey(identity),
      cached: false,
      provenance: {
        ...identity,
        treeSampleId,
        direction,
        proxyManifestSignature: proxy.manifest.signature,
      },
      backend: identity.backend,
      // An invalid trained head never degrades silently: the warning reaches
      // the UI.
      headWarning:
        typeof workerPayload.headWarning === "string" ? workerPayload.headWarning.slice(0, 300) : null,
      geometry: crops.map((crop) => ({
        regionId: crop.regionId,
        cropBoxNormalized: crop.cropBoxNormalized,
      })),
      suggestions: sanitizeSuggestions(workerPayload.suggestions),
      notice:
        "Puntuaciones crudas, no probabilidades. Cada región queda pendiente de tu revisión: "
        + "la etiqueta no demuestra que todos los píxeles de la máscara sean liquen.",
    };
    writeCachedBatch(provisionalKey, ownerId, payload);
    return Response.json(payload);
  });
}

async function readSmallJson(request: NextRequest): Promise<unknown | typeof TOO_LARGE> {
  if (!request.body) throw new Error("missing_body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_REFERENCE_BYTES) {
      await reader.cancel();
      return TOO_LARGE;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}

function parseRequest(value: unknown):
  | {
      imageId: string;
      treeSampleId: string;
      direction: (typeof DIRECTIONS)[number];
      requestToken: string;
      sourceWidth: number;
      sourceHeight: number;
      regions: RegionInput[];
    }
  | { error: string } {
  if (!value || typeof value !== "object") return { error: "Falta la referencia de la vista." };
  const input = value as Record<string, unknown>;
  if (typeof input.imageId !== "string" || !UUID.test(input.imageId)) {
    return { error: "La referencia de imagen no es válida." };
  }
  if (typeof input.treeSampleId !== "string" || !UUID.test(input.treeSampleId)) {
    return { error: "La referencia del árbol no es válida." };
  }
  if (
    typeof input.direction !== "string"
    || !(DIRECTIONS as readonly string[]).includes(input.direction)
  ) {
    return { error: "La vista solicitada no es válida." };
  }
  if (typeof input.requestToken !== "string" || !SAFE_ID.test(input.requestToken)) {
    return { error: "El identificador de la solicitud no es válido." };
  }
  if (
    !isPositiveInteger(input.sourceWidth)
    || !isPositiveInteger(input.sourceHeight)
    || input.sourceWidth > MAX_SOURCE_SIDE
    || input.sourceHeight > MAX_SOURCE_SIDE
  ) {
    return { error: "Las dimensiones de las máscaras no son válidas." };
  }
  if (!Array.isArray(input.regions) || input.regions.length === 0) {
    return { error: "No se enviaron regiones propuestas." };
  }
  if (input.regions.length > MAX_REGIONS_PER_VIEW) {
    return { error: "Se enviaron demasiadas regiones propuestas." };
  }
  const regions: RegionInput[] = [];
  const seen = new Set<string>();
  for (const candidate of input.regions) {
    if (!candidate || typeof candidate !== "object") return { error: "Una región no es válida." };
    const region = candidate as Record<string, unknown>;
    if (typeof region.regionId !== "string" || !SAFE_ID.test(region.regionId)) {
      return { error: "El identificador de una región no es válido." };
    }
    if (seen.has(region.regionId)) return { error: "Hay regiones repetidas." };
    seen.add(region.regionId);
    if (typeof region.maskSha !== "string" || !HASH_ID.test(region.maskSha)) {
      return { error: "El identificador de píxeles de una región no es válido." };
    }
    const box = region.box as Record<string, unknown> | undefined;
    if (
      !box
      || typeof box !== "object"
      || !isNonNegativeInteger(box.x)
      || !isNonNegativeInteger(box.y)
      || !isPositiveInteger(box.width)
      || !isPositiveInteger(box.height)
      || box.x + box.width > (input.sourceWidth as number)
      || box.y + box.height > (input.sourceHeight as number)
    ) {
      return { error: "El recuadro de una región no es válido." };
    }
    if (!isNonNegativeInteger(region.maskAreaPixels)) {
      return { error: "El área de una región no es válida." };
    }
    if (typeof region.samScore !== "number" || !Number.isFinite(region.samScore)) {
      return { error: "La puntuación de segmentación no es válida." };
    }
    regions.push({
      regionId: region.regionId,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      maskAreaPixels: region.maskAreaPixels,
      maskSha: region.maskSha,
      samScore: region.samScore,
    });
  }
  return {
    imageId: input.imageId,
    treeSampleId: input.treeSampleId,
    direction: input.direction as (typeof DIRECTIONS)[number],
    requestToken: input.requestToken,
    sourceWidth: input.sourceWidth as number,
    sourceHeight: input.sourceHeight as number,
    regions,
  };
}

// The four originals must exist and satisfy the storage rules, and the four
// analysis proxies must be ready, before any inference runs on one view.
async function ensureSeriesReady(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  ownerId: string,
  seriesId: string,
): Promise<
  | { proxies: Map<string, Awaited<ReturnType<typeof ensureAnalysisProxy>>> }
  | { error: string; status: number }
> {
  const { data: views, error } = await supabase
    .from("capture_views")
    .select("image_id, direction")
    .eq("capture_series_id", seriesId)
    .eq("active", true);
  if (error || !views) {
    return { error: "No se pudo comprobar la serie de cuatro vistas.", status: 422 };
  }
  const byDirection = new Map<string, string>();
  for (const row of views) byDirection.set(row.direction, row.image_id);
  if (DIRECTIONS.some((direction) => !byDirection.get(direction))) {
    return {
      error: "Faltan vistas: la asistencia necesita las cuatro fotografías (N, E, S, O).",
      status: 409,
    };
  }

  const proxies = new Map<string, Awaited<ReturnType<typeof ensureAnalysisProxy>>>();
  for (const direction of DIRECTIONS) {
    const currentImageId = byDirection.get(direction)!;
    const { data: image, error: imageError } = await supabase
      .from("images")
      .select("storage_bucket, storage_path, mime_type, file_size_bytes")
      .eq("id", currentImageId)
      .maybeSingle();
    if (imageError || !image) {
      return {
        error: "Alguna fotografía de la serie no existe o no pertenece a tu proyecto.",
        status: 404,
      };
    }
    if (!validateAnalysisSource(image as AnalysisSourceImage, ownerId)) {
      return {
        error: "Alguna fotografía guardada no cumple las reglas de seguridad o tamaño.",
        status: 422,
      };
    }
    try {
      proxies.set(
        currentImageId,
        await ensureAnalysisProxy(supabase, ownerId, currentImageId, image as AnalysisSourceImage),
      );
    } catch {
      return {
        error: "Alguna fotografía de la serie no se pudo preparar para la asistencia.",
        status: 422,
      };
    }
  }
  return { proxies };
}

async function downloadProxy(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  proxyPath: string,
  expectedBytes: number,
): Promise<Buffer> {
  if (expectedBytes <= 0 || expectedBytes > MAX_PROXY_BYTES) throw new Error("proxy_too_large");
  const { data: signed, error } = await supabase.storage
    .from(ANALYSIS_PROXY_BUCKET)
    .createSignedUrl(proxyPath, SIGNED_URL_TTL_SECONDS);
  // The signed URL is used here and nowhere else: it is never returned, logged
  // or rendered, and the client can never supply an arbitrary URL.
  if (error || !signed || !validSignedStorageUrl(signed.signedUrl, proxyPath)) {
    throw new Error("proxy_authorization_failed");
  }
  const response = await fetch(signed.signedUrl, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("proxy_download_failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROXY_BYTES) {
    throw new Error("proxy_too_large");
  }
  return bytes;
}

// Single application of the geometry contract: the tight box measured on the
// working grid is scaled to proxy pixels and the context margin is added ONCE,
// here. The resulting crop is reported back normalised so the overlay matches.
async function cutCrops(
  proxyBytes: Buffer,
  proxyWidth: number,
  proxyHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  regions: readonly RegionInput[],
): Promise<Array<{ regionId: string; base64: string; cropBoxNormalized: Box }>> {
  const crops: Array<{ regionId: string; base64: string; cropBoxNormalized: Box }> = [];
  const keptBoxes: Box[] = [];
  let totalBytes = 0;
  let totalPixels = 0;
  for (const region of regions) {
    const tightOnProxy = scaleBoxToSpace(
      region.box,
      sourceWidth,
      sourceHeight,
      proxyWidth,
      proxyHeight,
    );
    const expanded = expandWithContext(tightOnProxy, proxyWidth, proxyHeight);
    if (keptBoxes.some((other) => intersectionOverUnion(expanded, other) >= 0.92)) continue;
    const downscale = scaleToMaxSide(expanded);
    const outputWidth = Math.max(1, Math.round(expanded.width * downscale));
    const outputHeight = Math.max(1, Math.round(expanded.height * downscale));
    if (totalPixels + outputWidth * outputHeight > MAX_TOTAL_CROP_PIXELS) break;
    // `extract` keeps the whole expanded region; the optional resize applies to
    // the complete crop, so no extreme of the region is ever cut away.
    let pipeline = sharp(proxyBytes, { failOn: "error", sequentialRead: true }).extract({
      left: expanded.x,
      top: expanded.y,
      width: expanded.width,
      height: expanded.height,
    });
    if (downscale < 1) {
      pipeline = pipeline.resize({
        width: outputWidth,
        height: outputHeight,
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
      });
    }
    const buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    if (buffer.byteLength > MAX_CROP_BYTES) continue;
    if (totalBytes + buffer.byteLength > MAX_TOTAL_CROP_BYTES) break;
    totalBytes += buffer.byteLength;
    totalPixels += outputWidth * outputHeight;
    keptBoxes.push(expanded);
    crops.push({
      regionId: region.regionId,
      base64: buffer.toString("base64"),
      cropBoxNormalized: {
        x: expanded.x / proxyWidth,
        y: expanded.y / proxyHeight,
        width: expanded.width / proxyWidth,
        height: expanded.height / proxyHeight,
      },
    });
  }
  return crops;
}

function sanitizeSuggestions(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_REGIONS_PER_VIEW).map((item) => {
    const suggestion = (item ?? {}) as Record<string, unknown>;
    const ranking = Array.isArray(suggestion.ranking) ? suggestion.ranking : [];
    return {
      regionId: typeof suggestion.regionId === "string" ? suggestion.regionId.slice(0, 64) : "",
      // The worker always answers `pending`; the route enforces it as well.
      status: "pending",
      ranking: ranking.slice(0, 3).map((entry) => {
        const score = (entry ?? {}) as Record<string, unknown>;
        return {
          label: typeof score.label === "string" ? score.label.slice(0, 40) : "",
          labelEs: typeof score.labelEs === "string" ? score.labelEs.slice(0, 40) : "",
          rawScore:
            typeof score.rawScore === "number" && Number.isFinite(score.rawScore)
              ? score.rawScore
              : null,
        };
      }),
    };
  });
}

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 && value.length <= 120 ? value : fallback;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

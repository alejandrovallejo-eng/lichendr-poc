// Region suggestions: the reviewable BioCLIP step of the assisted journey.
//
// The route is a thin adapter over this module so the WHOLE journey (owner,
// image-view-tree association, four originals and four proxies, serial
// coordination, crops, worker call, bounded reuse) can be exercised by tests
// with injected dependencies instead of only through helpers.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  MAX_REGIONS_PER_VIEW,
  expandWithContext,
  intersectionOverUnion,
  scaleBoxToSpace,
  scaleToMaxSide,
} from "../crop-geometry";
import { suggestionCacheKey } from "../review";
import type { Box } from "../types";
import { readCachedBatch, writeCachedBatch } from "../../../app/api/vision/region-suggestions/cache";
import {
  DIRECTIONS,
  authorizeViewContext,
  downloadProxyBytes,
  isContextFailure,
} from "./context";
import { resolveWorkerIdentity, sameWorkerIdentity, type WorkerIdentity } from "./identity";
import { runSerially } from "./serial";

export interface SuggestDeps {
  supabase: SupabaseClient;
  enabled: boolean;
  workerUrl: string;
  authHeaders: Record<string, string>;
  preprocessMode: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

// Only a small JSON reference reaches this route: identifiers, integer boxes on
// the working grid and mask pixel hashes. No photograph travels in the browser
// payload; the crops are cut here from the private analysis proxy.
const MAX_REFERENCE_BYTES = 32 * 1024;
// Aligned with the worker: per-crop and aggregate caps are the same on both
// sides, so a batch the route accepts can never be rejected as too large by the
// worker after the crops were already cut.
const MAX_CROP_BYTES = 1024 * 1024;
const MAX_TOTAL_CROP_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_CROP_PIXELS = 24 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HASH_ID = /^[A-Za-z0-9]{4,64}$/;
const MAX_SOURCE_SIDE = 20_000;
const TOO_LARGE = Symbol("too-large");

interface RegionInput {
  regionId: string;
  box: Box;
  maskAreaPixels: number;
  maskSha: string;
  samScore: number;
}

export async function handleRegionSuggestions(
  deps: SuggestDeps,
  request: Request,
): Promise<HandlerResult> {
  // Flag off by default: with it off no BioCLIP call is possible, even if a
  // client calls this route directly.
  if (!deps.enabled) {
    return {
      status: 503,
      body: {
        error:
          "La asistencia de regiones está desactivada en este entorno. Puedes anotar manualmente.",
      },
    };
  }

  const { data: authData, error: authError } = await deps.supabase.auth.getUser();
  if (authError || !authData?.user) {
    return { status: 401, body: { error: "Debes iniciar sesión para pedir sugerencias." } };
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    !== "application/json"
  ) {
    return {
      status: 415,
      body: { error: "La solicitud debe usar JSON y contener solamente referencias pequeñas." },
    };
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_REFERENCE_BYTES) {
    return { status: 413, body: { error: "La solicitud excede el tamaño permitido." } };
  }

  let raw: unknown;
  try {
    // The declared length is only a hint; the real bytes are counted while
    // reading, so a chunked body cannot bypass the limit.
    raw = await readSmallJson(request);
  } catch {
    return { status: 400, body: { error: "La referencia enviada no es JSON válido." } };
  }
  if (raw === TOO_LARGE) {
    return { status: 413, body: { error: "La solicitud excede el tamaño permitido." } };
  }

  const parsed = parseRequest(raw);
  if ("error" in parsed) return { status: 400, body: { error: parsed.error } };
  const { imageId, treeSampleId, direction, requestToken, sourceWidth, sourceHeight, regions } =
    parsed;
  const ownerId = authData.user.id;

  // Owner, image-view-tree association and the four originals/proxies are
  // verified BEFORE any model is touched.
  const context = await authorizeViewContext(deps.supabase, ownerId, {
    imageId,
    treeSampleId,
    direction,
  });
  if (isContextFailure(context)) {
    return { status: context.status, body: { error: context.error } };
  }
  const proxy = context.proxy;
  const fetchImpl = deps.fetchImpl ?? fetch;

  // The whole assisted journey shares one serial coordinator, so four panels
  // are never four parallel workers.
  return runSerially(async () => {
    let proxyBytes: Buffer;
    try {
      proxyBytes = await downloadProxyBytes(
        deps.supabase,
        proxy.proxyPath,
        proxy.proxySizeBytes,
        fetchImpl,
      );
    } catch {
      return {
        status: 422,
        body: { error: "No se pudo leer la versión de análisis de la fotografía." },
      };
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
      preprocessVersion: deps.preprocessMode,
      suggestionVersion: "1",
    };

    // Bounded reuse is only attempted when the identity of the model can be
    // VERIFIED first. Reading or writing under a provisional key (encoder and
    // backend "pending", head null) would let a zero-shot batch answer a request
    // served by a trained head, and connecting or changing a head would not
    // invalidate anything.
    const declaredIdentity = await resolveWorkerIdentity(
      deps.workerUrl,
      deps.authHeaders,
      fetchImpl,
    );
    const cacheKey = declaredIdentity
      ? suggestionCacheKey({ ...identityBase, ...identityOf(declaredIdentity) })
      : null;
    if (cacheKey) {
      const cached = readCachedBatch(cacheKey, ownerId);
      if (cached) {
        return {
          status: 200,
          body: {
            ...(cached as Record<string, unknown>),
            cached: true,
            context: { imageId, treeSampleId, direction, requestToken },
          },
        };
      }
    }

    let crops: Array<{ regionId: string; base64: string; cropBoxNormalized: Box }>;
    try {
      crops = await cutCrops(
        proxyBytes,
        proxy.proxyWidth,
        proxy.proxyHeight,
        sourceWidth,
        sourceHeight,
        regions,
      );
    } catch {
      return {
        status: 422,
        body: { error: "Las regiones propuestas no son válidas para esta fotografía." },
      };
    }
    if (crops.length === 0) {
      return { status: 422, body: { error: "No hay regiones válidas que sugerir." } };
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
      const upstream = await fetchImpl(`${deps.workerUrl.replace(/\/$/, "")}/suggest-regions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...deps.authHeaders },
        body: JSON.stringify({
          preprocess: deps.preprocessMode,
          regions: crops.map((crop) => ({ regionId: crop.regionId, cropPngBase64: crop.base64 })),
        }),
        signal: AbortSignal.timeout(deps.timeoutMs),
        cache: "no-store",
      });
      const body: unknown = await upstream.json();
      if (!upstream.ok) {
        const detail = (body as { detail?: unknown })?.detail;
        // Upstream text is never forwarded verbatim: it could contain a path.
        const headInvalid = detail === "head_invalid";
        return {
          status: upstream.status === 429 ? 429 : 502,
          body: {
            error: headInvalid
              ? "La cabeza entrenada configurada no es válida, así que no se emiten sugerencias. Revisa el archivo NPZ; tus fotografías y revisiones se conservan."
              : "El worker BioCLIP rechazó la solicitud. Las fotografías y tus revisiones se conservan.",
          },
        };
      }
      workerPayload = (body ?? {}) as typeof workerPayload;
    } catch {
      return {
        status: 503,
        body: {
          error:
            "El worker BioCLIP no está disponible. Las fotografías y tus revisiones se conservan; puedes anotar manualmente y reintentar.",
        },
      };
    }

    const answeredIdentity: WorkerIdentity = {
      encoderId: safeText(workerPayload.encoderId, "desconocido"),
      backend: safeText(workerPayload.backend, "zeroshot"),
      headSha256:
        typeof workerPayload.headSha256 === "string" ? workerPayload.headSha256.slice(0, 64) : null,
      headError: null,
    };
    const identity = { ...identityBase, ...identityOf(answeredIdentity) };

    const payload = {
      context: { imageId, treeSampleId, direction, requestToken },
      cacheKey: suggestionCacheKey(identity),
      cached: false,
      provenance: {
        ...identity,
        treeSampleId,
        direction,
        proxyManifestSignature: proxy.signature,
      },
      backend: identity.backend,
      // An invalid trained head never degrades silently: the warning reaches
      // the UI.
      headWarning:
        typeof workerPayload.headWarning === "string"
          ? workerPayload.headWarning.slice(0, 300)
          : declaredIdentity?.headError
            ? "La cabeza entrenada configurada no se pudo cargar; estas sugerencias provienen del modo zero-shot."
            : null,
      geometry: crops.map((crop) => ({
        regionId: crop.regionId,
        cropBoxNormalized: crop.cropBoxNormalized,
      })),
      suggestions: sanitizeSuggestions(workerPayload.suggestions),
      notice:
        "Puntuaciones crudas, no probabilidades. Cada región queda pendiente de tu revisión: "
        + "la etiqueta no demuestra que todos los píxeles de la máscara sean liquen.",
    };
    // Stored only when the model that answered is the model the key names.
    if (cacheKey && declaredIdentity && sameWorkerIdentity(declaredIdentity, answeredIdentity)) {
      writeCachedBatch(cacheKey, ownerId, payload);
    }
    return { status: 200, body: payload };
  });
}

function identityOf(identity: WorkerIdentity): {
  encoderId: string;
  headSha256: string | null;
  backend: string;
} {
  return {
    encoderId: identity.encoderId,
    headSha256: identity.headSha256,
    backend: identity.backend,
  };
}

async function readSmallJson(request: Request): Promise<unknown | typeof TOO_LARGE> {
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

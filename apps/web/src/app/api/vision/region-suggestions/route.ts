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
} from "@/lib/vision-analysis-proxy";
import {
  MAX_REGIONS_PER_VIEW,
  expandWithContext,
  intersectionOverUnion,
  scaleToMaxSide,
} from "@/modules/region-suggestions/crop-geometry";
import {
  regionSuggestionsEnabled,
  regionSuggestionsWorkerConfigured,
} from "@/modules/region-suggestions/flag";
import { suggestionCacheKey } from "@/modules/region-suggestions/review";
import type { Box } from "@/modules/region-suggestions/types";

// Only a small JSON reference reaches this route: identifiers and bounding
// boxes. No photograph travels in the browser payload; the crops are cut here
// from the private analysis proxy that already exists for this image.
const MAX_REFERENCE_BYTES = 32 * 1024;
const MAX_PROXY_BYTES = 12 * 1024 * 1024;
const MAX_CROP_BYTES = 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 120;
const DIRECTIONS = new Set(["N", "E", "S", "W"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TOO_LARGE = Symbol("too-large");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    raw = await readSmallJson(request);
  } catch {
    return Response.json({ error: "La referencia enviada no es JSON válido." }, { status: 400 });
  }
  if (raw === TOO_LARGE) {
    return Response.json({ error: "La solicitud excede el tamaño permitido." }, { status: 413 });
  }

  const parsed = parseRequest(raw);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const { imageId, treeSampleId, direction, requestToken, regions } = parsed;

  // Ownership: RLS returns nothing for another owner's photograph, and the
  // stored row must still satisfy bucket/path/MIME/size rules.
  const { data: image, error: imageError } = await supabase
    .from("images")
    .select("storage_bucket, storage_path, mime_type, file_size_bytes")
    .eq("id", imageId)
    .maybeSingle();
  if (imageError || !image) {
    return Response.json(
      { error: "La fotografía no existe o no pertenece a tu proyecto." },
      { status: 404 },
    );
  }
  if (!validateAnalysisSource(image, authData.user.id)) {
    return Response.json(
      { error: "La fotografía guardada no cumple las reglas de seguridad o tamaño." },
      { status: 422 },
    );
  }

  let proxy: Awaited<ReturnType<typeof ensureAnalysisProxy>>;
  try {
    proxy = await ensureAnalysisProxy(supabase, authData.user.id, imageId, image);
  } catch {
    return Response.json(
      { error: "La fotografía sigue guardada, pero no se pudo preparar para la asistencia." },
      { status: 422 },
    );
  }

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

  let crops: Array<{ regionId: string; base64: string }>;
  try {
    crops = await cutCrops(
      proxyBytes,
      proxy.manifest.proxyWidth,
      proxy.manifest.proxyHeight,
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

  const proxySha256 = createHash("sha256").update(proxyBytes).digest("hex");
  const maskSetSha256 = createHash("sha256")
    .update(
      JSON.stringify(
        regions.map((region) => [region.regionId, region.box, region.maskAreaPixels]),
      ),
    )
    .digest("hex");

  let workerPayload: {
    backend?: unknown;
    encoderId?: unknown;
    headSha256?: unknown;
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
      // Upstream text is never forwarded verbatim: it could contain a URL.
      return Response.json(
        {
          error:
            "El worker BioCLIP rechazó la solicitud. Las fotografías y tus revisiones se conservan.",
        },
        { status: upstream.status === 429 ? 429 : 502 },
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
    ownerId: authData.user.id,
    imageId,
    // Signed manifest of the original → proxy derivation; not a URL.
    imageSha256: proxy.manifest.signature,
    proxySha256,
    maskSetSha256,
    encoderId: safeText(workerPayload.encoderId, "desconocido"),
    headSha256: typeof workerPayload.headSha256 === "string" ? workerPayload.headSha256.slice(0, 64) : null,
    backend: safeText(workerPayload.backend, "zeroshot"),
    preprocessVersion: safeText(workerPayload.versions?.preprocess, "desconocida"),
    suggestionVersion: safeText(workerPayload.versions?.schema, "1"),
  };

  return Response.json({
    // Context echoed back so a late response can be discarded by the client.
    context: { imageId, treeSampleId, direction, requestToken },
    cacheKey: suggestionCacheKey(identity),
    provenance: { ...identity, treeSampleId, direction },
    backend: identity.backend,
    suggestions: sanitizeSuggestions(workerPayload.suggestions),
    notice:
      "Puntuaciones crudas, no probabilidades. Cada región queda pendiente de tu revisión: "
      + "la etiqueta no demuestra que todos los píxeles de la máscara sean liquen.",
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
      direction: string;
      requestToken: string;
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
  if (typeof input.direction !== "string" || !DIRECTIONS.has(input.direction)) {
    return { error: "La vista solicitada no es válida." };
  }
  if (typeof input.requestToken !== "string" || !SAFE_ID.test(input.requestToken)) {
    return { error: "El identificador de la solicitud no es válido." };
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
    const box = region.box as Record<string, unknown> | undefined;
    if (
      !box
      || typeof box !== "object"
      || !isNonNegativeInteger(box.x)
      || !isNonNegativeInteger(box.y)
      || !isPositiveInteger(box.width)
      || !isPositiveInteger(box.height)
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
      samScore: region.samScore,
    });
  }
  return {
    imageId: input.imageId,
    treeSampleId: input.treeSampleId,
    direction: input.direction,
    requestToken: input.requestToken,
    regions,
  };
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

async function cutCrops(
  proxyBytes: Buffer,
  proxyWidth: number,
  proxyHeight: number,
  regions: readonly RegionInput[],
): Promise<Array<{ regionId: string; base64: string }>> {
  const crops: Array<{ regionId: string; base64: string }> = [];
  const keptBoxes: Box[] = [];
  for (const region of regions) {
    const box = region.box;
    if (box.x + box.width > proxyWidth || box.y + box.height > proxyHeight) continue;
    const expanded = expandWithContext(box, proxyWidth, proxyHeight);
    if (keptBoxes.some((other) => intersectionOverUnion(expanded, other) >= 0.92)) continue;
    keptBoxes.push(expanded);
    const downscale = scaleToMaxSide(expanded);
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
        width: Math.max(1, Math.round(expanded.width * downscale)),
        height: Math.max(1, Math.round(expanded.height * downscale)),
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
      });
    }
    const buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    if (buffer.byteLength > MAX_CROP_BYTES) continue;
    crops.push({ regionId: region.regionId, base64: buffer.toString("base64") });
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

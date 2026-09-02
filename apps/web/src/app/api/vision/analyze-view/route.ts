import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VISION_SERVICE_URL, visionAuthHeaders } from "@/lib/vision";

const MAX_REFERENCE_BYTES = 16 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 60;
const IMAGE_BUCKET = "lichen-images";
const ACCEPTED_MIMES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"]);
const ACTIONS = new Set(["detect", "confirm_corners", "analyze_confirmed"]);
const MANUAL_MODES = new Set(["manual_confirmed", "manual_assisted_provisional"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOO_LARGE = Symbol("too-large");

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { error: "La inferencia requiere POST con una referencia de imagen; nunca envíes la imagen en la URL." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return Response.json({ error: "Debes iniciar sesión para analizar esta fotografía." }, { status: 401 });
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "La solicitud debe usar JSON y contener solamente una referencia de imagen." }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > MAX_REFERENCE_BYTES) {
    return Response.json({ error: "La solicitud debe contener solamente una referencia pequeña a la imagen." }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await readSmallJson(request);
  } catch {
    return Response.json({ error: "La referencia de imagen no contiene JSON válido." }, { status: 400 });
  }
  if (raw === TOO_LARGE) {
    return Response.json({ error: "La solicitud debe contener solamente una referencia pequeña a la imagen." }, { status: 413 });
  }
  const parsed = parseRequest(raw);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const { data: image, error: imageError } = await supabase
    .from("images")
    .select("storage_bucket, storage_path, mime_type, file_size_bytes")
    .eq("id", parsed.imageId)
    .maybeSingle();
  if (imageError || !image) {
    return Response.json({ error: "La fotografía no existe o no pertenece a tu proyecto." }, { status: 404 });
  }

  async function readSmallJson(request: NextRequest): Promise<unknown | typeof TOO_LARGE> {
    if (!request.body) throw new Error("Missing body");
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = "";
    while (true) {
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
  const mime = image.mime_type.toLowerCase();
  if (
    image.storage_bucket !== IMAGE_BUCKET
    || !image.storage_path.startsWith(`${authData.user.id}/`)
    || image.storage_path.includes("..")
    || !ACCEPTED_MIMES.has(mime)
    || image.file_size_bytes <= 0
    || image.file_size_bytes > MAX_IMAGE_BYTES
  ) {
    return Response.json({ error: "La fotografía guardada no cumple las reglas de seguridad o tamaño." }, { status: 422 });
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrl(image.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signedError || !signed) {
    return Response.json(
      { error: "La fotografía sigue guardada, pero no se pudo autorizar su lectura para la IA. Puedes reintentar." },
      { status: 503 },
    );
  }
  if (!validSignedStorageUrl(signed.signedUrl, image.storage_path)) {
    return Response.json({ error: "Storage devolvió una URL de lectura no válida." }, { status: 502 });
  }

  const upstream = new FormData();
  upstream.append("image_url", signed.signedUrl);
  upstream.append("image_mime", mime);
  upstream.append("image_size_bytes", String(image.file_size_bytes));
  upstream.append("action", parsed.action);
  if (parsed.corners) upstream.append("corners", JSON.stringify(parsed.corners));
  if (parsed.action !== "detect") upstream.append("manual_mode", parsed.manualMode);

  try {
    const response = await fetch(`${VISION_SERVICE_URL}/analyze-view`, {
      method: "POST",
      headers: { ...visionAuthHeaders() },
      body: upstream,
      signal: AbortSignal.timeout(5 * 60_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const detail = payload && typeof payload === "object" ? (payload as { detail?: unknown }).detail : null;
      return Response.json({ error: safeDetail(detail) }, { status: response.status });
    }
    return Response.json(payload);
  } catch {
    return Response.json(
      { error: "La fotografía quedó guardada. El servicio de visión no está disponible; puedes reintentar más tarde." },
      { status: 503 },
    );
  }
}

function parseRequest(value: unknown):
  | {
      imageId: string;
      action: "detect" | "confirm_corners" | "analyze_confirmed";
      corners: { x: number; y: number }[] | null;
      manualMode: "manual_confirmed" | "manual_assisted_provisional";
    }
  | { error: string } {
  if (!value || typeof value !== "object") return { error: "Falta la referencia de imagen." };
  const input = value as Record<string, unknown>;
  if (typeof input.imageId !== "string" || !UUID.test(input.imageId)) {
    return { error: "La referencia de imagen no es válida." };
  }
  if (input.action !== undefined && (typeof input.action !== "string" || !ACTIONS.has(input.action))) {
    return { error: "La acción solicitada no es válida." };
  }
  const action = (input.action ?? "detect") as "detect" | "confirm_corners" | "analyze_confirmed";
  const corners = validCorners(input.corners) ? input.corners : null;
  if (action !== "detect" && !corners) return { error: "Las cuatro esquinas confirmadas no son válidas." };
  if (input.manualMode !== undefined && (typeof input.manualMode !== "string" || !MANUAL_MODES.has(input.manualMode))) {
    return { error: "El modo de confirmación manual no es válido." };
  }
  const manualMode = (input.manualMode ?? "manual_confirmed") as "manual_confirmed" | "manual_assisted_provisional";
  return { imageId: input.imageId, action, corners, manualMode };
}

function validCorners(value: unknown): value is { x: number; y: number }[] {
  return Array.isArray(value)
    && value.length === 4
    && value.every((point) => (
      point !== null
      && typeof point === "object"
      && typeof (point as { x?: unknown }).x === "number"
      && Number.isFinite((point as { x: number }).x)
      && (point as { x: number }).x >= 0
      && (point as { x: number }).x <= 1
      && typeof (point as { y?: unknown }).y === "number"
      && Number.isFinite((point as { y: number }).y)
      && (point as { y: number }).y >= 0
      && (point as { y: number }).y <= 1
    ));
}

function validSignedStorageUrl(raw: string, storagePath: string): boolean {
  try {
    const signed = new URL(raw);
    const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const expectedPath = `/storage/v1/object/sign/${IMAGE_BUCKET}/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
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

function safeDetail(value: unknown): { code: string; message: string; frame_detection: unknown } {
  if (!value || typeof value !== "object") {
    return { code: "processing_error", message: "No se pudo procesar la vista.", frame_detection: null };
  }
  const detail = value as Record<string, unknown>;
  return {
    code: typeof detail.code === "string" ? detail.code.slice(0, 80) : "processing_error",
    message: typeof detail.message === "string" ? detail.message.slice(0, 240) : "No se pudo procesar la vista.",
    frame_detection: safeFrameDetection(detail.frame_detection),
  };
}

function safeFrameDetection(value: unknown): unknown {
  if (!value || typeof value !== "object") return null;
  const detection = value as Record<string, unknown>;
  return {
    method: typeof detection.method === "string" ? detection.method.slice(0, 80) : null,
    detected_marker_ids: Array.isArray(detection.detected_marker_ids)
      ? detection.detected_marker_ids.filter((item): item is number => Number.isInteger(item)).slice(0, 8)
      : [],
    missing_marker_ids: Array.isArray(detection.missing_marker_ids)
      ? detection.missing_marker_ids.filter((item): item is number => Number.isInteger(item)).slice(0, 8)
      : [],
    rejection_reason: typeof detection.rejection_reason === "string"
      ? detection.rejection_reason.slice(0, 80)
      : null,
  };
}

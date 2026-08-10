import { NextRequest } from "next/server";

const VISION_SERVICE_URL = process.env.VISION_SERVICE_URL ?? "http://127.0.0.1:8000";
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED_MIMES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"]);
const ACTIONS = new Set(["detect", "confirm_corners", "analyze_confirmed"]);

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "No se pudo leer la imagen." }, { status: 400 });
  }
  const image = formData.get("image");
  if (!(image instanceof File)) {
    return Response.json({ error: "Falta la imagen." }, { status: 400 });
  }
  const mime = image.type.split(";", 1)[0].trim().toLowerCase();
  if (!ACCEPTED_MIMES.has(mime)) {
    return Response.json({ error: "Formato no admitido." }, { status: 415 });
  }
  if (image.size <= 0 || image.size > MAX_BYTES) {
    return Response.json({ error: "La imagen está vacía o supera 20 MB." }, { status: 413 });
  }
  const action = formData.get("action");
  const normalizedAction = typeof action === "string" && action ? action : "detect";
  if (!ACTIONS.has(normalizedAction)) {
    return Response.json({ error: "La acción solicitada no es válida." }, { status: 400 });
  }
  const corners = formData.get("corners");
  if (normalizedAction !== "detect" && !validCorners(corners)) {
    return Response.json({ error: "Las cuatro esquinas confirmadas no son válidas." }, { status: 400 });
  }
  const upstream = new FormData();
  upstream.append("image", image);
  upstream.append("action", normalizedAction);
  if (typeof corners === "string") upstream.append("corners", corners);
  try {
    const response = await fetch(`${VISION_SERVICE_URL}/analyze-view`, {
      method: "POST",
      body: upstream,
      signal: AbortSignal.timeout(5 * 60_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const detail = payload && typeof payload === "object" ? (payload as { detail?: unknown }).detail : null;
      const safeDetail = detail && typeof detail === "object"
        ? {
            code: typeof (detail as { code?: unknown }).code === "string" ? (detail as { code: string }).code : "processing_error",
            message: typeof (detail as { message?: unknown }).message === "string"
              ? (detail as { message: string }).message.slice(0, 240)
              : "No se pudo procesar la vista.",
            frame_detection: safeFrameDetection((detail as { frame_detection?: unknown }).frame_detection),
          }
        : { code: "processing_error", message: "No se pudo procesar la vista." };
      return Response.json({ error: safeDetail }, { status: response.status });
    }
    return Response.json(payload);
  } catch {
    return Response.json({ error: "El servicio de visión no está disponible." }, { status: 503 });
  }
}

function validCorners(raw: FormDataEntryValue | null): raw is string {
  if (typeof raw !== "string" || raw.length > 2048) return false;
  try {
    const value: unknown = JSON.parse(raw);
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
  } catch {
    return false;
  }
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

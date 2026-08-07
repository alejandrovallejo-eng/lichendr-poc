import { NextRequest } from "next/server";

const VISION_SERVICE_URL = process.env.VISION_SERVICE_URL ?? "http://127.0.0.1:8000";
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED_MIMES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"]);

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
  const upstream = new FormData();
  upstream.append("image", image);
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
          }
        : { code: "processing_error", message: "No se pudo procesar la vista." };
      return Response.json({ error: safeDetail }, { status: response.status });
    }
    return Response.json(payload);
  } catch {
    return Response.json({ error: "El servicio de visión no está disponible." }, { status: 503 });
  }
}

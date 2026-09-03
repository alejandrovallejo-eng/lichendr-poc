import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAnalysisProxy } from "@/lib/vision-analysis-proxy";

const MAX_REFERENCE_BYTES = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return Response.json({ error: "Debes iniciar sesión para preparar esta fotografía." }, { status: 401 });
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "La solicitud debe contener solamente un identificador." }, { status: 415 });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length < 0 || length > MAX_REFERENCE_BYTES) {
    return Response.json({ error: "La referencia de imagen es demasiado grande." }, { status: 413 });
  }
  let input: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("missing_body");
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REFERENCE_BYTES) {
        await reader.cancel();
        return Response.json({ error: "La referencia de imagen es demasiado grande." }, { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    input = JSON.parse(text);
  } catch {
    return Response.json({ error: "La referencia de imagen no es válida." }, { status: 400 });
  }
  const imageId = input && typeof input === "object" ? (input as { imageId?: unknown }).imageId : null;
  if (typeof imageId !== "string" || !UUID.test(imageId) || JSON.stringify(input).length > MAX_REFERENCE_BYTES) {
    return Response.json({ error: "La referencia de imagen no es válida." }, { status: 400 });
  }
  const { data: image, error: imageError } = await supabase
    .from("images")
    .select("storage_bucket, storage_path, mime_type, file_size_bytes")
    .eq("id", imageId)
    .maybeSingle();
  if (imageError || !image) {
    return Response.json({ error: "La fotografía no existe o no pertenece a tu proyecto." }, { status: 404 });
  }
  try {
    const proxy = await ensureAnalysisProxy(supabase, authData.user.id, imageId, image);
    return Response.json({
      status: "ready",
      imageId,
      reused: proxy.reused,
      originalWidth: proxy.manifest.originalWidth,
      originalHeight: proxy.manifest.originalHeight,
      proxyWidth: proxy.manifest.proxyWidth,
      proxyHeight: proxy.manifest.proxyHeight,
    });
  } catch {
    return Response.json(
      { error: "No se pudo preparar automáticamente la fotografía para la IA. El original sigue guardado." },
      { status: 422 },
    );
  }
}

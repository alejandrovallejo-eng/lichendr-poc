"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const server_1 = require("@/lib/supabase/server");
const vision_analysis_proxy_1 = require("@/lib/vision-analysis-proxy");
const MAX_REFERENCE_BYTES = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
exports.dynamic = "force-dynamic";
async function POST(request) {
    const supabase = await (0, server_1.createSupabaseServerClient)();
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
    let input;
    try {
        const reader = request.body?.getReader();
        if (!reader)
            throw new Error("missing_body");
        const decoder = new TextDecoder();
        let text = "";
        let bytes = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            bytes += value.byteLength;
            if (bytes > MAX_REFERENCE_BYTES) {
                await reader.cancel();
                return Response.json({ error: "La referencia de imagen es demasiado grande." }, { status: 413 });
            }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        input = JSON.parse(text);
    }
    catch {
        return Response.json({ error: "La referencia de imagen no es válida." }, { status: 400 });
    }
    const imageId = input && typeof input === "object" ? input.imageId : null;
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
        const proxy = await (0, vision_analysis_proxy_1.ensureAnalysisProxy)(supabase, authData.user.id, imageId, image);
        return Response.json({
            status: "ready",
            imageId,
            reused: proxy.reused,
            originalWidth: proxy.manifest.originalWidth,
            originalHeight: proxy.manifest.originalHeight,
            proxyWidth: proxy.manifest.proxyWidth,
            proxyHeight: proxy.manifest.proxyHeight,
        });
    }
    catch {
        return Response.json({ error: "No se pudo preparar automáticamente la fotografía para la IA. El original sigue guardado." }, { status: 422 });
    }
}

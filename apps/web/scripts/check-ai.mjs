// Explicit --workflow creates a disposable owner, hierarchy and image, exercises
// the actual Next.js routes and models, then removes only this run's records/files.
import nextEnv from "@next/env";
import { createServerClient } from "@supabase/ssr";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";

nextEnv.loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)), false, { info() {}, error() {} });
const args = process.argv.slice(2);
let workflow = false;
let imagePath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--workflow") workflow = true;
  else if (args[i] === "--image" && args[i + 1] && !args[i + 1].startsWith("--")) imagePath = args[++i];
  else throw new Error("Uso: npm run check:ai [-- --workflow --image /ruta/arbol.jpg]");
}
if (imagePath && !workflow) throw new Error("--image requiere --workflow.");
const base = process.env.AI_CHECK_APP_URL || "http://127.0.0.1:3000";
const appUrl = new URL(base);
if (!["http:", "https:"].includes(appUrl.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(appUrl.hostname) || appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
  throw new Error("AI_CHECK_APP_URL debe señalar la aplicación local en localhost.");
}
// Retry readiness only: never repeat an inference request after a timeout.
const deadline = Date.now() + 180_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${base}/api/vision/health`, { signal: AbortSignal.timeout(15_000) });
    const health = await response.json();
    if (response.ok && health.model_loaded) { ready = true; break; }
  } catch { /* A sleeping worker can take time to wake. */ }
  await delay(2000);
}
if (!ready) throw new Error("MobileSAM no está listo tras esperar el arranque del servicio.");
console.log("MobileSAM: modelo cargado. La disponibilidad de BioCLIP se verifica con --workflow.");
if (!workflow) process.exit(0);

const cookieJar = new Map();
const owner = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: { getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    setAll: values => { for (const item of values) cookieJar.set(item.name, item.value); } },
});
let projectId, viewId, sourcePath, proxyPath, samSession, reference;
let uploaded = false;
let failed = false;
function checked(stage, result) {
  if (result.error) throw new Error(`${stage}: ${result.error.code || "request_failed"}`);
  return result.data;
}
async function api(path, body, method = "POST") {
  const response = await fetch(`${base}${path}`, { method,
    headers: { "Content-Type": "application/json", Cookie: [...cookieJar].map(([n, v]) => `${n}=${v}`).join("; ") },
    ...(method === "DELETE" ? { headers: { Cookie: [...cookieJar].map(([n, v]) => `${n}=${v}`).join("; "), "x-sam-session-ticket": samSession.ticket } } : {}),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(360_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${typeof result.error === "string" ? result.error : "analysis_failed"}`);
  return result;
}
try {
  console.log("Prueba de IA real con registros temporales. La identidad anónima queda en Auth; no se editan proyectos ni revisiones existentes.");
  const auth = checked("autenticación", await owner.auth.signInAnonymously());
  const create = async (table, values) => checked(table, await owner.from(table).insert(values).select().single());
  const project = await create("projects", { owner_id: auth.user.id, name: `Prueba IA ${randomUUID()}`, description: "Verificación temporal de integración." });
  projectId = project.id;
  const site = await create("sites", { project_id: projectId, name: "Sitio temporal de IA" });
  const event = await create("sampling_events", { site_id: site.id, name: "Prueba de IA", sampled_at: new Date().toISOString() });
  const tree = await create("trees", { site_id: site.id, code: "AI-CHECK" });
  const sample = await create("tree_samples", { site_id: site.id, tree_id: tree.id, sampling_event_id: event.id });
  const input = imagePath ? await readFile(imagePath)
    : await sharp({ create: { width: 461, height: 615, channels: 3, background: "#668844" } }).jpeg().toBuffer();
  const bytes = await sharp(input).rotate().resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true }).jpeg().toBuffer();
  const dimensions = await sharp(bytes).metadata();
  sourcePath = `${auth.user.id}/ai-checks/${randomUUID()}.jpg`;
  checked("subida de prueba", await owner.storage.from("lichen-images").upload(sourcePath, bytes, { contentType: "image/jpeg" }));
  uploaded = true;
  const image = await create("images", { tree_sample_id: sample.id, storage_path: sourcePath,
    original_filename: "ai-check.jpg", mime_type: "image/jpeg", file_size_bytes: bytes.length,
    width_px: dimensions.width, height_px: dimensions.height });
  proxyPath = `${auth.user.id}/analysis-proxies/${image.id}/v1.jpg`;
  const series = checked("serie", await owner.rpc("get_or_create_capture_series", {
    p_tree_sample_id: sample.id, p_algorithm_version: "ai-check-v1", p_request_key: randomUUID(),
  }));
  const view = checked("vista", await owner.rpc("register_capture_view", {
    p_series_id: series.id, p_image_id: image.id, p_direction: "N", p_algorithm_version: "ai-check-v1", p_request_key: randomUUID(),
  }));
  viewId = view.id;
  reference = { imageId: image.id, treeSampleId: sample.id, direction: "N" };
  const proxy = await api("/api/vision/analysis-proxy", { imageId: image.id });
  if (proxy.status !== "ready") throw new Error("proxy_not_ready");
  console.log("Preparación de imagen: OK, copia privada orientada y firmada.");
  samSession = await api("/api/vision/region-suggestions/prepare", reference);
  const segmented = await api("/api/vision/region-suggestions/segment", {
    ...reference, sessionId: samSession.sessionId, ticket: samSession.ticket,
    points: [{ x: .5, y: .3, label: 1 }],
  });
  if (!segmented.candidates?.length) throw new Error("sam_candidates_missing");
  console.log(`MobileSAM: OK, ${segmented.candidates.length} máscaras reales.`);
  const payload = { ...reference, requestToken: randomUUID(), sourceWidth: proxy.proxyWidth, sourceHeight: proxy.proxyHeight,
    regions: [{ regionId: "check-region", box: { x: 0, y: 0, width: proxy.proxyWidth, height: proxy.proxyHeight },
      maskAreaPixels: proxy.proxyWidth * proxy.proxyHeight, maskSha: createHash("sha256").update(bytes).digest("hex"), samScore: 1 }] };
  const bioclip = await api("/api/vision/region-suggestions", payload);
  if (bioclip.backend !== "ridge_head" || bioclip.suggestions?.length !== 1 || bioclip.suggestions[0].status !== "pending") {
    throw new Error("bioclip_response_not_verified");
  }
  console.log(`BioCLIP: OK, clasificador entrenado; ${bioclip.suggestions[0].ranking?.length} etiquetas, pendientes de revisión.`);
  const comparison = await api("/api/vision/region-suggestions", { ...payload, experimental: true });
  if (!comparison.experimental?.suggestions?.length || comparison.experimental.modelId !== "inat-five-class-20260917") {
    throw new Error("experimental_response_not_verified");
  }
  console.log("Comparación experimental: OK, identificada por separado.");
} catch (error) {
  failed = true;
  console.error(error.message);
} finally {
  if (samSession && reference) {
    try { await api(`/api/vision/region-suggestions/sessions/${samSession.sessionId}`, undefined, "DELETE"); }
    catch { failed = true; console.error("No se pudo liberar la sesión temporal de MobileSAM."); }
  }
  if (viewId) {
    const result = await owner.from("capture_views").delete().eq("id", viewId).select("id");
    if (result.error || result.data?.length !== 1) { failed = true; console.error("view_cleanup_failed"); }
  }
  if (projectId) {
    const result = await owner.from("projects").delete().eq("id", projectId).select("id");
    if (result.error || result.data?.length !== 1) { failed = true; console.error("record_cleanup_failed"); }
  }
  if (uploaded) {
    const result = await owner.storage.from("lichen-images").remove([sourcePath, ...(proxyPath ? [proxyPath] : [])]);
    if (result.error) { failed = true; console.error("storage_cleanup_failed"); }
  }
  await owner.auth.signOut();
}
process.exitCode = failed ? 1 : 0;
if (!failed) console.log("Verificación completa; registros y fotografías de prueba retirados.");

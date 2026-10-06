import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { checkSupabaseConnection } from "../src/lib/supabase/readiness.mjs";

nextEnv.loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)), false, { info() {}, error() {} });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const write = process.argv.includes("--write");
if (process.argv.slice(2).some(argument => argument !== "--write")) {
  console.error("Uso: npm run check:database [-- --write]");
  process.exit(1);
}
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en apps/web/.env.local.");
  process.exit(1);
}
if (key.startsWith("sb_secret_")) {
  console.error("Esta comprobación requiere una clave pública, nunca una clave administrativa.");
  process.exit(1);
}

function report(result) {
  for (const [name, status] of Object.entries(result.checks)) console.log(`${name}: ${status}`);
  for (const [table, status] of Object.entries(result.tables)) if (status !== "ok") console.error(`tabla no disponible: ${table}`);
  if (result.providers) console.log(`Google: ${result.providers.google}; acceso anónimo: ${result.providers.anonymous}`);
}

/** @param {string} stage @param {{error?: {code?: string}|null, data?: unknown}} result */
function requireSuccess(stage, result) {
  if (result.error) throw new Error(`${stage}: ${result.error.code || "request_failed"}`);
  return result.data;
}

async function verifyWrites() {
  console.log("Verificación real: dos sesiones anónimas, registros sintéticos y una imagen de 8×8. Se retiran al terminar los registros y el archivo creados por esta ejecución.");
  console.log("Las identidades anónimas permanecen en Auth; no se usan cuentas ni fotografías existentes.");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) } };
  const owner = createClient(url, key, options);
  const stranger = createClient(url, key, options);
  const nonce = randomUUID();
  let projectId;
  let viewId;
  let path;
  let forbiddenPath;
  let forbiddenUploaded = false;
  let uploaded = false;
  let failed = false;
  try {
    const first = requireSuccess("autenticación", await owner.auth.signInAnonymously());
    const second = requireSuccess("segunda autenticación", await stranger.auth.signInAnonymously());
    if (!first?.user || !first?.session || !second?.user) throw new Error("authentication_missing");
    const readiness = await checkSupabaseConnection({ url, key, accessToken: first.session.access_token });
    report(readiness);
    if (readiness.status !== "ok") throw new Error("schema_or_storage_unavailable");
    console.log(`Lectura autenticada: ${Object.keys(readiness.tables).length} tablas comprobadas.`);
    const create = async (table, values) => requireSuccess(table, await owner.from(table).insert(values).select().single());
    const project = await create("projects", { owner_id: first.user.id, name: `Verificación técnica ${nonce}`, description: "Registro sintético temporal de check:database." });
    projectId = project.id;
    const site = await create("sites", { project_id: projectId, name: "Sitio de verificación" });
    const event = await create("sampling_events", { site_id: site.id, name: "Jornada de verificación", sampled_at: new Date().toISOString() });
    const tree = await create("trees", { site_id: site.id, code: "CHECK-01" });
    const sample = await create("tree_samples", { site_id: site.id, tree_id: tree.id, sampling_event_id: event.id });
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#173d35" } }).png().toBuffer();
    path = `${first.user.id}/connection-checks/${nonce}.png`;
    requireSuccess("subida privada", await owner.storage.from("lichen-images").upload(path, bytes, { contentType: "image/png", upsert: false }));
    uploaded = true;
    const image = await create("images", { tree_sample_id: sample.id, storage_path: path, original_filename: "connection-check.png", mime_type: "image/png", file_size_bytes: bytes.length, width_px: 8, height_px: 8 });
    await create("image_metadata", { image_id: image.id });
    const series = requireSuccess("serie de captura", await owner.rpc("get_or_create_capture_series", {
      p_tree_sample_id: sample.id, p_algorithm_version: "connection-check-v1", p_request_key: randomUUID(),
    }));
    const view = requireSuccess("vista de captura", await owner.rpc("register_capture_view", {
      p_series_id: series.id, p_image_id: image.id, p_direction: "N", p_algorithm_version: "connection-check-v1", p_request_key: randomUUID(),
    }));
    if (!view?.id) throw new Error("capture_view_missing");
    viewId = view.id;
    const readback = requireSuccess("relectura", await owner.from("images").select("id,tree_sample_id,storage_path").eq("id", image.id).single());
    if (readback.storage_path !== path || readback.tree_sample_id !== sample.id) throw new Error("readback_mismatch");
    const downloaded = requireSuccess("descarga privada", await owner.storage.from("lichen-images").download(path));
    if (!Buffer.from(await downloaded.arrayBuffer()).equals(bytes)) throw new Error("storage_bytes_mismatch");
    const signed = requireSuccess("URL firmada", await owner.storage.from("lichen-images").createSignedUrl(path, 60));
    const signedResponse = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(10_000) });
    if (!signedResponse.ok) throw new Error("signed_download_failed");
    const foreignRows = requireSuccess("aislamiento de registros", await stranger.from("projects").select("id").eq("id", projectId));
    if (foreignRows.length !== 0) throw new Error("rls_read_leak");
    const foreignWrite = await stranger.from("sites").insert({ project_id: projectId, name: "NO DEBE GUARDARSE" });
    if (foreignWrite.error?.code !== "42501") throw new Error("rls_write_not_rejected");
    const foreignFile = await stranger.storage.from("lichen-images").download(path);
    if (!foreignFile.error) throw new Error("storage_read_leak");
    if (![400, 401, 403, 404].includes(Number(foreignFile.error.statusCode))) throw new Error("storage_read_denial_not_verified");
    forbiddenPath = `${first.user.id}/connection-checks/${nonce}-forbidden.png`;
    const foreignUpload = await stranger.storage.from("lichen-images").upload(forbiddenPath, bytes, { contentType: "image/png" });
    forbiddenUploaded = !foreignUpload.error;
    if (forbiddenUploaded) throw new Error("storage_write_not_rejected");
    if (![400, 401, 403].includes(Number(foreignUpload.error.statusCode))) throw new Error("storage_write_denial_not_verified");
    const publicResponse = await fetch(owner.storage.from("lichen-images").getPublicUrl(path).data.publicUrl, { signal: AbortSignal.timeout(10_000) });
    if (publicResponse.ok) throw new Error("bucket_public_exposure");
    if (![400, 401, 403, 404].includes(publicResponse.status)) throw new Error("bucket_privacy_not_verified");
    console.log("OK: proyecto → sitio → jornada → árbol → muestra → imagen → metadatos → serie/vista.");
    console.log("OK: recuperación de datos, descarga privada y URL firmada; otro usuario no puede leer ni escribir estos registros/archivos; el archivo no es público.");
  } catch (error) {
    failed = true;
    console.error(error instanceof Error ? error.message : "database_check_failed");
  } finally {
    // Exact IDs from this execution only; never broad deletes or resets.
    // capture_views deliberately restricts deleting its source image. Remove
    // this execution's view first, before cascading the temporary hierarchy.
    if (viewId) {
      const removed = await owner.from("capture_views").delete().eq("id", viewId).select("id");
      if (removed.error || removed.data?.length !== 1) { failed = true; console.error(`view_cleanup_failed: ${removed.error?.code || "not_removed"}`); }
    }
    if (projectId) {
      const removed = await owner.from("projects").delete().eq("id", projectId).select("id");
      if (removed.error || removed.data?.length !== 1) { failed = true; console.error(`record_cleanup_failed: ${removed.error?.code || "not_removed"}`); }
    }
    if (uploaded && path) {
      const paths = [path, ...(forbiddenUploaded && forbiddenPath ? [forbiddenPath] : [])];
      const removed = await owner.storage.from("lichen-images").remove(paths);
      if (removed.error || !removed.data?.some(item => item.name === path)) { failed = true; console.error("storage_cleanup_failed"); }
    }
    await Promise.allSettled([owner.auth.signOut(), stranger.auth.signOut()]);
  }
  if (failed) process.exitCode = 1;
  else console.log("OK: registros y archivo sintéticos retirados. Verificación de base de datos completada.");
}

if (write) await verifyWrites();
else {
  const result = await checkSupabaseConnection({ url, key, accessToken: process.env.SUPABASE_CHECK_ACCESS_TOKEN });
  report(result);
  if (result.status !== "ok") {
    process.exitCode = result.status === "needs_session" ? 2 : 1;
    if (result.status === "needs_session") console.log("API conectada. Para comprobar tablas/Storage, consulta /api/health/supabase con tu sesión o ejecuta explícitamente npm run check:database -- --write.");
  }
}

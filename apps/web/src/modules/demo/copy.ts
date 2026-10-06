import type { SupabaseClient } from "@supabase/supabase-js";
import { createGuidedCloudStore } from "../four-view/guided-cloud";
import { DIRECTIONS } from "../four-view/types";
import { DEMO_NOTICE, DEMO_PROJECT_NAME, DEMO_VERSION, type DemoTemplate } from "./template";

export interface DemoCopy { projectId: string; siteId: string; eventId: string; treeSampleId: string }
export function demoCopyUrl(copy: DemoCopy) {
  return `/images?${new URLSearchParams({ mode: "summary", ...copy })}`;
}
/** Uses only the visitor's session and existing owner-scoped RPCs. No admin key. */
export async function createDemoCopy(db: SupabaseClient, template: DemoTemplate, photo: Blob,
  progress: (text: string) => void = () => {}): Promise<DemoCopy> {
  const user = await db.auth.getUser();
  if (user.error || !user.data.user) throw new Error("No se pudo abrir tu sesión. Reintenta.");
  const ownerId = user.data.user.id;
  const files: string[] = [], views: string[] = [];
  let projectId = "";
  const checked = <T>(result: { data: T; error: unknown }, step: string): NonNullable<T> => {
    if (result.error || !result.data) throw new Error(`No se pudo ${step}. Reintenta desde el ejemplo.`);
    return result.data;
  };
  const insert = async (table: string, row: Record<string, unknown>) =>
    checked(await db.from(table).insert(row).select("id").single(), "guardar el ejemplo").id as string;
  try {
    progress("Preparando tu proyecto de ejemplo…");
    projectId = await insert("projects", { owner_id: ownerId, name: DEMO_PROJECT_NAME, description: DEMO_NOTICE });
    const siteId = await insert("sites", { project_id: projectId, name: "Sitio de demostración", location_source: "unknown", notes: DEMO_NOTICE });
    const eventId = await insert("sampling_events", { site_id: siteId, name: "Jornada de demostración", sampled_at: new Date().toISOString(), notes: DEMO_NOTICE });
    const treeId = await insert("trees", { site_id: siteId, code: "EJEMPLO-001", notes: DEMO_NOTICE });
    const treeSampleId = await insert("tree_samples", { site_id: siteId, sampling_event_id: eventId, tree_id: treeId, notes: DEMO_NOTICE });
    const series = checked(await db.rpc("get_or_create_capture_series", { p_tree_sample_id: treeSampleId, p_algorithm_version: DEMO_VERSION, p_request_key: crypto.randomUUID() }), "preparar las cuatro vistas");
    const cloud = createGuidedCloudStore(db), bucket = db.storage.from("lichen-images");
    for (const direction of DIRECTIONS) {
      progress(`Guardando vista ${direction === "W" ? "O" : direction} de tu copia…`);
      const original = `${ownerId}/demo/${crypto.randomUUID()}.jpg`;
      const upload = await bucket.upload(original, photo, { contentType: "image/jpeg", upsert: false });
      if (upload.error) throw new Error("No se pudo guardar la fotografía del ejemplo. Reintenta.");
      files.push(original);
      const imageId = await insert("images", { tree_sample_id: treeSampleId, storage_path: original,
        original_filename: `ejemplo-${direction}.jpg`, mime_type: "image/jpeg", file_size_bytes: photo.size,
        width_px: template.photo.width, height_px: template.photo.height, caption: DEMO_NOTICE });
      const proxy = `${ownerId}/analysis-proxies/${imageId}/v1.jpg`;
      const uploaded = await bucket.upload(proxy, photo, { contentType: "image/jpeg", upsert: false });
      if (uploaded.error) throw new Error("No se pudo guardar la copia de análisis. Reintenta.");
      files.push(proxy);
      const view = checked(await db.rpc("register_capture_view", { p_series_id: series.id, p_image_id: imageId,
        p_direction: direction, p_algorithm_version: DEMO_VERSION, p_request_key: crypto.randomUUID() }), "registrar una orientación");
      views.push(view.id);
      // Copy descriptive colour review only. Do not relabel recorded model
      // provenance as a fresh invocation against the visitor's private image.
      await cloud.write({ ownerId, treeSampleId, direction, imageId }, template.review, 0);
    }
    return { projectId, siteId, eventId, treeSampleId };
  } catch (error) {
    // Only confirmed inserts of this attempt; never touch an existing project.
    const cleanup = [];
    if (views.length) cleanup.push(await db.from("capture_views").delete().in("id", views));
    if (projectId) cleanup.push(await db.from("projects").delete().eq("id", projectId).eq("owner_id", ownerId));
    if (files.length) cleanup.push(await db.storage.from("lichen-images").remove(files));
    if (cleanup.some(result => result.error)) throw new Error("La copia quedó incompleta. Revisa «Mis proyectos» antes de crear otra copia.");
    throw error;
  }
}

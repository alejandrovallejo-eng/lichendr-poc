"use client";
import { supabase } from "@/lib/supabase/client";
import { ensureTreeSampleForTree, findTreeSampleId, findCaptureSeriesForSample,
  getOrCreateCaptureSeries, loadSeriesViews, stageCaptureView, prepareStoredFourViewImage } from "./client";
import type { Direction } from "./types";
import type { GuidedContext, GuidedSession } from "./guided-flow";
import { createGuidedCloudStore } from "./guided-cloud";
import type { SupabaseClient } from "@supabase/supabase-js";
const cloud = createGuidedCloudStore(supabase as SupabaseClient);
export const guidedServices = {
  cloud,
  async load(context: GuidedContext): Promise<GuidedSession> {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw new Error("No se pudo recuperar tu sesión. Recarga la página.");
    const sampleId = await findTreeSampleId(context.eventId, context.treeId);
    const series = sampleId ? await findCaptureSeriesForSample(sampleId) : null;
    const views = series ? await loadSeriesViews(series.id) : [];
    const savedViews: Partial<Record<Direction, boolean>> = {};
    if (sampleId) await Promise.all(views.map(async view => {
      const row = await cloud.read({ ownerId: data.user!.id, treeSampleId: sampleId,
        direction: view.direction as Direction, imageId: view.image_id });
      savedViews[view.direction as Direction] = Boolean(row?.review.savedAt);
    }));
    return { ownerId: data.user.id, treeSampleId: sampleId ?? "", views: Object.fromEntries(views.map(v => [v.direction, v.image_id])), completed: series?.status === "completed", savedViews };
  },
  async upload(context: GuidedContext, direction: Direction, file: File, requestKey: string) {
    const treeSampleId = await ensureTreeSampleForTree(context.siteId, context.eventId, context.treeId);
    const series = await getOrCreateCaptureSeries(treeSampleId);
    if (series.status === "completed") throw new Error("Esta serie ya está finalizada. No se puede reemplazar su fotografía.");
    const view = await stageCaptureView({ file, direction, series, requestKey,
      context: { projectId: context.projectId, siteId: context.siteId, eventId: context.eventId, treeSampleId } });
    return { imageId: view.image_id, treeSampleId };
  },
  async photo(ownerId: string, imageId: string): Promise<Blob> {
    // Use the same oriented, bounded proxy for canvas and model geometry,
    // including HEIC. RLS still applies; no public URL or model token exposed.
    await prepareStoredFourViewImage(imageId);
    const { data, error } = await supabase.storage.from("lichen-images").download(`${ownerId}/analysis-proxies/${imageId}/v1.jpg`);
    if (error || !data) throw new Error("El original está guardado, pero no se pudo abrir su copia de análisis. Reintenta.");
    return data;
  },
};

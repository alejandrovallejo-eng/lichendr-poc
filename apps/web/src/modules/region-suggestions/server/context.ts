// Authorisation and readiness of the assisted journey, in ONE place.
//
// Every assisted operation — preparing a MobileSAM session, segmenting, asking
// BioCLIP — passes through `authorizeViewContext` FIRST:
//
// 1. the caller is the owner of the photograph (session-based, never a prop);
// 2. the image really belongs to that view of that tree sample;
// 3. the four originals (N, E, S, O) exist and satisfy the storage rules, and
//    the four analysis proxies are ready.
//
// Only then is any model touched. Previously these checks lived in the
// suggestion route alone, so MobileSAM was already being fed a photograph
// before the series had been validated.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ANALYSIS_PROXY_BUCKET,
  ensureAnalysisProxy,
  validSignedStorageUrl,
  validateAnalysisSource,
  type AnalysisProxyManifest,
  type AnalysisSourceImage,
} from "../../../lib/vision-analysis-proxy";

export const DIRECTIONS = ["N", "E", "S", "W"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const MAX_PROXY_BYTES = 12 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 120;

export interface ViewReference {
  imageId: string;
  treeSampleId: string;
  direction: string;
}

export interface AuthorizedViewContext {
  seriesId: string;
  proxy: AnalysisProxyManifest;
  proxies: Map<string, AnalysisProxyManifest>;
}

export interface ContextFailure {
  error: string;
  status: number;
}

export function isContextFailure(
  value: AuthorizedViewContext | ContextFailure,
): value is ContextFailure {
  return "error" in value;
}

export async function authorizeViewContext(
  supabase: SupabaseClient,
  ownerId: string,
  reference: ViewReference,
): Promise<AuthorizedViewContext | ContextFailure> {
  const { data: view, error: viewError } = await supabase
    .from("capture_views")
    .select("id, direction, image_id, capture_series_id, capture_series!inner(id, tree_sample_id)")
    .eq("image_id", reference.imageId)
    .eq("direction", reference.direction)
    .eq("active", true)
    .maybeSingle();
  const series = (view as { capture_series?: { tree_sample_id?: string } } | null)?.capture_series;
  if (viewError || !view || series?.tree_sample_id !== reference.treeSampleId) {
    return { error: "Esa fotografía no corresponde a esta vista de este árbol.", status: 404 };
  }

  const readiness = await ensureSeriesReady(
    supabase,
    ownerId,
    (view as { capture_series_id: string }).capture_series_id,
  );
  if ("error" in readiness) return readiness;

  const proxy = readiness.proxies.get(reference.imageId);
  if (!proxy) {
    return { error: "La vista solicitada no está preparada para la asistencia.", status: 422 };
  }
  return {
    seriesId: (view as { capture_series_id: string }).capture_series_id,
    proxy,
    proxies: readiness.proxies,
  };
}

async function ensureSeriesReady(
  supabase: SupabaseClient,
  ownerId: string,
  seriesId: string,
): Promise<{ proxies: Map<string, AnalysisProxyManifest> } | ContextFailure> {
  const { data: views, error } = await supabase
    .from("capture_views")
    .select("image_id, direction")
    .eq("capture_series_id", seriesId)
    .eq("active", true);
  if (error || !views) {
    return { error: "No se pudo comprobar la serie de cuatro vistas.", status: 422 };
  }
  const byDirection = new Map<string, string>();
  for (const row of views as Array<{ direction: string; image_id: string }>) {
    byDirection.set(row.direction, row.image_id);
  }
  if (DIRECTIONS.some((direction) => !byDirection.get(direction))) {
    return {
      error: "Faltan vistas: la asistencia necesita las cuatro fotografías (N, E, S, O).",
      status: 409,
    };
  }

  const proxies = new Map<string, AnalysisProxyManifest>();
  for (const direction of DIRECTIONS) {
    const currentImageId = byDirection.get(direction)!;
    const { data: image, error: imageError } = await supabase
      .from("images")
      .select("storage_bucket, storage_path, mime_type, file_size_bytes")
      .eq("id", currentImageId)
      .maybeSingle();
    if (imageError || !image) {
      return {
        error: "Alguna fotografía de la serie no existe o no pertenece a tu proyecto.",
        status: 404,
      };
    }
    if (!validateAnalysisSource(image as AnalysisSourceImage, ownerId)) {
      return {
        error: "Alguna fotografía guardada no cumple las reglas de seguridad o tamaño.",
        status: 422,
      };
    }
    try {
      const prepared = await ensureAnalysisProxy(
        supabase,
        ownerId,
        currentImageId,
        image as AnalysisSourceImage,
      );
      proxies.set(currentImageId, prepared.manifest as AnalysisProxyManifest);
    } catch {
      return {
        error: "Alguna fotografía de la serie no se pudo preparar para la asistencia.",
        status: 422,
      };
    }
  }
  return { proxies };
}

// Reads the private analysis proxy through a short-lived signed URL. The URL is
// used here and nowhere else: it is never returned, logged or rendered, and the
// client can never supply an arbitrary one (no SSRF).
export async function downloadProxyBytes(
  supabase: SupabaseClient,
  proxyPath: string,
  expectedBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  if (expectedBytes <= 0 || expectedBytes > MAX_PROXY_BYTES) throw new Error("proxy_too_large");
  const { data: signed, error } = await supabase.storage
    .from(ANALYSIS_PROXY_BUCKET)
    .createSignedUrl(proxyPath, SIGNED_URL_TTL_SECONDS);
  if (error || !signed || !validSignedStorageUrl(signed.signedUrl, proxyPath)) {
    throw new Error("proxy_authorization_failed");
  }
  const response = await fetchImpl(signed.signedUrl, {
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

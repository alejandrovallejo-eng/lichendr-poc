"use client";

import { supabase } from "@/lib/supabase/client";
import type { ExtractedImageMetadata } from "@/modules/images/exif";
import {
  IMAGE_STORAGE_BUCKET,
  ImagePersistenceError,
  persistImageTransaction,
  validateImageFile,
  validateImageSignature,
  type ImageUploadContext,
} from "@/modules/images/persistence";
import type { Database } from "@/types/supabase";

export { ImagePersistenceError };
export type { ImageUploadContext };

export type ImageRecordRow = Database["public"]["Tables"]["images"]["Row"];
export type ImageMetadataRow = Database["public"]["Tables"]["image_metadata"]["Row"];
export type StoredImageAnnotationStatus = "not_started" | "draft" | "completed";
export type ImageRecordWithAnnotationStatus = ImageRecordRow & { annotationStatus: StoredImageAnnotationStatus };

export interface ImageUploadProgress {
  bytesSent: number;
  bytesTotal: number;
  percent: number;
}

interface ImageSavePayload {
  treeSampleId: string;
  storagePath: string;
  originalFilename: string;
  mimeType: "image/jpeg" | "image/png";
  fileSizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  imageOrder: number;
  caption: string | null;
}

type ImageMetadataPayload = Omit<Database["public"]["Tables"]["image_metadata"]["Insert"], "image_id">;

function normalizeExtension(filename: string): string {
  const extension = filename.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
  return extension === "jpeg" ? "jpg" : extension;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/\.+/g, ".").replace(/^\.+|\.+$/g, "");
}

export function normalizeStoragePath(context: ImageUploadContext, file: File): string {
  const extension = normalizeExtension(file.name);
  return [
    context.userId,
    context.projectId,
    context.siteId,
    context.eventId,
    context.treeSampleId,
    `${crypto.randomUUID()}.${extension}`,
  ].map(sanitizePathSegment).join("/");
}

function normalizeMetadataForSave(metadata: ExtractedImageMetadata): ImageMetadataPayload {
  const latitude = metadata.latitude != null && Number.isFinite(metadata.latitude) ? metadata.latitude : null;
  const longitude = metadata.longitude != null && Number.isFinite(metadata.longitude) ? metadata.longitude : null;
  const hasCoordinates = latitude != null && longitude != null;
  return {
    extraction_status: metadata.hasExif ? "extracted" : "no_exif",
    captured_at: metadata.capturedAt ?? null,
    captured_at_local: metadata.capturedAtLocal ?? null,
    timezone_offset: metadata.timezoneOffset ?? null,
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    gps_accuracy_m: hasCoordinates && metadata.gpsAccuracyM != null && Number.isFinite(metadata.gpsAccuracyM)
      ? metadata.gpsAccuracyM
      : null,
    location_source: hasCoordinates ? metadata.locationSource : "unknown",
    camera_make: metadata.cameraMake ?? null,
    camera_model: metadata.cameraModel ?? null,
    lens_model: metadata.lensModel ?? null,
    orientation: metadata.orientation ?? null,
    focal_length_mm: metadata.focalLengthMm ?? null,
    aperture_f_number: metadata.apertureFNumber ?? null,
    exposure_time_seconds: metadata.exposureTimeSeconds ?? null,
    iso_speed: metadata.isoSpeed ?? null,
    software: metadata.software ?? null,
    raw_exif: metadata.rawExif ?? {},
    extraction_error: metadata.warning ?? null,
    extracted_at: new Date().toISOString(),
  };
}

export async function resolveImageUploadContext(input: {
  projectId?: string;
  siteId?: string;
  eventId?: string;
  treeSampleId?: string;
}): Promise<ImageUploadContext> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new ImagePersistenceError("Autenticación", userError ?? new Error("No hay un usuario autenticado."));
  }
  if (!input.projectId || !input.siteId || !input.eventId || !input.treeSampleId) {
    throw new ImagePersistenceError("Validación", new Error("Falta proyecto, sitio, jornada o muestra de árbol."));
  }

  const { data: treeSample, error: sampleError } = await supabase
    .from("tree_samples")
    .select("id, site_id, sampling_event_id, tree_id")
    .eq("id", input.treeSampleId)
    .maybeSingle();
  if (sampleError) throw new ImagePersistenceError("Validación", sampleError);
  if (!treeSample) {
    throw new ImagePersistenceError("Validación", new Error("La muestra de árbol seleccionada no existe o no es accesible."));
  }
  if (treeSample.site_id !== input.siteId || treeSample.sampling_event_id !== input.eventId) {
    throw new ImagePersistenceError("Validación", new Error("La muestra, el árbol, el sitio y la jornada no pertenecen al mismo contexto."));
  }

  const { data: site, error: siteError } = await supabase.from("sites").select("project_id").eq("id", input.siteId).maybeSingle();
  if (siteError) throw new ImagePersistenceError("Validación", siteError);
  if (!site || site.project_id !== input.projectId) {
    throw new ImagePersistenceError("Validación", new Error("El sitio no pertenece al proyecto seleccionado."));
  }

  return {
    userId: userData.user.id,
    projectId: input.projectId,
    siteId: input.siteId,
    eventId: input.eventId,
    treeId: treeSample.tree_id,
    treeSampleId: treeSample.id,
  };
}

export async function getImagesForTreeSample(treeSampleId: string): Promise<ImageRecordWithAnnotationStatus[]> {
  const { data, error } = await supabase
    .from("images")
    .select("*")
    .eq("tree_sample_id", treeSampleId)
    .order("image_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  const images = data ?? [];
  if (images.length === 0) return [];

  const { data: annotationSets, error: annotationError } = await supabase
    .from("annotation_sets")
    .select("image_id, status, completed_at")
    .eq("version", 1)
    .in("image_id", images.map((image) => image.id));
  if (annotationError) throw annotationError;
  const byImageId = new Map((annotationSets ?? []).map((annotation) => [annotation.image_id, annotation]));
  return images.map((image) => {
    const annotation = byImageId.get(image.id);
    return {
      ...image,
      annotationStatus: annotation?.status === "completed" && annotation.completed_at
        ? "completed"
        : annotation
          ? "draft"
          : "not_started",
    };
  });
}

export async function createSignedImageUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(IMAGE_STORAGE_BUCKET).createSignedUrl(storagePath, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

async function uploadImageToStorage(
  file: File,
  storagePath: string,
  onProgress?: (progress: ImageUploadProgress) => void
): Promise<void> {
  onProgress?.({ bytesSent: 0, bytesTotal: file.size, percent: 0 });
  const { error } = await supabase.storage.from(IMAGE_STORAGE_BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    contentType: validateImageFile(file).mimeType ?? file.type,
    upsert: false,
  });
  if (error) throw error;
  onProgress?.({ bytesSent: file.size, bytesTotal: file.size, percent: 100 });
}

export async function persistImageWithMetadata(
  file: File,
  context: ImageUploadContext,
  metadata: ExtractedImageMetadata,
  caption: string,
  imageOrder: number,
  onProgress?: (progress: ImageUploadProgress) => void
): Promise<ImageRecordRow> {
  const validation = validateImageFile(file);
  if (!validation.valid || !validation.mimeType) {
    throw new ImagePersistenceError("Validación", new Error(validation.message ?? "Archivo no válido."));
  }
  if (!await validateImageSignature(file, validation.mimeType)) {
    throw new ImagePersistenceError("Validación", new Error("El contenido del archivo no corresponde a una imagen JPEG o PNG válida."));
  }
  if (!context.userId || !context.projectId || !context.siteId || !context.eventId || !context.treeId || !context.treeSampleId) {
    throw new ImagePersistenceError("Validación", new Error("El contexto autenticado de la imagen está incompleto."));
  }
  if (metadata.width != null && metadata.width <= 0 || metadata.height != null && metadata.height <= 0) {
    throw new ImagePersistenceError("Validación", new Error("Las dimensiones de la imagen no son válidas."));
  }

  const storagePath = normalizeStoragePath(context, file);
  const imagePayload: ImageSavePayload = {
    treeSampleId: context.treeSampleId,
    storagePath,
    originalFilename: file.name,
    mimeType: validation.mimeType,
    fileSizeBytes: file.size,
    widthPx: metadata.width ?? null,
    heightPx: metadata.height ?? null,
    imageOrder,
    caption: caption.trim() || null,
  };
  const metadataPayload = normalizeMetadataForSave(metadata);

  return persistImageTransaction(imagePayload, metadataPayload, {
    upload: () => uploadImageToStorage(file, storagePath, onProgress),
    insertImage: async (payload) => {
      const { data, error } = await supabase
        .from("images")
        .insert({
          tree_sample_id: payload.treeSampleId,
          storage_bucket: IMAGE_STORAGE_BUCKET,
          storage_path: payload.storagePath,
          original_filename: payload.originalFilename,
          mime_type: payload.mimeType,
          file_size_bytes: payload.fileSizeBytes,
          width_px: payload.widthPx,
          height_px: payload.heightPx,
          image_order: payload.imageOrder,
          caption: payload.caption,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    insertMetadata: async (record, payload) => {
      const { error } = await supabase.from("image_metadata").insert({ image_id: record.id, ...payload });
      if (error) throw error;
    },
    deleteImage: async (record) => {
      const { data, error } = await supabase.from("images").delete().eq("id", record.id).select("id");
      return !error && data?.length === 1;
    },
    removeStorage: async () => {
      const { error } = await supabase.storage.from(IMAGE_STORAGE_BUCKET).remove([storagePath]);
      return !error;
    },
  });
}

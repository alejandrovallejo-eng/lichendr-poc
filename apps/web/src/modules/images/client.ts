"use client";

import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/types/supabase";
import * as tus from "tus-js-client";
import type { ExtractedImageMetadata } from "@/modules/images/exif";

const STORAGE_BUCKET = "lichen-images";
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
]);

export type ImageRecordRow = Database["public"]["Tables"]["images"]["Row"];
export type ImageMetadataRow = Database["public"]["Tables"]["image_metadata"]["Row"];
export interface ImageSavePayload {
  treeSampleId: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  imageOrder: number;
  caption: string | null;
  metadata: {
    extractionStatus: string;
    capturedAt: string | null;
    captured_at_local: string | null;
    timezoneOffset: string | null;
    latitude: number | null;
    longitude: number | null;
    gpsAccuracyM: number | null;
    locationSource: string;
    cameraMake: string | null;
    cameraModel: string | null;
    lensModel: string | null;
    orientation: number | null;
    focalLengthMm: number | null;
    apertureFNumber: number | null;
    exposureTimeSeconds: number | null;
    isoSpeed: number | null;
    software: string | null;
    rawExif: Record<string, unknown>;
    extractionError: string | null;
    extractedAt: string | null;
  };
}

export interface ImageUploadProgress { bytesSent: number; bytesTotal: number; percent: number; }

interface UploadContext {
  projectId: string;
  siteId: string;
  eventId: string;
  treeSampleId: string;
}

function normalizeExtension(extension: string): string {
  const normalized = extension.toLowerCase().replace(/^\./, "");

  switch (normalized) {
    case "jpg":
    case "jpeg":
      return "jpg";
    case "tif":
      return "tiff";
    default:
      return normalized;
  }
}

function normalizeMimeType(file: File, fallbackMimeType?: string): string {
  const declaredMimeType = file.type.trim();
  if (declaredMimeType && ALLOWED_MIME_TYPES.has(declaredMimeType)) {
    return declaredMimeType;
  }

  const extension = normalizeExtension(file.name.split(".").pop() ?? "");
  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }
  if (extension === "png") {
    return "image/png";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  if (extension === "heic") {
    return "image/heic";
  }
  if (extension === "heif") {
    return "image/heif";
  }
  if (extension === "tif" || extension === "tiff") {
    return "image/tiff";
  }

  return fallbackMimeType ?? "image/jpeg";
}

function isValidContext(context: UploadContext): boolean {
  return Boolean(context.projectId && context.siteId && context.eventId && context.treeSampleId);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/\.+/g, ".").replace(/^\.+|\.+$/g, "");
}

function normalizeStoragePath(ownerId: string, projectId: string, siteId: string, eventId: string, treeSampleId: string, file: File): string {
  const extension = normalizeExtension(file.name.split(".").pop() ?? "");
  const safeExtension = extension ? `.${extension}` : ".bin";
  const uuid = crypto.randomUUID();
  const firstSegment = sanitizePathSegment(ownerId);
  const secondSegment = sanitizePathSegment(projectId);
  const thirdSegment = sanitizePathSegment(siteId);
  const fourthSegment = sanitizePathSegment(eventId);
  const fifthSegment = sanitizePathSegment(treeSampleId);
  return `${firstSegment}/${secondSegment}/${thirdSegment}/${fourthSegment}/${fifthSegment}/${uuid}${safeExtension}`;
}

function normalizeOptionalValue<T>(value: T | undefined | null): T | null {
  return value == null ? null : value;
}

function normalizeMetadataForSave(metadata: ExtractedImageMetadata): ImageSavePayload["metadata"] {
  const latitude = metadata.latitude != null && Number.isFinite(metadata.latitude) ? metadata.latitude : null;
  const longitude = metadata.longitude != null && Number.isFinite(metadata.longitude) ? metadata.longitude : null;
  const hasCoordinates = latitude != null && longitude != null;
  const gpsAccuracyM = hasCoordinates && metadata.gpsAccuracyM != null && Number.isFinite(metadata.gpsAccuracyM) ? metadata.gpsAccuracyM : null;
  const locationSource = hasCoordinates ? "exif" : "unknown";

  return {
    extractionStatus: metadata.hasExif ? "extracted" : "no_exif",
    capturedAt: metadata.capturedAt ?? null,
    captured_at_local: metadata.capturedAtLocal ?? null,
    timezoneOffset: metadata.timezoneOffset ?? null,
    latitude,
    longitude,
    gpsAccuracyM,
    locationSource,
    cameraMake: normalizeOptionalValue(metadata.cameraMake),
    cameraModel: normalizeOptionalValue(metadata.cameraModel),
    lensModel: normalizeOptionalValue(metadata.lensModel),
    orientation: normalizeOptionalValue(metadata.orientation),
    focalLengthMm: normalizeOptionalValue(metadata.focalLengthMm),
    apertureFNumber: normalizeOptionalValue(metadata.apertureFNumber),
    exposureTimeSeconds: normalizeOptionalValue(metadata.exposureTimeSeconds),
    isoSpeed: normalizeOptionalValue(metadata.isoSpeed),
    software: normalizeOptionalValue(metadata.software),
    rawExif: (metadata.rawExif ?? {}) as Record<string, unknown>,
    extractionError: metadata.warning ?? null,
    extractedAt: new Date().toISOString(),
  };
}

export async function getImagesForTreeSample(treeSampleId: string): Promise<ImageRecordRow[]> {
  const { data, error } = await supabase
    .from("images")
    .select("*")
    .eq("tree_sample_id", treeSampleId)
    .order("image_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function getImageMetadataForImage(imageId: string): Promise<ImageMetadataRow | null> {
  const { data, error } = await supabase.from("image_metadata").select("*").eq("image_id", imageId).maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

export async function createImageRecord(payload: ImageSavePayload): Promise<ImageRecordRow> {
  const { data, error } = await supabase
    .from("images")
    .insert({
      tree_sample_id: payload.treeSampleId,
      storage_bucket: STORAGE_BUCKET,
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

  if (error) {
    throw error;
  }

  return data;
}

export async function createImageMetadataRecord(imageId: string, metadata: ImageSavePayload["metadata"]): Promise<ImageMetadataRow> {
  const { data, error } = await supabase
    .from("image_metadata")
    .insert({
      image_id: imageId,
      extraction_status: metadata.extractionStatus,
      captured_at: metadata.capturedAt,
      captured_at_local: metadata.captured_at_local,
      timezone_offset: metadata.timezoneOffset,
      latitude: metadata.latitude,
      longitude: metadata.longitude,
      gps_accuracy_m: metadata.gpsAccuracyM,
      location_source: metadata.locationSource,
      camera_make: metadata.cameraMake,
      camera_model: metadata.cameraModel,
      lens_model: metadata.lensModel,
      orientation: metadata.orientation,
      focal_length_mm: metadata.focalLengthMm,
      aperture_f_number: metadata.apertureFNumber,
      exposure_time_seconds: metadata.exposureTimeSeconds,
      iso_speed: metadata.isoSpeed,
      software: metadata.software,
      raw_exif: metadata.rawExif,
      extraction_error: metadata.extractionError,
      extracted_at: metadata.extractedAt,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function createSignedImageUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 60 * 60);

  if (error) {
    throw error;
  }

  return data.signedUrl;
}

export async function removeStorageObject(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);

  if (error) {
    throw error;
  }
}

export async function deleteImageRecord(imageId: string): Promise<void> {
  const { error } = await supabase.from("images").delete().eq("id", imageId);

  if (error) {
    throw error;
  }
}

export async function uploadImageToStorage(file: File, storagePath: string, onProgress?: (progress: ImageUploadProgress) => void): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error("No authenticated session is available");
  }

  const projectRef = supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
  const upload = new tus.Upload(file, {
    endpoint: `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    chunkSize: 6 * 1024 * 1024,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    metadata: {
      bucketName: STORAGE_BUCKET,
      objectName: storagePath,
      contentType: normalizeMimeType(file),
      cacheControl: "3600",
    },
    onProgress: (bytesSent, bytesTotal) => {
      if (onProgress) {
        onProgress({ bytesSent, bytesTotal, percent: bytesTotal > 0 ? Math.round((bytesSent / bytesTotal) * 100) : 0 });
      }
    },
    onError: (error) => {
      throw error;
    },
  });

  await new Promise<void>((resolve, reject) => {
    upload.start();
    upload.options.onSuccess = () => resolve();
    upload.options.onError = (error) => reject(error);
  });
}

export async function persistImageWithMetadata(
  file: File,
  context: UploadContext,
  metadata: ExtractedImageMetadata,
  caption: string,
  imageOrder: number,
  onProgress?: (progress: ImageUploadProgress) => void
): Promise<ImageRecordRow> {
  if (!isValidContext(context)) {
    throw new Error("El contexto de proyecto, sitio, jornada y muestreo debe ser válido.");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("El archivo supera el límite de 20 MB.");
  }

  const latitude = metadata.latitude != null && Number.isFinite(metadata.latitude) ? metadata.latitude : null;
  const longitude = metadata.longitude != null && Number.isFinite(metadata.longitude) ? metadata.longitude : null;
  if (latitude == null || longitude == null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error("Latitud y longitud deben ser coherentes antes de guardar.");
  }

  if (metadata.width != null && metadata.width <= 0) {
    throw new Error("El ancho de imagen no es válido.");
  }

  if (metadata.height != null && metadata.height <= 0) {
    throw new Error("La altura de imagen no es válido.");
  }

  const normalizedMimeType = normalizeMimeType(file);
  const storagePath = normalizeStoragePath(
    (await supabase.auth.getSession()).data.session?.user.id ?? "anonymous",
    context.projectId,
    context.siteId,
    context.eventId,
    context.treeSampleId,
    file
  );

  await uploadImageToStorage(file, storagePath, onProgress);

  const imageRecord = await createImageRecord({
    treeSampleId: context.treeSampleId,
    storagePath,
    originalFilename: file.name,
    mimeType: normalizedMimeType,
    fileSizeBytes: file.size,
    widthPx: metadata.width ?? null,
    heightPx: metadata.height ?? null,
    imageOrder,
    caption,
    metadata: normalizeMetadataForSave(metadata),
  });

  await createImageMetadataRecord(imageRecord.id, normalizeMetadataForSave(metadata));

  return imageRecord;
}

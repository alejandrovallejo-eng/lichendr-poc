export const IMAGE_STORAGE_BUCKET = "lichen-images";
export const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;

export type ImagePersistenceStage =
  | "Autenticación"
  | "Validación"
  | "Subida a Storage"
  | "Registro en base de datos"
  | "Limpieza posterior";

export interface ImageUploadContext {
  userId: string;
  projectId: string;
  siteId: string;
  eventId: string;
  treeId: string;
  treeSampleId: string;
}

export interface ImageFileDescriptor {
  name: string;
  size: number;
  type: string;
}

export interface ImageMetadataValidation {
  latitude: string;
  longitude: string;
  gpsAccuracyM: string;
}

export interface ImageValidationResult {
  valid: boolean;
  message: string | null;
  mimeType: "image/jpeg" | "image/png" | null;
}

export interface ImageCleanupResult {
  databaseSucceeded: boolean;
  storageSucceeded: boolean;
}

export class ImagePersistenceError extends Error {
  readonly stage: ImagePersistenceStage;
  readonly code: string | null;
  readonly canRetry: boolean;
  readonly cleanup: ImageCleanupResult | null;

  constructor(
    stage: ImagePersistenceStage,
    detail: unknown,
    options: { canRetry?: boolean; cleanup?: ImageCleanupResult | null } = {}
  ) {
    const safeDetail = sanitizeSupabaseError(detail);
    const cleanupMessage = options.cleanup
      ? ` Limpieza: base de datos ${options.cleanup.databaseSucceeded ? "correcta" : "fallida"}; Storage ${options.cleanup.storageSucceeded ? "correcta" : "fallida"}.`
      : "";
    super(`${stage}: ${safeDetail.message}${cleanupMessage}`);
    this.name = "ImagePersistenceError";
    this.stage = stage;
    this.code = safeDetail.code;
    this.canRetry = options.canRetry ?? true;
    this.cleanup = options.cleanup ?? null;
  }
}

export interface ImagePersistenceDependencies<TRecord, TImagePayload, TMetadataPayload> {
  upload: () => Promise<void>;
  insertImage: (payload: TImagePayload) => Promise<TRecord>;
  insertMetadata: (record: TRecord, payload: TMetadataPayload) => Promise<void>;
  deleteImage: (record: TRecord) => Promise<boolean>;
  removeStorage: () => Promise<boolean>;
}

export async function persistImageTransaction<TRecord, TImagePayload, TMetadataPayload>(
  imagePayload: TImagePayload,
  metadataPayload: TMetadataPayload,
  dependencies: ImagePersistenceDependencies<TRecord, TImagePayload, TMetadataPayload>
): Promise<TRecord> {
  try {
    await dependencies.upload();
  } catch (error) {
    const storageSucceeded = await safelyCleanup(dependencies.removeStorage);
    throw new ImagePersistenceError(storageSucceeded ? "Subida a Storage" : "Limpieza posterior", error, {
      canRetry: storageSucceeded,
      cleanup: { databaseSucceeded: true, storageSucceeded },
    });
  }

  let record: TRecord;
  try {
    record = await dependencies.insertImage(imagePayload);
  } catch (error) {
    const storageSucceeded = await safelyCleanup(dependencies.removeStorage);
    const cleanup = { databaseSucceeded: true, storageSucceeded };
    throw new ImagePersistenceError(storageSucceeded ? "Registro en base de datos" : "Limpieza posterior", error, {
      canRetry: storageSucceeded,
      cleanup,
    });
  }

  try {
    await dependencies.insertMetadata(record, metadataPayload);
  } catch (error) {
    const databaseSucceeded = await safelyCleanup(() => dependencies.deleteImage(record));
    const storageSucceeded = await safelyCleanup(dependencies.removeStorage);
    const cleanup = { databaseSucceeded, storageSucceeded };
    const cleanupSucceeded = databaseSucceeded && storageSucceeded;
    throw new ImagePersistenceError(cleanupSucceeded ? "Registro en base de datos" : "Limpieza posterior", error, {
      canRetry: cleanupSucceeded,
      cleanup,
    });
  }

  return record;
}

async function safelyCleanup(operation: () => Promise<boolean>): Promise<boolean> {
  try {
    return await operation();
  } catch {
    return false;
  }
}

export function validateImageFile(file: ImageFileDescriptor): ImageValidationResult {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  const jpegExtensions = new Set([".jpg", ".jpeg"]);
  const heicTypes = new Set(["image/heic", "image/heif"]);
  const heicExtensions = new Set([".heic", ".heif"]);

  if (heicTypes.has(file.type.toLowerCase()) || heicExtensions.has(extension)) {
    return {
      valid: false,
      mimeType: null,
      message: "HEIC/HEIF todavía no se puede guardar de forma fiable. Convierte la imagen a JPEG o PNG antes de seleccionarla.",
    };
  }

  const mimeType = file.type.toLowerCase();
  const validJpeg = mimeType === "image/jpeg" && jpegExtensions.has(extension);
  const validPng = mimeType === "image/png" && extension === ".png";
  if (!validJpeg && !validPng) {
    return {
      valid: false,
      mimeType: null,
      message: "Formato no admitido. Usa una imagen JPEG o PNG con un tipo MIME válido.",
    };
  }

  if (!file.name.trim()) {
    return { valid: false, mimeType: null, message: "El archivo debe tener un nombre válido." };
  }
  if (file.size <= 0) {
    return { valid: false, mimeType: null, message: "El archivo está vacío." };
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return { valid: false, mimeType: null, message: "El archivo supera el límite de 20 MB." };
  }

  return { valid: true, mimeType: validJpeg ? "image/jpeg" : "image/png", message: null };
}

export async function validateImageSignature(
  file: Pick<Blob, "slice">,
  mimeType: "image/jpeg" | "image/png"
): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length === pngSignature.length && pngSignature.every((value, index) => bytes[index] === value);
}

export function validateImageUploadPrerequisites(
  context: Partial<ImageUploadContext>,
  file: ImageFileDescriptor | null,
  metadata: ImageMetadataValidation | null
): string[] {
  const missing: string[] = [];
  if (!context.userId) missing.push("usuario autenticado");
  if (!context.projectId) missing.push("proyecto");
  if (!context.siteId) missing.push("sitio");
  if (!context.eventId) missing.push("jornada de muestreo");
  if (!context.treeId) missing.push("árbol");
  if (!context.treeSampleId) missing.push("muestra de árbol");

  if (!file) {
    missing.push("archivo compatible");
  } else {
    const validation = validateImageFile(file);
    if (!validation.valid) missing.push(validation.message ?? "archivo compatible");
  }

  if (!metadata || !isMetadataValid(metadata)) {
    missing.push("metadatos requeridos (coordenadas y precisión válidas)");
  }
  return missing;
}

export function isMetadataValid(metadata: ImageMetadataValidation): boolean {
  const latitudePresent = metadata.latitude.trim() !== "";
  const longitudePresent = metadata.longitude.trim() !== "";
  if (latitudePresent !== longitudePresent) return false;
  if (latitudePresent) {
    const latitude = Number(metadata.latitude);
    const longitude = Number(metadata.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return false;
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return false;
  }
  if (metadata.gpsAccuracyM.trim()) {
    const accuracy = Number(metadata.gpsAccuracyM);
    if (!Number.isFinite(accuracy) || accuracy < 0) return false;
  }
  return true;
}

export function getRetryableImageIds<T extends { id: string; saveState: string }>(
  images: readonly T[],
  targetImageId?: string
): string[] {
  return images
    .filter((image) => (!targetImageId || image.id === targetImageId) && image.saveState !== "saved" && image.saveState !== "cleanup-pending")
    .map((image) => image.id);
}

export function sanitizeSupabaseError(error: unknown): { code: string | null; message: string } {
  const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const rawCode = typeof candidate.code === "string" ? candidate.code : typeof candidate.status === "number" ? String(candidate.status) : "";
  const code = /^[A-Za-z0-9_.-]{1,80}$/.test(rawCode) ? rawCode : null;
  const rawMessage = typeof candidate.message === "string"
    ? candidate.message
    : error instanceof Error
      ? error.message
      : "Error desconocido.";
  const message = rawMessage.split(/\n\s*at\s+/i, 1)[0]
    .replace(/bearer\s+[^\s,;]+/gi, "******")
    .replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]+\b/g, "[token oculto]")
    .replace(/([?&](?:token|access_token|apikey|api_key|key|signature)=)[^&#\s]+/gi, "$1[oculto]")
    .replace(/\b(authorization|access[_ -]?token|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[oculto]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return { code, message: `${code ? `[${code}] ` : ""}${message || "Error desconocido."}` };
}

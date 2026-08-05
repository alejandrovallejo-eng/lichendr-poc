"use client";

import { ensureAnonymousSession } from "@/modules/auth/client";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/types/supabase";

export const ANNOTATION_REGION_CLASSES = ["lichen", "bark", "moss", "algae", "shadow", "glare", "unknown"] as const;
export const SIGNED_URL_TTL_SECONDS = 10 * 60;
const MASK_BUCKET = "lichen-images";
const MAX_MASK_BYTES = 10 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export type AnnotationRegionRow = Database["public"]["Tables"]["annotation_regions"]["Row"];
export type AnnotationSetRow = Database["public"]["Tables"]["annotation_sets"]["Row"];
export type MorphotypeRow = Database["public"]["Tables"]["morphotypes"]["Row"];
export type AnnotationRegionClassification = (typeof ANNOTATION_REGION_CLASSES)[number];
export type AnnotationRegionSource = "mobile_sam" | "manual" | "color_assisted";

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface AccessibleStoredImage {
  id: string;
  original_filename: string;
  mime_type: string;
  storage_path: string;
}

export interface RegionSaveInput {
  id: string;
  annotationSetId: string;
  classification: AnnotationRegionClassification;
  morphotypeId: string | null;
  mask: Blob;
  width: number;
  height: number;
  areaPixels: number;
  score: number | null;
  positivePoints: NormalizedPoint[];
  negativePoints: NormalizedPoint[];
  modelName: string;
  modelVersion: string | null;
  notes: string | null;
  source?: AnnotationRegionSource;
  representativeColorHex?: string | null;
  colorToleranceDeltaE?: number | null;
  regionRole?: "trunk" | null;
  overwriteExistingMask?: boolean;
}

export class RegionPersistenceError extends Error {
  readonly cleanupPending: boolean;
  readonly regionId: string;

  constructor(message: string, regionId: string, cleanupPending: boolean) {
    super(message);
    this.name = "RegionPersistenceError";
    this.regionId = regionId;
    this.cleanupPending = cleanupPending;
  }
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function assertUuid(value: string, label: string): void {
  if (!isUuid(value)) throw new Error(`${label} no es válido.`);
}

function assertClassification(value: string): asserts value is AnnotationRegionClassification {
  if (!ANNOTATION_REGION_CLASSES.includes(value as AnnotationRegionClassification)) {
    throw new Error("La clasificación no es válida.");
  }
}

function assertNormalizedPoints(points: NormalizedPoint[]): void {
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)) {
    throw new Error("Los puntos de guía no son válidos.");
  }
}

async function ensureSession(): Promise<void> {
  const result = await ensureAnonymousSession();
  if (result.error || !result.session) throw new Error(result.error ?? "No se pudo validar la sesión.");
}

async function assertPngMask(mask: Blob): Promise<void> {
  if (mask.type !== "image/png" || mask.size === 0 || mask.size > MAX_MASK_BYTES) {
    throw new Error("La máscara PNG no cumple el tamaño permitido.");
  }
  const bytes = new Uint8Array(await mask.slice(0, PNG_SIGNATURE.length).arrayBuffer());
  if (bytes.length !== PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error("La máscara no contiene un PNG válido.");
  }
}

export async function getAccessibleStoredImage(imageId: string): Promise<AccessibleStoredImage | null> {
  assertUuid(imageId, "La imagen");
  await ensureSession();
  const { data, error } = await supabase
    .from("images")
    .select("id, original_filename, mime_type, storage_path")
    .eq("id", imageId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createTemporaryUrl(storagePath: string): Promise<string> {
  await ensureSession();
  const { data, error } = await supabase.storage.from(MASK_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export async function loadAiAnnotationState(annotationSetId: string): Promise<{ regions: AnnotationRegionRow[]; morphotypes: MorphotypeRow[] }> {
  assertUuid(annotationSetId, "El conjunto de anotación");
  await ensureSession();
  const [{ data: regions, error: regionsError }, { data: morphotypes, error: morphotypesError }] = await Promise.all([
    supabase.from("annotation_regions").select("*").eq("annotation_set_id", annotationSetId).eq("status", "accepted").order("created_at", { ascending: true }),
    supabase.from("morphotypes").select("*").eq("annotation_set_id", annotationSetId).order("created_at", { ascending: true }),
  ]);
  if (regionsError) throw regionsError;
  if (morphotypesError) throw morphotypesError;
  return { regions: regions ?? [], morphotypes: morphotypes ?? [] };
}

export async function assertAnnotationSetForImage(annotationSetId: string, imageId: string): Promise<void> {
  assertUuid(annotationSetId, "El conjunto de anotación");
  assertUuid(imageId, "La imagen");
  await ensureSession();
  const { data, error } = await supabase
    .from("annotation_sets")
    .select("id")
    .eq("id", annotationSetId)
    .eq("image_id", imageId)
    .maybeSingle();
  if (error || !data) throw new Error("El conjunto de anotación no está disponible para esta imagen.");
}

export async function createMorphotypeForAnnotationSet(
  annotationSetId: string,
  label: string,
  growthForm: MorphotypeRow["growth_form"],
  colorHex: string | null,
  notes: string | null,
): Promise<MorphotypeRow> {
  assertUuid(annotationSetId, "El conjunto de anotación");
  const trimmedLabel = label.trim();
  if (!trimmedLabel || trimmedLabel.length > 80) throw new Error("El nombre del morfotipo no es válido.");
  if (colorHex && !/^#[0-9A-Fa-f]{6}$/.test(colorHex)) throw new Error("El color debe usar formato #RRGGBB.");
  await ensureSession();
  const { data: existingMorphotypes, error: duplicateError } = await supabase
    .from("morphotypes")
    .select("label")
    .eq("annotation_set_id", annotationSetId);
  if (duplicateError) throw duplicateError;
  if ((existingMorphotypes ?? []).some((morphotype) => morphotype.label.toLocaleLowerCase() === trimmedLabel.toLocaleLowerCase())) {
    throw new Error("Ya existe un morfotipo con ese nombre.");
  }
  const { data, error } = await supabase
    .from("morphotypes")
    .insert({ annotation_set_id: annotationSetId, label: trimmedLabel, growth_form: growthForm, color_hex: colorHex, notes })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function saveAcceptedRegion(input: RegionSaveInput): Promise<AnnotationRegionRow> {
  const regionId = input.id;
  const annotationSetId = input.annotationSetId;
  const morphotypeId = input.classification === "lichen" ? input.morphotypeId : null;
  assertUuid(regionId, "La capa");
  assertUuid(annotationSetId, "El conjunto de anotación");
  assertClassification(input.classification);
  if (input.classification === "lichen" && !morphotypeId) throw new Error("Selecciona un morfotipo para la capa de líquen.");
  if (morphotypeId) assertUuid(morphotypeId, "El morfotipo");
  const source = input.source ?? "mobile_sam";
  const representativeColorHex = input.representativeColorHex ?? null;
  const colorToleranceDeltaE = input.colorToleranceDeltaE ?? null;
  const regionRole = input.regionRole ?? null;
  if (!["mobile_sam", "manual", "color_assisted"].includes(source)) {
    throw new Error("La procedencia de la máscara no es válida.");
  }
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width <= 0 || input.height <= 0 || !Number.isInteger(input.areaPixels) || input.areaPixels <= 0 || (input.score !== null && (!Number.isFinite(input.score) || input.score < 0)) || !input.modelName.trim()) {
    throw new Error("Los metadatos de la máscara no son válidos.");
  }
  if (representativeColorHex && !/^#[0-9A-Fa-f]{6}$/.test(representativeColorHex)) {
    throw new Error("El color representativo debe usar formato #RRGGBB.");
  }
  if (colorToleranceDeltaE !== null && (!Number.isFinite(colorToleranceDeltaE) || colorToleranceDeltaE < 0 || colorToleranceDeltaE > 50)) {
    throw new Error("La tolerancia de color no es válida.");
  }
  if (regionRole === "trunk" && input.classification !== "bark") {
    throw new Error("El rol de tronco evaluable requiere clasificación de corteza.");
  }
  assertNormalizedPoints(input.positivePoints);
  assertNormalizedPoints(input.negativePoints);
  await assertPngMask(input.mask);
  await ensureSession();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user?.id) throw new Error("No se pudo validar el usuario.");
  const maskPath = `${user.id}/annotations/${annotationSetId}/${regionId}.png`;
  const { error: uploadError } = await supabase.storage.from(MASK_BUCKET).upload(maskPath, input.mask, {
    contentType: "image/png",
    upsert: input.overwriteExistingMask ?? false,
  });
  if (uploadError) throw new RegionPersistenceError("No se pudo subir la máscara. Puedes reintentar.", regionId, false);

  const { data, error } = await supabase
    .from("annotation_regions")
    .insert({
      id: regionId,
      annotation_set_id: annotationSetId,
      classification: input.classification,
      morphotype_id: morphotypeId,
      source,
      model_name: input.modelName.trim(),
      model_version: input.modelVersion,
      mask_bucket: MASK_BUCKET,
      mask_path: maskPath,
      mask_width_px: input.width,
      mask_height_px: input.height,
      area_pixels: input.areaPixels,
      score: input.score,
      representative_color_hex: representativeColorHex,
      color_tolerance_delta_e: colorToleranceDeltaE,
      region_role: regionRole,
      positive_points: input.positivePoints,
      negative_points: input.negativePoints,
      status: "accepted",
      notes: input.notes,
    })
    .select("*")
    .single();
  if (!error) return data;

  const { error: cleanupError } = await supabase.storage.from(MASK_BUCKET).remove([maskPath]);
  throw new RegionPersistenceError(
    cleanupError ? `Limpieza pendiente de la capa ${regionId}. Usa reintentar sin crear otra capa.` : "No se pudo guardar la capa; la máscara subida fue limpiada.",
    regionId,
    Boolean(cleanupError),
  );
}

export async function updateRegionClassification(
  regionId: string,
  annotationSetId: string,
  classification: AnnotationRegionClassification,
  morphotypeId: string | null,
): Promise<AnnotationRegionRow> {
  assertUuid(regionId, "La capa");
  assertUuid(annotationSetId, "El conjunto de anotación");
  assertClassification(classification);
  const normalizedMorphotypeId = classification === "lichen" ? morphotypeId : null;
  if (classification === "lichen" && !normalizedMorphotypeId) throw new Error("Selecciona un morfotipo para la capa de líquen.");
  await ensureSession();
  if (normalizedMorphotypeId) {
    assertUuid(normalizedMorphotypeId, "El morfotipo");
    const { data, error } = await supabase.from("morphotypes").select("id").eq("id", normalizedMorphotypeId).eq("annotation_set_id", annotationSetId).maybeSingle();
    if (error || !data) throw new Error("El morfotipo no pertenece a este conjunto de anotación.");
  }
  const { data, error } = await supabase
    .from("annotation_regions")
    .update({ classification, morphotype_id: normalizedMorphotypeId })
    .eq("id", regionId)
    .eq("annotation_set_id", annotationSetId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateRegionNotes(
  regionId: string,
  annotationSetId: string,
  notes: string | null,
): Promise<AnnotationRegionRow> {
  assertUuid(regionId, "La capa");
  assertUuid(annotationSetId, "El conjunto de anotación");
  await ensureSession();
  const normalizedNotes = notes?.trim() || null;
  const { data, error } = await supabase
    .from("annotation_regions")
    .update({ notes: normalizedNotes })
    .eq("id", regionId)
    .eq("annotation_set_id", annotationSetId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRegionWithStorage(region: AnnotationRegionRow): Promise<void> {
  await ensureSession();
  const { error: databaseError } = await supabase.from("annotation_regions").delete().eq("id", region.id).eq("annotation_set_id", region.annotation_set_id);
  if (databaseError) throw new Error("No se pudo eliminar el registro de la capa.");
  const { error: storageError } = await supabase.storage.from(MASK_BUCKET).remove([region.mask_path]);
  if (!storageError) return;

  throw new RegionPersistenceError("Limpieza pendiente de la capa eliminada. Conserva el identificador de la capa para reintentar.", region.id, true);
}

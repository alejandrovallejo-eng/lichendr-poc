import { ensureAnonymousSession } from "@/modules/auth/client";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/types/supabase";

export type AnnotationSetRow = Database["public"]["Tables"]["annotation_sets"]["Row"];
export type MorphotypeRow = Database["public"]["Tables"]["morphotypes"]["Row"];
export type AnnotationPointRow = Database["public"]["Tables"]["annotation_points"]["Row"];

export type AnnotationSetStatus = "draft" | "completed";
export type AnnotationMethod = "systematic_point_count";
export type MorphotypeGrowthForm = "crustose" | "foliose" | "fruticose" | "squamulose" | "unknown";
export type AnnotationPointClassification = "lichen" | "bark" | "moss" | "algae" | "shadow" | "glare" | "unknown";
export type AnnotationPointConfidenceLevel = "low" | "medium" | "high";

export interface AccessibleImageRecord {
  id: string;
  original_filename: string;
  created_at: string;
  storage_path: string;
}

export interface AnnotationSetDraft {
  imageId: string;
  version?: number;
  method?: AnnotationMethod;
  status?: AnnotationSetStatus;
  gridRows: number;
  gridColumns: number;
  roiX: number | null;
  roiY: number | null;
  roiWidth: number | null;
  roiHeight: number | null;
  notes?: string | null;
  completedAt?: string | null;
}

export interface MorphotypeDraft {
  id?: string;
  annotationSetId: string;
  label: string;
  growthForm: MorphotypeGrowthForm;
  colorHex: string | null;
  notes: string | null;
}

export interface AnnotationPointDraft {
  id?: string;
  annotationSetId: string;
  pointIndex: number;
  xNormalized: number;
  yNormalized: number;
  classification: AnnotationPointClassification;
  confidenceLevel: AnnotationPointConfidenceLevel;
  morphotypeId: string | null;
  notes?: string | null;
}

export interface AnnotationStateBundle {
  annotationSet: AnnotationSetRow | null;
  morphotypes: MorphotypeRow[];
  points: AnnotationPointRow[];
}

async function ensureSession() {
  const sessionResult = await ensureAnonymousSession();
  if (sessionResult.error || !sessionResult.session) {
    throw new Error(sessionResult.error ?? "No se pudo obtener una sesión válida.");
  }
}

export async function listAccessibleImages(): Promise<AccessibleImageRecord[]> {
  await ensureSession();

  const { data, error } = await supabase
    .from("images")
    .select("id, original_filename, created_at, storage_path")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as AccessibleImageRecord[];
}

export async function getSignedImageUrl(storagePath: string): Promise<string> {
  await ensureSession();

  const { data, error } = await supabase.storage.from("lichen-images").createSignedUrl(storagePath, 60 * 60);
  if (error) {
    throw error;
  }

  return data.signedUrl;
}

export async function getImageRecord(imageId: string): Promise<AccessibleImageRecord | null> {
  await ensureSession();

  const { data, error } = await supabase.from("images").select("id, original_filename, created_at, storage_path").eq("id", imageId).maybeSingle();
  if (error) {
    throw error;
  }

  return (data as AccessibleImageRecord | null) ?? null;
}

export async function loadAnnotationState(imageId: string): Promise<AnnotationStateBundle> {
  await ensureSession();

  const { data: annotationSet, error: annotationSetError } = await supabase
    .from("annotation_sets")
    .select("*")
    .eq("image_id", imageId)
    .eq("version", 1)
    .maybeSingle();

  if (annotationSetError) {
    throw annotationSetError;
  }

  if (!annotationSet) {
    return { annotationSet: null, morphotypes: [], points: [] };
  }

  const annotationSetId = annotationSet.id;

  const [{ data: morphotypes, error: morphotypesError }, { data: points, error: pointsError }] = await Promise.all([
    supabase.from("morphotypes").select("*").eq("annotation_set_id", annotationSetId).order("created_at", { ascending: true }),
    supabase.from("annotation_points").select("*").eq("annotation_set_id", annotationSetId).order("point_index", { ascending: true }),
  ]);

  if (morphotypesError) {
    throw morphotypesError;
  }

  if (pointsError) {
    throw pointsError;
  }

  return {
    annotationSet: annotationSet as AnnotationSetRow,
    morphotypes: (morphotypes ?? []) as MorphotypeRow[],
    points: (points ?? []) as AnnotationPointRow[],
  };
}

export async function upsertAnnotationSet(payload: AnnotationSetDraft): Promise<AnnotationSetRow> {
  await ensureSession();

  const existing = await supabase.from("annotation_sets").select("*").eq("image_id", payload.imageId).eq("version", payload.version ?? 1).maybeSingle();
  if (existing.error) {
    throw existing.error;
  }

  const basePayload = {
    image_id: payload.imageId,
    method: payload.method ?? "systematic_point_count",
    status: payload.status ?? "draft",
    version: payload.version ?? 1,
    grid_rows: payload.gridRows,
    grid_columns: payload.gridColumns,
    roi_x: payload.roiX,
    roi_y: payload.roiY,
    roi_width: payload.roiWidth,
    roi_height: payload.roiHeight,
    notes: payload.notes ?? null,
    completed_at: payload.completedAt ?? null,
  };

  if (existing.data) {
    const { data, error } = await supabase
      .from("annotation_sets")
      .update(basePayload)
      .eq("id", existing.data.id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as AnnotationSetRow;
  }

  const { data, error } = await supabase.from("annotation_sets").insert(basePayload).select("*").single();
  if (error) {
    throw error;
  }

  return data as AnnotationSetRow;
}

export async function upsertMorphotype(payload: MorphotypeDraft): Promise<MorphotypeRow> {
  await ensureSession();

  if (payload.id) {
    const { data, error } = await supabase
      .from("morphotypes")
      .update({
        annotation_set_id: payload.annotationSetId,
        label: payload.label,
        growth_form: payload.growthForm,
        color_hex: payload.colorHex,
        notes: payload.notes,
      })
      .eq("id", payload.id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as MorphotypeRow;
  }

  const { data, error } = await supabase
    .from("morphotypes")
    .insert({
      annotation_set_id: payload.annotationSetId,
      label: payload.label,
      growth_form: payload.growthForm,
      color_hex: payload.colorHex,
      notes: payload.notes,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as MorphotypeRow;
}

export async function deleteMorphotype(morphotypeId: string): Promise<void> {
  await ensureSession();

  const { error } = await supabase.from("morphotypes").delete().eq("id", morphotypeId);
  if (error) {
    throw error;
  }
}

export async function upsertAnnotationPoint(payload: AnnotationPointDraft): Promise<AnnotationPointRow> {
  await ensureSession();

  const pointPayload = {
    annotation_set_id: payload.annotationSetId,
    morphotype_id: payload.morphotypeId,
    point_index: payload.pointIndex,
    x_normalized: payload.xNormalized,
    y_normalized: payload.yNormalized,
    classification: payload.classification,
    confidence_level: payload.confidenceLevel,
    notes: payload.notes ?? null,
  };

  if (payload.id) {
    const { data, error } = await supabase.from("annotation_points").update(pointPayload).eq("id", payload.id).select("*").single();
    if (error) {
      throw error;
    }

    return data as AnnotationPointRow;
  }

  const { data, error } = await supabase.from("annotation_points").upsert(pointPayload, { onConflict: "annotation_set_id,point_index" }).select("*").single();
  if (error) {
    throw error;
  }

  return data as AnnotationPointRow;
}

export async function deleteAnnotationPoint(pointId: string): Promise<void> {
  await ensureSession();

  const { error } = await supabase.from("annotation_points").delete().eq("id", pointId);
  if (error) {
    throw error;
  }
}

export async function completeAnnotationSet(annotationSetId: string): Promise<AnnotationSetRow> {
  await ensureSession();

  const { data, error } = await supabase
    .from("annotation_sets")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", annotationSetId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as AnnotationSetRow;
}

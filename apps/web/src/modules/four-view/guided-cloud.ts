import type { SupabaseClient } from "@supabase/supabase-js";
import { parseGuidedReview, type GuidedReview } from "./guided-flow";
import type { Direction } from "./types";

export interface ReviewReference { ownerId: string; imageId: string; treeSampleId: string; direction: Direction }
export interface CloudReview { review: GuidedReview; revision: number }
export interface GuidedCloudStore {
  read(reference: ReviewReference): Promise<CloudReview | null>;
  write(reference: ReviewReference, review: GuidedReview, expectedRevision: number): Promise<CloudReview>;
}

// PostgreSQL jsonb may reorder object keys. Equality must not treat that as an edit.
export function reviewFingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)]));
    return item;
  };
  return JSON.stringify(canonical(value));
}

const unavailable = () => new Error("No se pudo confirmar el guardado en la nube. Tu borrador sigue en este navegador; reintenta sin cerrar la pestaña.");
export function parseCloudReview(row: unknown): CloudReview {
  const value = row as { review?: unknown; revision?: unknown } | null;
  const review = parseGuidedReview(JSON.stringify(value?.review));
  if (!review || !Number.isSafeInteger(value?.revision) || Number(value?.revision) < 1)
    throw new Error("La revisión guardada no es válida. No se reemplazará automáticamente.");
  return { review, revision: Number(value!.revision) };
}

// New table has its own RLS; no service-role credential is used in the browser.
export function createGuidedCloudStore(db: SupabaseClient): GuidedCloudStore {
  return {
    async read(ref) {
      const { data, error } = await db.from("guided_capture_reviews")
        .select("review,revision").eq("owner_id", ref.ownerId).eq("image_id", ref.imageId)
        .eq("tree_sample_id", ref.treeSampleId).eq("direction", ref.direction).maybeSingle();
      if (error) throw unavailable();
      return data ? parseCloudReview(data) : null;
    },
    async write(ref, review, expectedRevision) {
      const valid = parseGuidedReview(JSON.stringify(review));
      if (!valid) throw new Error("La revisión no es válida y no se guardó.");
      const { data, error } = await db.rpc("save_guided_capture_review", {
        p_image_id: ref.imageId, p_tree_sample_id: ref.treeSampleId, p_direction: ref.direction,
        p_review: valid, p_expected_revision: expectedRevision,
      }).single();
      if (error?.code === "40001") throw new Error("Esta foto cambió en otra pestaña. Tu borrador se conserva aquí; recarga para revisar la versión más reciente antes de guardar.");
      if (error) throw unavailable();
      return parseCloudReview(data);
    },
  };
}

// All saves for one mounted image are ordered, including an automatic draft
// save followed immediately by explicit Save/Next. Revisions are server-owned.
export function orderedCloudWriter(store: GuidedCloudStore, ref: ReviewReference, revision: number) {
  let tail: Promise<unknown> = Promise.resolve();
  return (review: GuidedReview): Promise<CloudReview> => {
    const snapshot = parseGuidedReview(JSON.stringify(review));
    if (!snapshot) return Promise.reject(new Error("La revisión no es válida."));
    const task = tail.then(async () => {
      const saved = await store.write(ref, snapshot, revision);
      revision = saved.revision;
      return saved;
    });
    tail = task.catch(() => undefined);
    return task;
  };
}

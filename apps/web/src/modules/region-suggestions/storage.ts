// Owner-scoped local restoration of a suggestion batch.
//
// Reload must show photographs, suggestions and reviews again without
// re-running any model. This pilot deliberately adds NO database migration and
// changes no RLS policy: durable server-side persistence is an open decision
// documented in docs/BIOCLIP_PILOT.md. Nothing sensitive is stored here — no
// URL, no token, no image bytes — only identifiers, boxes and decisions.

import type { ProposedRegion, RegionReview, RegionSuggestion } from "./types";

export interface SavedBatch {
  regions: ProposedRegion[];
  suggestions: RegionSuggestion[];
  reviews: RegionReview[];
  backend: string | null;
  completenessReviewed: boolean;
}

export function savedBatchStorageKey(ownerId: string, imageId: string): string {
  if (!ownerId || !imageId) throw new Error("Falta el propietario o la imagen.");
  return `lichendr:region-suggestions:${ownerId}:${imageId}`;
}

export function parseSavedBatch(raw: string | null): SavedBatch | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedBatch> | null;
    if (!value || typeof value !== "object") return null;
    if (!Array.isArray(value.regions) || !Array.isArray(value.suggestions)) return null;
    if (!Array.isArray(value.reviews)) return null;
    return {
      regions: value.regions,
      suggestions: value.suggestions,
      reviews: value.reviews,
      backend: typeof value.backend === "string" ? value.backend : null,
      completenessReviewed: value.completenessReviewed === true,
    };
  } catch {
    return null;
  }
}

export function loadSavedBatch(ownerId: string, imageId: string): SavedBatch | null {
  if (typeof window === "undefined") return null;
  try {
    return parseSavedBatch(window.localStorage.getItem(savedBatchStorageKey(ownerId, imageId)));
  } catch {
    return null;
  }
}

export function saveBatch(ownerId: string, imageId: string, batch: SavedBatch): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(savedBatchStorageKey(ownerId, imageId), JSON.stringify(batch));
  } catch {
    // Storage full or disabled: the review still works in memory.
  }
}

// Owner-scoped local restoration of a suggestion batch.
//
// Reload must show photographs, suggestions and reviews again without
// re-running any model. This pilot deliberately adds NO database migration and
// changes no RLS policy: durable server-side persistence is an open decision
// documented in docs/BIOCLIP_PILOT.md. Nothing sensitive is stored here — no
// URL, no token, no image bytes — only identifiers, run-length encoded mask
// pixels (including the reviewer's edits) and decisions.

import type { ProposedRegion, RegionReview, RegionSuggestion } from "./types";

export interface SavedBatch {
  regions: ProposedRegion[];
  suggestions: RegionSuggestion[];
  reviews: RegionReview[];
  backend: string | null;
  completenessReviewed: boolean;
  // ROI confirmed by the reviewer, run-length encoded.
  roiRle: string | null;
}

// Scoped by owner + tree sample + view + image: state is never carried from one
// photograph, view or tree to another.
export function savedBatchStorageKey(identity: {
  ownerId: string;
  treeSampleId: string;
  direction: string;
  imageId: string;
}): string {
  const { ownerId, treeSampleId, direction, imageId } = identity;
  if (!ownerId || !treeSampleId || !direction || !imageId) {
    throw new Error("Falta el propietario, el árbol, la vista o la imagen.");
  }
  return `lichendr:region-suggestions:${ownerId}:${treeSampleId}:${direction}:${imageId}`;
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
      roiRle: typeof value.roiRle === "string" ? value.roiRle : null,
    };
  } catch {
    return null;
  }
}

export interface SavedBatchIdentity {
  ownerId: string;
  treeSampleId: string;
  direction: string;
  imageId: string;
}

export function loadSavedBatch(identity: SavedBatchIdentity): SavedBatch | null {
  if (typeof window === "undefined") return null;
  try {
    return parseSavedBatch(window.localStorage.getItem(savedBatchStorageKey(identity)));
  } catch {
    return null;
  }
}

export function saveBatch(identity: SavedBatchIdentity, batch: SavedBatch): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(savedBatchStorageKey(identity), JSON.stringify(batch));
  } catch {
    // Storage full or disabled: the review still works in memory.
  }
}

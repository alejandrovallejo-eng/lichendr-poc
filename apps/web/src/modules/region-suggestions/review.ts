// Review state of the BioCLIP suggestions: prediction and human decision are
// kept apart, and a new prediction never overwrites what a person decided.

import type {
  ProposedRegion,
  RegionReview,
  RegionSuggestion,
  ReviewDecision,
  SuggestionLabel,
  SuggestionPhase,
} from "./types";
import { SUGGESTION_LABELS } from "./types";

export interface SuggestionCacheIdentity {
  ownerId: string;
  imageId: string;
  // SHA-256 of the analysis proxy PIXEL BYTES. The manifest signature is an
  // HMAC over metadata, not an image hash, so it is not used as one.
  proxySha256: string;
  // Hash of the mask PIXELS of the whole batch: editing a mask changes it.
  maskSetSha256: string;
  encoderId: string;
  headSha256: string | null;
  backend: string;
  preprocessVersion: string;
  suggestionVersion: string;
}

// Idempotency key: owner + image/proxy/mask hashes + every model and pipeline
// version. Anything that changes the meaning of a suggestion changes the key,
// so a stale batch can never be reused silently.
export function suggestionCacheKey(identity: SuggestionCacheIdentity): string {
  const values = [
    identity.ownerId,
    identity.imageId,
    identity.proxySha256,
    identity.maskSetSha256,
    identity.encoderId,
    identity.headSha256 ?? "no-head",
    identity.backend,
    identity.preprocessVersion,
    identity.suggestionVersion,
  ];
  if (values.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error("La clave de caché de sugerencias está incompleta.");
  }
  return values.join("|");
}

export function isCachedBatchUsable(
  cached: { key: string; ownerId: string } | null,
  identity: SuggestionCacheIdentity,
): boolean {
  if (!cached) return false;
  if (cached.ownerId !== identity.ownerId) return false;
  return cached.key === suggestionCacheKey(identity);
}

export function initialReview(regionId: string, maskSha: string): RegionReview {
  return {
    regionId,
    maskSha,
    decision: "pending",
    reviewedLabel: null,
    maskEdited: false,
    reviewedAt: "",
    reviewedBy: "",
  };
}

// Merge a fresh batch of predictions with the reviews already on record.
// Decisions taken by a person survive untouched; only regions still `pending`
// pick up the new prediction.
// A decision is tied to the pixels it was taken on: it is only carried over
// when the region still has the same mask hash. If the mask changed, the region
// goes back to `pending` instead of inheriting a decision that was taken on
// different pixels.
export function mergeReviews(
  existing: readonly RegionReview[],
  incoming: readonly { regionId: string; maskSha: string }[],
): RegionReview[] {
  const byId = new Map(existing.map((review) => [review.regionId, review]));
  const merged: RegionReview[] = [];
  for (const region of incoming) {
    const previous = byId.get(region.regionId);
    if (previous && previous.maskSha === region.maskSha) {
      merged.push({ ...previous });
    } else {
      merged.push(initialReview(region.regionId, region.maskSha));
    }
    byId.delete(region.regionId);
  }
  // A region that a person already reviewed is kept even if the new batch no
  // longer proposes it: a prediction must not erase a human decision.
  for (const orphan of byId.values()) {
    if (orphan.decision !== "pending") merged.push({ ...orphan });
  }
  return merged;
}

// The reviewer edited the mask: the pixels change, so the region is re-keyed and
// the edit is only recorded when the pixels really differ from the proposal.
export function applyMaskEdit(
  reviews: readonly RegionReview[],
  regionId: string,
  nextMaskSha: string,
  proposedMaskSha: string,
): RegionReview[] {
  const index = reviews.findIndex((review) => review.regionId === regionId);
  if (index < 0) throw new Error("La región editada no existe en esta serie.");
  const next = reviews.slice();
  next[index] = {
    ...next[index],
    maskSha: nextMaskSha,
    maskEdited: nextMaskSha !== proposedMaskSha,
  };
  return next;
}

export interface DecisionInput {
  regionId: string;
  decision: ReviewDecision;
  label?: SuggestionLabel | null;
  maskEdited?: boolean;
  reviewedBy: string;
  reviewedAt: string;
}

export function applyDecision(
  reviews: readonly RegionReview[],
  input: DecisionInput,
): RegionReview[] {
  const index = reviews.findIndex((review) => review.regionId === input.regionId);
  if (index < 0) throw new Error("La región revisada no existe en esta serie.");
  if (!input.reviewedBy) throw new Error("Falta la persona que revisa.");
  if (input.decision === "accepted") {
    if (!input.label || !SUGGESTION_LABELS.includes(input.label)) {
      throw new Error("Aceptar una región exige confirmar su etiqueta.");
    }
  }
  const updated: RegionReview = {
    regionId: input.regionId,
    maskSha: reviews[index].maskSha,
    decision: input.decision,
    reviewedLabel: input.decision === "accepted" ? (input.label as SuggestionLabel) : null,
    maskEdited: input.maskEdited ?? reviews[index].maskEdited,
    reviewedAt: input.reviewedAt,
    reviewedBy: input.reviewedBy,
  };
  const next = reviews.slice();
  next[index] = updated;
  return next;
}

export interface ReviewCounts {
  pending: number;
  accepted: number;
  rejected: number;
  undetermined: number;
  acceptedLichen: number;
  maskEdited: number;
}

export function reviewCounts(reviews: readonly RegionReview[]): ReviewCounts {
  return {
    pending: reviews.filter((review) => review.decision === "pending").length,
    accepted: reviews.filter((review) => review.decision === "accepted").length,
    rejected: reviews.filter((review) => review.decision === "rejected").length,
    undetermined: reviews.filter((review) => review.decision === "undetermined").length,
    acceptedLichen: reviews.filter(
      (review) => review.decision === "accepted" && review.reviewedLabel === "lichen",
    ).length,
    maskEdited: reviews.filter((review) => review.maskEdited).length,
  };
}

// Only regions a person accepted as lichen ever reach the coverage formula.
// Pending, rejected and undetermined regions are excluded.
export function acceptedLichenRegionIds(reviews: readonly RegionReview[]): string[] {
  return reviews
    .filter((review) => review.decision === "accepted" && review.reviewedLabel === "lichen")
    .map((review) => review.regionId);
}

// --- Context guards ---------------------------------------------------------

export interface SuggestionContext {
  // Monotonic run counter. The CURRENT generation is read from a ref after each
  // await; comparing a captured snapshot with its own echo would always match
  // and would let a stale run overwrite the active one.
  generation: number;
  ownerId: string;
  treeSampleId: string;
  direction: string;
  imageId: string;
  requestToken: string;
  // Hash of the exact mask set the request was built from.
  maskSetSha: string;
  suggestionVersion: string;
}

// Called after every await, against the generation that is live at that moment:
// a late response must never be applied to another tree, another view, another
// mask set or a superseded run.
export function resultBelongsToContext(
  current: SuggestionContext,
  received: SuggestionContext,
): boolean {
  return (
    current.generation === received.generation
    && current.ownerId === received.ownerId
    && current.treeSampleId === received.treeSampleId
    && current.direction === received.direction
    && current.imageId === received.imageId
    && current.requestToken === received.requestToken
    && current.maskSetSha === received.maskSetSha
    && current.suggestionVersion === received.suggestionVersion
  );
}

// Identity of the series/view a panel is bound to. When it changes, the panel
// state is cleared instead of being carried over to another photograph.
export interface ViewIdentity {
  ownerId: string;
  treeSampleId: string;
  direction: string;
  imageId: string;
}

export function sameViewIdentity(left: ViewIdentity, right: ViewIdentity): boolean {
  return (
    left.ownerId === right.ownerId
    && left.treeSampleId === right.treeSampleId
    && left.direction === right.direction
    && left.imageId === right.imageId
  );
}

// --- Phases -----------------------------------------------------------------

export type SuggestionEvent =
  | { type: "start" }
  | { type: "regions_found"; count: number }
  | { type: "labels_ready" }
  | { type: "worker_failed" }
  | { type: "reset" };

// The worker never "succeeds quietly": a failure moves to `unavailable`, which
// keeps the regions already found and allows manual annotation.
export function nextPhase(current: SuggestionPhase, event: SuggestionEvent): SuggestionPhase {
  if (event.type === "reset") return "idle";
  if (event.type === "worker_failed") return "unavailable";
  switch (current) {
    case "idle":
    case "unavailable":
      return event.type === "start" ? "searching_regions" : current;
    case "searching_regions":
      if (event.type === "regions_found") return event.count > 0 ? "suggesting_labels" : "review";
      return current;
    case "suggesting_labels":
      return event.type === "labels_ready" ? "review" : current;
    default:
      return current;
  }
}

export interface PhaseNotice {
  phase: SuggestionPhase;
  title: string;
  detail: string;
  // True when the reviewer can still annotate by hand.
  manualAnnotationAvailable: boolean;
}

export function phaseNotice(
  phase: SuggestionPhase,
  regionsFound: number,
  failureReason?: string,
): PhaseNotice {
  switch (phase) {
    case "searching_regions":
      return {
        phase,
        title: "Buscando regiones",
        detail: "MobileSAM está proponiendo regiones en esta vista.",
        manualAnnotationAvailable: true,
      };
    case "suggesting_labels":
      return {
        phase,
        title: "Sugiriendo etiquetas",
        detail: `BioCLIP está sugiriendo etiquetas para ${regionsFound} regiones propuestas.`,
        manualAnnotationAvailable: true,
      };
    case "review":
      return {
        phase,
        title: "Revisar",
        detail:
          regionsFound > 0
            ? "Revisa cada región: acepta, excluye, cambia la etiqueta o edita la máscara. Nada se cuenta sin tu revisión."
            : "No se propusieron regiones. Que no haya propuestas no demuestra ausencia de líquenes: revisa la vista y añade máscaras si faltan.",
        manualAnnotationAvailable: true,
      };
    case "unavailable":
      return {
        phase,
        title: "Asistencia no disponible",
        detail:
          (failureReason ? `${failureReason} ` : "")
          + "Las fotografías, las regiones ya encontradas y tus revisiones se conservan. Puedes anotar manualmente y reintentar más tarde.",
        manualAnnotationAvailable: true,
      };
    default:
      return {
        phase: "idle",
        title: "Sin iniciar",
        detail: "La asistencia de regiones no se ha ejecutado en esta vista.",
        manualAnnotationAvailable: true,
      };
  }
}

// Restoring a saved series must show photographs, suggestions and reviews again
// without re-running any model.
export function restoreState(saved: {
  regions: readonly ProposedRegion[];
  suggestions: readonly RegionSuggestion[];
  reviews: readonly RegionReview[];
}): {
  phase: SuggestionPhase;
  regions: ProposedRegion[];
  suggestions: RegionSuggestion[];
  reviews: RegionReview[];
  reanalysisRequired: boolean;
} {
  // Restoration keeps the edited geometry: reviews are re-anchored on the mask
  // hashes actually stored, not on the ids alone.
  const reviews = mergeReviews(saved.reviews, saved.regions);
  return {
    phase: saved.regions.length > 0 || saved.suggestions.length > 0 ? "review" : "idle",
    regions: saved.regions.map((region) => ({ ...region })),
    suggestions: saved.suggestions.map((suggestion) => ({ ...suggestion })),
    reviews,
    reanalysisRequired: false,
  };
}

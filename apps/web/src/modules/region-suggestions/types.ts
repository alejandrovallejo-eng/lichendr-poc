// Shared types of the reviewable BioCLIP + MobileSAM pilot.
//
// A suggestion is never a conclusion: MobileSAM proposes a region, BioCLIP
// suggests one of three labels, and a human accepts, excludes or relabels it
// before anything is counted. Classifying a photograph is not segmenting it,
// not identifying a species and not estimating air quality.

// Canonical English labels sent to the encoder. The head's internal identifier
// for bark is `bark`; `bare tree bark` is only the prompt text.
export const SUGGESTION_LABELS = ["lichen", "moss", "bare tree bark"] as const;
export type SuggestionLabel = (typeof SUGGESTION_LABELS)[number];

export const SUGGESTION_LABEL_ES: Record<SuggestionLabel, string> = {
  lichen: "liquen",
  moss: "musgo",
  "bare tree bark": "corteza desnuda",
};

// A region always starts as `pending`. Only a person moves it away from there.
export type ReviewDecision = "pending" | "accepted" | "rejected" | "undetermined";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Every geometric step between the untouched original and the crop that the
// encoder saw, so a suggestion can always be traced back.
export type TransformStep =
  // EXIF orientation is applied ONCE upstream (analysis proxy `.rotate()` and
  // the vision service `exif_transpose`); the pilot never rotates again.
  | { step: "exif_orientation"; appliedUpstream: boolean }
  | {
      step: "working_grid";
      width: number;
      height: number;
      originalWidth: number;
      originalHeight: number;
    }
  | { step: "rectification"; applied: boolean }
  | { step: "mask_bounding_box"; box: Box }
  // Crop actually cut by the server, in normalised coordinates so the overlay
  // can draw exactly what BioCLIP saw.
  | { step: "server_crop"; boxNormalized: Box }
  | { step: "context_expansion"; box: Box; marginRatio: number }
  | { step: "crop_downscale"; scale: number }
  | { step: "encoder_preprocess"; mode: string; centerCrop: boolean };

export interface LabelRawScore {
  label: SuggestionLabel;
  labelEs: string;
  // Raw score. NOT a probability and NOT calibrated: never thresholded.
  rawScore: number;
}

export interface ProposedRegion {
  regionId: string;
  // REAL mask pixels proposed by MobileSAM, run-length encoded so they survive
  // state updates and a reload. A region is never reduced to its box.
  maskWidth: number;
  maskHeight: number;
  maskRle: string;
  // Content hash of the mask pixels: it changes as soon as the reviewer edits
  // the mask, which invalidates any cached suggestion for that region.
  maskSha: string;
  maskAreaPixels: number;
  // Tight bounding box of the mask on the working grid.
  box: Box;
  // Crop the server actually cut, normalised; null until the server answers.
  cropBoxNormalized: Box | null;
  // MobileSAM's own score: mask quality, not evidence of lichen.
  samScore: number;
  transformChain: TransformStep[];
}

export interface RegionSuggestion {
  regionId: string;
  ranking: LabelRawScore[];
  backend: "zeroshot" | "ridge_head";
  encoderId: string;
  headSha256: string | null;
  preprocess: string;
  versions: Record<string, string>;
}

// What a human decided. Never overwritten by a later prediction.
export interface RegionReview {
  regionId: string;
  // Mask hash the decision was taken on: a decision is only preserved while the
  // pixels it was taken on are still the same.
  maskSha: string;
  decision: ReviewDecision;
  // The label the person confirmed; null while pending or when excluded.
  reviewedLabel: SuggestionLabel | null;
  // True only when the edited pixels actually differ from the proposal.
  maskEdited: boolean;
  reviewedAt: string;
  reviewedBy: string;
}

export type SuggestionPhase =
  | "idle"
  | "searching_regions"
  | "suggesting_labels"
  | "review"
  | "unavailable";

export const SUGGESTION_PHASE_ES: Record<SuggestionPhase, string> = {
  idle: "Sin iniciar",
  searching_regions: "Buscando regiones",
  suggesting_labels: "Sugiriendo etiquetas",
  review: "Revisar",
  unavailable: "Asistencia no disponible",
};

// Traceability envelope stored with every batch of suggestions.
export interface SuggestionProvenance {
  ownerId: string;
  treeSampleId: string;
  direction: string;
  imageId: string;
  // SHA-256 of the analysis proxy pixel bytes (the manifest signature is an
  // HMAC over metadata and is reported separately, never as an image hash).
  proxySha256: string;
  proxyManifestSignature: string;
  maskSetSha256: string;
  encoderId: string;
  headSha256: string | null;
  backend: string;
  preprocessVersion: string;
  suggestionVersion: string;
}

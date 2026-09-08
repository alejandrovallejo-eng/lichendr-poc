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
  | { step: "exif_orientation"; orientation: number }
  | { step: "analysis_proxy"; scale: number; width: number; height: number }
  | { step: "rectification"; applied: boolean; canonicalWidth: number; canonicalHeight: number }
  | { step: "mask_bounding_box"; box: Box }
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
  // Mask in the coordinate space described by `transformChain`.
  maskWidth: number;
  maskHeight: number;
  maskAreaPixels: number;
  box: Box;
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
  decision: ReviewDecision;
  // The label the person confirmed; null while pending or when excluded.
  reviewedLabel: SuggestionLabel | null;
  // True when the person edited the proposed mask.
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
  imageSha256: string;
  proxySha256: string;
  maskSetSha256: string;
  encoderId: string;
  headSha256: string | null;
  backend: string;
  preprocessVersion: string;
  suggestionVersion: string;
}

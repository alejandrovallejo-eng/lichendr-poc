export const DIRECTIONS = ["N", "E", "S", "W"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_LABELS: Record<Direction, string> = {
  N: "Norte",
  E: "Este",
  S: "Sur",
  W: "Oeste",
};

export type FrameClassification =
  | "validated"
  | "assisted"
  | "manual_assisted"
  | "manual_confirmed"
  | "manual_assisted_provisional";
export type VisionViewStatus =
  | "needs_confirmation"
  | "rectification_review"
  | "repeat_photo"
  | "provisional_ai";

export interface CornerPoint {
  x: number;
  y: number;
}

export interface FrameDetectionDetails {
  classification: FrameClassification | null;
  method: string;
  confidence: number;
  detected_marker_ids: number[];
  missing_marker_ids: number[];
  rejected_candidate_count: number;
  successful_resolution: { width: number; height: number } | null;
  successful_variant: string | null;
  reprojection_error_px: number | null;
  rejection_reason: string | null;
  proposal_source: string | null;
  assisted_eligible: boolean;
  user_confirmed: boolean;
  source_width: number;
  source_height: number;
}

export interface VisionMetrics {
  valid_area_cm2: number;
  lichen_union_area_cm2: number;
  lichen_coverage_percent: number;
  component_count: number;
  occupied_cells: number;
  provisional_morphotype_richness: number;
  morphotype_coverage: Record<string, number>;
  quality_score: number;
  quality_flags: string[];
  candidates: Array<{
    classification: string;
    morphotype: string | null;
    confidence: number;
    area_pixels: number;
  }>;
  lichen_union_mask_data_url: string;
}

export interface VisionViewResult {
  template_version: string;
  algorithm_version: string;
  canonical_width: number;
  canonical_height: number;
  pixels_per_cm: number;
  reprojection_error_px: number | null;
  quality_flags: string[];
  quality_score: number;
  critical_errors: string[];
  status: VisionViewStatus;
  rectified_image_data_url: string | null;
  model_name: string;
  source: string;
  metrics: VisionMetrics | null;
  frame_detection: FrameDetectionDetails;
  corner_proposal: CornerPoint[] | null;
  source_width: number;
  source_height: number;
}

export interface TreeMetricSummary {
  totalValidAreaCm2: number;
  totalLichenAreaCm2: number;
  coveragePercent: number | null;
  occupiedCells: number;
  morphotypeRichness: number;
  validViews: number;
  validatedViews: number;
  provisionalViews: number;
  isProvisional: boolean;
  pendingViews: number;
}

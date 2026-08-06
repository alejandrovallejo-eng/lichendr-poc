export const DIRECTIONS = ["N", "E", "S", "W"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_LABELS: Record<Direction, string> = {
  N: "Norte",
  E: "Este",
  S: "Sur",
  W: "Oeste",
};

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
  reprojection_error_px: number;
  quality_flags: string[];
  quality_score: number;
  critical_errors: string[];
  status: "repeat_photo" | "provisional_ai";
  rectified_image_data_url: string;
  model_name: string;
  source: string;
  metrics: VisionMetrics | null;
}

export interface TreeMetricSummary {
  totalValidAreaCm2: number;
  totalLichenAreaCm2: number;
  coveragePercent: number | null;
  occupiedCells: number;
  morphotypeRichness: number;
  validViews: number;
  pendingViews: number;
}

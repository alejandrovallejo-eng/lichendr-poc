import type {
  CalibrationSummary,
  CombinedTrunkEstimate,
  Direction,
  TrunkViewEstimate,
  VisionViewResult,
} from "./types";

const DIRECTIONS: Direction[] = ["N", "E", "S", "W"];

export function summarizeCalibration(
  results: readonly (VisionViewResult | null)[],
): CalibrationSummary {
  const valid = results.filter((result): result is VisionViewResult => (
    result?.rectified_image_data_url != null
    && result.canonical_width > 0
    && result.canonical_height > 0
    && result.pixels_per_cm > 0
    && result.critical_errors.length === 0
  ));
  const provisionalViews = valid.filter((result) => (
    result.frame_detection.classification === "manual_assisted_provisional"
    || result.quality_flags.includes("manual_estimated_geometry")
  )).length;
  return {
    validViews: valid.length,
    pendingViews: 4 - valid.length,
    totalCalibratedAreaCm2: valid.length * 500,
    provisionalViews,
    calibrated: valid.length === 4,
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ellipseCircumference(a: number, b: number): number {
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h)));
}

export function combineTrunkEstimates(
  estimates: Partial<Record<Direction, TrunkViewEstimate | null>>,
): CombinedTrunkEstimate | null {
  const usable = DIRECTIONS.flatMap((direction) => {
    const estimate = estimates[direction];
    return estimate && estimate.width_cm > 0 ? [{ direction, estimate }] : [];
  });
  if (usable.length === 0) return null;

  const medianWidth = [...usable].sort((left, right) => left.estimate.width_cm - right.estimate.width_cm)[
    Math.floor(usable.length / 2)
  ].estimate.width_cm;
  const retained = usable.filter(({ estimate }) => (
    estimate.width_cm >= medianWidth * 0.55 && estimate.width_cm <= medianWidth * 1.8
  ));
  const selected = retained.length > 0 ? retained : usable;
  const axis = (pair: Direction[]) => {
    const values = selected
      .filter(({ direction }) => pair.includes(direction))
      .map(({ estimate }) => estimate.width_cm);
    return values.length ? average(values) : null;
  };
  const northSouth = axis(["N", "S"]);
  const eastWest = axis(["E", "W"]);
  const widthCm = average(selected.map(({ estimate }) => estimate.width_cm));
  const elliptical = northSouth !== null && eastWest !== null;
  const circumferenceCm = elliptical
    ? ellipseCircumference(northSouth / 2, eastWest / 2)
    : Math.PI * widthCm;
  const uncertaintyFactor = selected.length >= 4 ? 0.12 : selected.length >= 2 ? 0.22 : 0.35;
  const reportedMin = Math.min(...selected.map(({ estimate }) => estimate.min_cm));
  const reportedMax = Math.max(...selected.map(({ estimate }) => estimate.max_cm));
  const confidence: CombinedTrunkEstimate["confidence"] = selected.length >= 4
    && selected.every(({ estimate }) => estimate.confidence !== "low")
    ? "high"
    : selected.length >= 2 ? "medium" : "low";
  return {
    widthCm,
    circumferenceCm,
    minCm: Math.min(reportedMin * Math.PI, circumferenceCm * (1 - uncertaintyFactor)),
    maxCm: Math.max(reportedMax * Math.PI, circumferenceCm * (1 + uncertaintyFactor)),
    confidence,
    viewsUsed: selected.map(({ direction }) => direction),
    geometricAssumption: elliptical ? "elliptical" : "circular",
    qualityFlags: [
      ...new Set([
        ...selected.flatMap(({ estimate }) => estimate.quality_flags),
        ...(selected.length !== usable.length ? ["trunk_width_outlier_downweighted"] : []),
        ...(selected.length < 4 ? ["limited_view_count"] : []),
      ]),
    ],
  };
}

export function fieldTapeDiameter(circumferenceCm: number | null): number | null {
  return circumferenceCm !== null && circumferenceCm > 0
    ? circumferenceCm / Math.PI
    : null;
}

export function correctTrunkEdges(
  estimate: TrunkViewEstimate,
  sourceWidth: number,
  leftXNormalized: number,
  rightXNormalized: number,
): TrunkViewEstimate {
  if (
    !Number.isFinite(sourceWidth)
    || sourceWidth <= 1
    || !Number.isFinite(leftXNormalized)
    || !Number.isFinite(rightXNormalized)
    || leftXNormalized < 0
    || rightXNormalized > 1
    || leftXNormalized >= rightXNormalized
  ) {
    throw new Error("Los bordes del tronco no son válidos.");
  }
  const widthCm = (rightXNormalized - leftXNormalized) * sourceWidth * estimate.scale_cm_per_pixel;
  return {
    ...estimate,
    width_cm: widthCm,
    min_cm: widthCm * 0.78,
    max_cm: widthCm * 1.22,
    left_x_normalized: leftXNormalized,
    right_x_normalized: rightXNormalized,
    method: "manual_corrected",
    confidence: estimate.confidence === "low" ? "medium" : estimate.confidence,
    quality_flags: [...new Set([...estimate.quality_flags, "trunk_edges_user_confirmed"])],
  };
}

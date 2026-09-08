// Reviewed coverage: the only percentage this pilot may produce.
//
//   cobertura revisada = 100 * área( unión de máscaras ACEPTADAS como liquen
//                                    ∩ ROI válido )
//                            / área( ROI válido )
//
// The union removes double counting, the result is clamped to 0–100 by
// construction, and a ROI with zero area yields "resultado no disponible"
// instead of a number. Pending, rejected and undetermined regions never enter
// the numerator.
//
// Without calibration this percentage is exploratory only: it is not cm², it is
// not air quality, and it must not be compared scientifically between trees. It
// is excluded from scientific aggregates and it does not touch any existing
// environmental formula or index.

export interface ReviewedCoverageInput {
  // Binary masks (0/1) of the regions a human accepted as lichen.
  acceptedLichenMasks: readonly Uint8Array[];
  // Binary mask of the valid ROI (for example the confirmed trunk or the
  // calibrated frame area).
  roiMask: Uint8Array;
  width: number;
  height: number;
  // The reviewer confirmed they inspected the whole ROI for missing regions.
  completenessReviewed: boolean;
  // How the ROI itself was produced, kept for provenance.
  roiSource: string;
  // True when the pilot has no physical calibration, which is the current state.
  calibrated?: boolean;
}

export type CoverageUnavailableReason =
  | "roi_zero_area"
  | "mask_dimension_mismatch"
  | "completeness_not_reviewed";

export interface ReviewedCoverageResult {
  available: boolean;
  unavailableReason: CoverageUnavailableReason | null;
  coveragePercent: number | null;
  acceptedUnionPixels: number;
  intersectionPixels: number;
  roiPixels: number;
  acceptedRegionCount: number;
  // Always true while there is no calibration: exploratory, never scientific.
  exploratory: boolean;
  excludedFromScientificAggregates: boolean;
  completenessReviewed: boolean;
  roiSource: string;
  notice: string;
}

const EXPLORATORY_NOTICE =
  "Porcentaje exploratorio de cobertura revisada. Sin calibración no equivale a cm², "
  + "no indica calidad del aire y no permite comparar árboles científicamente.";

export function reviewedCoverage(input: ReviewedCoverageInput): ReviewedCoverageResult {
  const { width, height } = input;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Las dimensiones del ROI no son válidas.");
  }
  const expectedLength = width * height;
  const base: Omit<
    ReviewedCoverageResult,
    "available" | "unavailableReason" | "coveragePercent"
  > = {
    acceptedUnionPixels: 0,
    intersectionPixels: 0,
    roiPixels: 0,
    acceptedRegionCount: input.acceptedLichenMasks.length,
    exploratory: input.calibrated !== true,
    excludedFromScientificAggregates: true,
    completenessReviewed: input.completenessReviewed,
    roiSource: input.roiSource,
    notice: EXPLORATORY_NOTICE,
  };

  if (
    input.roiMask.length !== expectedLength
    || input.acceptedLichenMasks.some((mask) => mask.length !== expectedLength)
  ) {
    return {
      ...base,
      available: false,
      unavailableReason: "mask_dimension_mismatch",
      coveragePercent: null,
    };
  }

  let roiPixels = 0;
  for (let index = 0; index < input.roiMask.length; index += 1) {
    if (input.roiMask[index] !== 0) roiPixels += 1;
  }
  if (roiPixels === 0) {
    return {
      ...base,
      available: false,
      unavailableReason: "roi_zero_area",
      coveragePercent: null,
      roiPixels: 0,
    };
  }

  // Union first, then intersect: overlapping accepted regions are counted once.
  const union = new Uint8Array(expectedLength);
  for (const mask of input.acceptedLichenMasks) {
    for (let index = 0; index < expectedLength; index += 1) {
      if (mask[index] !== 0) union[index] = 1;
    }
  }
  let unionPixels = 0;
  let intersectionPixels = 0;
  for (let index = 0; index < expectedLength; index += 1) {
    if (union[index] === 0) continue;
    unionPixels += 1;
    if (input.roiMask[index] !== 0) intersectionPixels += 1;
  }

  if (!input.completenessReviewed) {
    return {
      ...base,
      available: false,
      unavailableReason: "completeness_not_reviewed",
      coveragePercent: null,
      acceptedUnionPixels: unionPixels,
      intersectionPixels,
      roiPixels,
    };
  }

  return {
    ...base,
    available: true,
    unavailableReason: null,
    coveragePercent: (100 * intersectionPixels) / roiPixels,
    acceptedUnionPixels: unionPixels,
    intersectionPixels,
    roiPixels,
  };
}

// A view can only be finalised once the reviewer confirmed that the whole ROI
// was inspected and no region is still pending. Absence of proposals is not
// proof of absence of lichen, so missing masks may be added first.
export function canFinalizeReview(input: {
  pendingCount: number;
  completenessReviewed: boolean;
}): { canFinalize: boolean; reason: string | null } {
  if (input.pendingCount > 0) {
    return {
      canFinalize: false,
      reason: `Quedan ${input.pendingCount} regiones sin revisar.`,
    };
  }
  if (!input.completenessReviewed) {
    return {
      canFinalize: false,
      reason:
        "Confirma que revisaste todo el ROI y que añadiste las máscaras omitidas. "
        + "Que no se propusieran regiones no demuestra ausencia de líquenes.",
    };
  }
  return { canFinalize: true, reason: null };
}

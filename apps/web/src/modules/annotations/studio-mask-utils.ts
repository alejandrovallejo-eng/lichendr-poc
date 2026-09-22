export interface CoverageSummary {
  evaluableArea: number;
  lichenArea: number;
  overlapPixels: number;
  coveragePercent: number | null;
}

export type AnnotationQualityFlag =
  | "missing_trunk"
  | "zero_trunk_area"
  | "mask_dimension_mismatch"
  | "lichen_outside_trunk"
  | "high_lichen_overlap"
  | "no_lichen_regions"
  | "summary_pending"
  | "signed_mask_unavailable";

export interface AnnotationMetricSummary {
  trunkAreaPixels: number | null;
  lichenUnionInsideTrunkPixels: number | null;
  lichenOutsideTrunkPixels: number | null;
  overlappingLichenPixels: number | null;
  coveragePercent: number | null;
  qualityFlags: AnnotationQualityFlag[];
}

export interface MaskBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function assertSameLength(left: Uint8Array, right: Uint8Array): void {
  if (left.length !== right.length) {
    throw new Error("Las máscaras deben tener las mismas dimensiones.");
  }
}

export function calculateMaskArea(mask: Uint8Array): number {
  let area = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 0) area += 1;
  }
  return area;
}

export function unionMasks(masks: readonly Uint8Array[], length?: number): Uint8Array {
  const outputLength = length ?? masks[0]?.length ?? 0;
  const union = new Uint8Array(outputLength);
  for (const mask of masks) {
    if (mask.length !== outputLength) {
      throw new Error("Las máscaras deben tener las mismas dimensiones.");
    }
    for (let index = 0; index < outputLength; index += 1) {
      if (mask[index] !== 0) union[index] = 1;
    }
  }
  return union;
}

export function intersectMasks(left: Uint8Array, right: Uint8Array): Uint8Array {
  assertSameLength(left, right);
  const intersection = new Uint8Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== 0 && right[index] !== 0) intersection[index] = 1;
  }
  return intersection;
}

export function clipMask(mask: Uint8Array, boundary: Uint8Array): Uint8Array {
  return intersectMasks(mask, boundary);
}

export function calculateMaskBounds(mask: Uint8Array, width: number, height: number): MaskBounds | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Las dimensiones de la imagen no son válidas.");
  }
  if (mask.length !== width * height) throw new Error("La máscara no coincide con las dimensiones de la imagen.");
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function calculateCoverage(trunk: Uint8Array | null, lichenMasks: readonly Uint8Array[]): CoverageSummary {
  if (!trunk) {
    return { evaluableArea: 0, lichenArea: 0, overlapPixels: 0, coveragePercent: null };
  }
  const evaluableArea = calculateMaskArea(trunk);
  if (evaluableArea === 0) {
    return { evaluableArea: 0, lichenArea: 0, overlapPixels: 0, coveragePercent: null };
  }

  const clipped = lichenMasks.map((mask) => clipMask(mask, trunk));
  const summedArea = clipped.reduce((sum, mask) => sum + calculateMaskArea(mask), 0);
  const lichenUnion = unionMasks(clipped, trunk.length);
  const lichenArea = calculateMaskArea(lichenUnion);

  return {
    evaluableArea,
    lichenArea,
    overlapPixels: Math.max(0, summedArea - lichenArea),
    coveragePercent: (lichenArea / evaluableArea) * 100,
  };
}

export function calculateAnnotationMetricSummary(
  trunk: Uint8Array | null,
  lichenMasks: readonly Uint8Array[],
): AnnotationMetricSummary {
  const qualityFlags: AnnotationQualityFlag[] = [];
  if (lichenMasks.length === 0) qualityFlags.push("no_lichen_regions");
  if (!trunk) {
    qualityFlags.push("missing_trunk");
    return {
      trunkAreaPixels: null,
      lichenUnionInsideTrunkPixels: null,
      lichenOutsideTrunkPixels: null,
      overlappingLichenPixels: null,
      coveragePercent: null,
      qualityFlags,
    };
  }

  const trunkAreaPixels = calculateMaskArea(trunk);
  if (lichenMasks.some((mask) => mask.length !== trunk.length)) {
    qualityFlags.push("mask_dimension_mismatch");
    return {
      trunkAreaPixels,
      lichenUnionInsideTrunkPixels: null,
      lichenOutsideTrunkPixels: null,
      overlappingLichenPixels: null,
      coveragePercent: null,
      qualityFlags,
    };
  }

  const lichenUnion = unionMasks(lichenMasks, trunk.length);
  const lichenUnionArea = calculateMaskArea(lichenUnion);
  const lichenUnionInsideTrunkPixels = calculateMaskArea(intersectMasks(lichenUnion, trunk));
  const lichenOutsideTrunkPixels = lichenUnionArea - lichenUnionInsideTrunkPixels;
  const summedLichenAreaInsideTrunk = lichenMasks.reduce(
    (sum, mask) => sum + calculateMaskArea(intersectMasks(mask, trunk)),
    0,
  );
  const overlappingLichenPixels = Math.max(
    0,
    summedLichenAreaInsideTrunk - lichenUnionInsideTrunkPixels,
  );

  if (trunkAreaPixels === 0) qualityFlags.push("zero_trunk_area");
  if (lichenOutsideTrunkPixels > 0) qualityFlags.push("lichen_outside_trunk");
  if (
    summedLichenAreaInsideTrunk > 0
    && overlappingLichenPixels / summedLichenAreaInsideTrunk >= 0.2
  ) {
    qualityFlags.push("high_lichen_overlap");
  }

  return {
    trunkAreaPixels,
    lichenUnionInsideTrunkPixels,
    lichenOutsideTrunkPixels,
    overlappingLichenPixels,
    coveragePercent: trunkAreaPixels > 0
      ? lichenUnionInsideTrunkPixels / trunkAreaPixels * 100
      : null,
    qualityFlags,
  };
}

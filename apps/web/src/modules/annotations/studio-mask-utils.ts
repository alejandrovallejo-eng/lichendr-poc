export interface CoverageSummary {
  evaluableArea: number;
  lichenArea: number;
  overlapPixels: number;
  coveragePercent: number | null;
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

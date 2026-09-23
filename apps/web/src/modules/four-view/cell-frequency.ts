import { decodeMaskRle, encodeMaskRle } from "../region-suggestions/mask-codec";

export const CELL_FREQUENCY_METHOD = "cell-frequency-v2";
export const FRAME_WIDTH_CM = 10;
export const FRAME_HEIGHT_CM = 50;
export const FRAME_CELL_COUNT = 5;

export type CellDecision = "proposed" | "observed" | "not_observed" | "not_evaluated";
export type CellDecisions = Record<string, Record<string, CellDecision>>;
export type FramePoint = { x: number; y: number };
export type FrameQuad = [FramePoint, FramePoint, FramePoint, FramePoint];

export interface VerifiedCalibration {
  pixelsPerCm: number;
  method: "automatic" | "manual_confirmed" | "legacy_four_view";
  width: number;
  height: number;
  imageId: string;
  proxyPath: string;
  transformationId: string;
  sourceCorners: FrameQuad;
}

export interface StandardizedCellReview {
  method: typeof CELL_FREQUENCY_METHOD;
  frame: { corners: FrameQuad; widthCm: 10; heightCm: 50 };
  frameConfirmed: boolean;
  calibration: VerifiedCalibration;
  maskWidth: number;
  maskHeight: number;
  masksByMorph: Record<string, string>;
  decisions: CellDecisions;
  reviewedAt: string | null;
  sourceFingerprint: string;
}

export function isVerifiedCalibration(value: unknown): value is VerifiedCalibration {
  const calibration = value as Partial<VerifiedCalibration> | null;
  const pixelsPerCm = calibration?.pixelsPerCm;
  const width = calibration?.width;
  const height = calibration?.height;
  const method = calibration?.method;
  return Boolean(calibration
    && typeof pixelsPerCm === "number" && Number.isFinite(pixelsPerCm) && pixelsPerCm > 0
    && typeof width === "number" && Number.isSafeInteger(width) && width > 0
    && typeof height === "number" && Number.isSafeInteger(height) && height > 0
    && typeof calibration.imageId === "string" && calibration.imageId.length > 0
    && typeof calibration.proxyPath === "string" && calibration.proxyPath.length > 0
    && typeof calibration.transformationId === "string" && calibration.transformationId.length > 0
    && Array.isArray(calibration.sourceCorners) && calibration.sourceCorners.length === 4
    && calibration.sourceCorners.every(point => point && typeof point.x === "number" && typeof point.y === "number"
      && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)
    && typeof method === "string" && ["automatic", "manual_confirmed", "legacy_four_view"].includes(method));
}

function homography(frame: FrameQuad): [number, number, number, number, number, number, number, number] | null {
  const matrix: number[][] = [], values: number[] = [];
  frame.forEach((point, index) => {
    const u = index === 0 || index === 3 ? 0 : 1, v = index < 2 ? 0 : 1;
    matrix.push([u, v, 1, 0, 0, 0, -u * point.x, -v * point.x]); values.push(point.x);
    matrix.push([0, 0, 0, u, v, 1, -u * point.y, -v * point.y]); values.push(point.y);
  });
  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 8; row += 1)
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    if (Math.abs(matrix[pivot][column]) < 1e-10) return null;
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    [values[column], values[pivot]] = [values[pivot], values[column]];
    const divisor = matrix[column][column];
    for (let j = column; j < 8; j += 1) matrix[column][j] /= divisor;
    values[column] /= divisor;
    for (let row = 0; row < 8; row += 1) if (row !== column) {
      const factor = matrix[row][column];
      for (let j = column; j < 8; j += 1) matrix[row][j] -= factor * matrix[column][j];
      values[row] -= factor * values[column];
    }
  }
  return values as [number, number, number, number, number, number, number, number];
}

function project(transform: ReturnType<typeof homography>, u: number, v: number): FramePoint {
  if (!transform) return { x: NaN, y: NaN };
  const [a, b, c, d, e, f, g, h] = transform, denominator = g * u + h * v + 1;
  return { x: (a * u + b * v + c) / denominator, y: (d * u + e * v + f) / denominator };
}

function inverseBilinear(frame: FrameQuad, point: FramePoint): { u: number; v: number } | null {
  const transform = homography(frame);
  if (!transform) return null;
  let u = .5, v = .5;
  for (let i = 0; i < 12; i += 1) {
    const p = project(transform, u, v), eX = p.x - point.x, eY = p.y - point.y;
    const du = { x: (project(transform, u + .001, v).x - p.x) / .001, y: (project(transform, u + .001, v).y - p.y) / .001 };
    const dv = { x: (project(transform, u, v + .001).x - p.x) / .001, y: (project(transform, u, v + .001).y - p.y) / .001 };
    const det = du.x * dv.y - du.y * dv.x;
    if (Math.abs(det) < 1e-8) return null;
    u -= (eX * dv.y - eY * dv.x) / det;
    v -= (du.x * eY - du.y * eX) / det;
  }

  return u >= -1e-6 && u <= 1 + 1e-6 && v >= -1e-6 && v <= 1 + 1e-6 ? { u, v } : null;
}

export function projectSourcePointToRectified(frame: FrameQuad, point: FramePoint): FramePoint | null {
  const projected = inverseBilinear(frame, point);
  return projected ? { x: projected.u, y: projected.v } : null;
}

export function frameCellPolygons(frame: FrameQuad) {
  const transform = homography(frame);
  return Array.from({ length: FRAME_CELL_COUNT }, (_, index) => {
    const top = index / FRAME_CELL_COUNT, bottom = (index + 1) / FRAME_CELL_COUNT;
    return [project(transform, 0, top), project(transform, 1, top), project(transform, 1, bottom), project(transform, 0, bottom)];
  });
}

export function verticalFrameCells(frame: StandardizedCellReview["frame"], width: number, height: number) {
  return frameCellPolygons(frame.corners).map((corners, index) => ({ index, corners,
    pixel: { left: 0, top: 0, right: width, bottom: height } }));
}

export function occupiedCellsFromMask(mask: Uint8Array, width: number, height: number, frame: StandardizedCellReview["frame"]) {
  if (mask.length !== width * height) throw new Error("La máscara no coincide con la vista.");
  const occupied = new Set<number>();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!mask[y * width + x]) continue;
    const uv = inverseBilinear(frame.corners, { x: (x + .5) / width, y: (y + .5) / height });
    if (uv) occupied.add(Math.min(FRAME_CELL_COUNT - 1, Math.floor(uv.v * FRAME_CELL_COUNT)));
  }
  return [...occupied].sort((a, b) => a - b);
}

export function proposeCellDecisions(review: Pick<StandardizedCellReview, "masksByMorph" | "maskWidth" | "maskHeight" | "frame"> & { morphIds?: string[] }): CellDecisions {
  const decisions: CellDecisions = {};
  for (const morphId of review.morphIds ?? Object.keys(review.masksByMorph)) {
    decisions[morphId] = Object.fromEntries(Array.from({ length: FRAME_CELL_COUNT }, (_, index) => [String(index), "not_evaluated"]));
  }
  for (const [morphId, encoded] of Object.entries(review.masksByMorph)) {
    const decoded = decodeMaskRle(encoded);
    if (decoded.width !== review.maskWidth || decoded.height !== review.maskHeight) {
      throw new Error("La máscara aceptada no coincide con la fotografía.");
    }
    decisions[morphId] ??= Object.fromEntries(Array.from({ length: FRAME_CELL_COUNT }, (_, index) => [String(index), "not_evaluated"]));
    for (const index of occupiedCellsFromMask(decoded.mask, decoded.width, decoded.height, review.frame)) {
      decisions[morphId][String(index)] = "proposed";
    }
  }
  return decisions;
}

export function confirmedFrequency(decisions: CellDecisions, requiredViews = 1, morphIds?: string[]) {
  const ids = morphIds ?? Object.keys(decisions);
  if (!ids.length || ids.some(id => {
    const cells = decisions[id];
    return !cells || Array.from({ length: FRAME_CELL_COUNT }, (_, index) => cells[String(index)])
      .some(state => state !== "observed" && state !== "not_observed");
  })) return null;
  const occupied = Array.from({ length: FRAME_CELL_COUNT }, (_, index) =>
    ids.some(id => decisions[id][String(index)] === "observed"),
  ).filter(Boolean).length;
  return { occupiedCells: occupied, totalCells: FRAME_CELL_COUNT * requiredViews };
}

export function confirmedFrequencyByMorph(decisions: CellDecisions, morphIds: string[], requiredViews = 1) {
  return Object.fromEntries(morphIds.map(id => {
    const cells = decisions[id];
    if (!cells || Array.from({ length: FRAME_CELL_COUNT }, (_, index) => cells[String(index)])
      .some(state => state !== "observed" && state !== "not_observed")) return [id, null];
    return [id, { occupiedCells: Array.from({ length: FRAME_CELL_COUNT }, (_, index) =>
      cells[String(index)] === "observed" ? 1 : 0).reduce<number>((a, b) => a + b, 0), totalCells: FRAME_CELL_COUNT * requiredViews }];
  }));
}

export function encodeAcceptedMasks(
  labels: Uint8Array,
  width: number,
  height: number,
  groups: Array<{ id: string; label: number }>,
) {
  if (labels.length !== width * height) throw new Error("La selección aceptada no coincide con la fotografía.");
  return Object.fromEntries(groups.map(group => {
    const mask = new Uint8Array(labels.length);
    labels.forEach((label, index) => { if (label === group.label) mask[index] = 1; });
    return [group.id, encodeMaskRle(mask, width, height)];
  }));
}

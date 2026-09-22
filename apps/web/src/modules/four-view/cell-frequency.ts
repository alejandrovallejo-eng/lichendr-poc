import { decodeMaskRle, encodeMaskRle } from "../region-suggestions/mask-codec";

export const CELL_FREQUENCY_METHOD = "cell-frequency-v1";
export const FRAME_WIDTH_CM = 10;
export const FRAME_HEIGHT_CM = 50;
export const FRAME_CELL_COUNT = 5;

export type CellDecision = "proposed" | "observed" | "not_observed" | "not_evaluated";
export type CellDecisions = Record<string, Record<string, CellDecision>>;

export interface VerifiedCalibration {
  pixelsPerCm: number;
  method: "automatic" | "manual_confirmed" | "legacy_four_view";
  width: number;
  height: number;
}

export interface StandardizedCellReview {
  method: typeof CELL_FREQUENCY_METHOD;
  frame: { x: number; y: number; width: number; height: number; widthCm: 10; heightCm: 50 };
  calibration: VerifiedCalibration;
  maskWidth: number;
  maskHeight: number;
  masksByMorph: Record<string, string>;
  decisions: CellDecisions;
  reviewedAt: string | null;
}

export function isVerifiedCalibration(value: unknown): value is VerifiedCalibration {
  const calibration = value as Partial<VerifiedCalibration> | null;
  return Boolean(calibration
    && Number.isFinite(calibration.pixelsPerCm) && calibration.pixelsPerCm > 0
    && Number.isSafeInteger(calibration.width) && calibration.width > 0
    && Number.isSafeInteger(calibration.height) && calibration.height > 0
    && ["automatic", "manual_confirmed", "legacy_four_view"].includes(calibration.method));
}

export function verticalFrameCells(frame: StandardizedCellReview["frame"], width: number, height: number) {
  return Array.from({ length: FRAME_CELL_COUNT }, (_, index) => ({
    index,
    x: frame.x,
    y: frame.y + frame.height * index / FRAME_CELL_COUNT,
    width: frame.width,
    height: frame.height / FRAME_CELL_COUNT,
    pixel: {
      left: Math.floor(frame.x * width),
      top: Math.floor((frame.y + frame.height * index / FRAME_CELL_COUNT) * height),
      right: Math.ceil((frame.x + frame.width) * width),
      bottom: Math.ceil((frame.y + frame.height * (index + 1) / FRAME_CELL_COUNT) * height),
    },
  }));
}

export function occupiedCellsFromMask(mask: Uint8Array, width: number, height: number, frame: StandardizedCellReview["frame"]) {
  if (mask.length !== width * height) throw new Error("La máscara no coincide con la vista.");
  return verticalFrameCells(frame, width, height).filter(cell => {
    for (let y = Math.max(0, cell.pixel.top); y < Math.min(height, cell.pixel.bottom); y += 1) {
      for (let x = Math.max(0, cell.pixel.left); x < Math.min(width, cell.pixel.right); x += 1) {
        if (mask[y * width + x]) return true;
      }
    }
    return false;
  }).map(cell => cell.index);
}

export function proposeCellDecisions(review: Pick<StandardizedCellReview, "masksByMorph" | "maskWidth" | "maskHeight" | "frame">): CellDecisions {
  const decisions: CellDecisions = {};
  for (const [morphId, encoded] of Object.entries(review.masksByMorph)) {
    const decoded = decodeMaskRle(encoded);
    if (decoded.width !== review.maskWidth || decoded.height !== review.maskHeight) {
      throw new Error("La máscara aceptada no coincide con la fotografía.");
    }
    decisions[morphId] = {};
    for (const index of occupiedCellsFromMask(decoded.mask, decoded.width, decoded.height, review.frame)) {
      decisions[morphId][String(index)] = "proposed";
    }
  }
  return decisions;
}

export function confirmedFrequency(decisions: CellDecisions, requiredViews = 1) {
  const states = Object.values(decisions).flatMap(cells => Object.values(cells));
  if (states.some(state => state === "proposed" || state === "not_evaluated")) return null;
  const occupied = Array.from({ length: FRAME_CELL_COUNT }, (_, index) =>
    Object.values(decisions).some(cells => cells[String(index)] === "observed"),
  ).filter(Boolean).length;
  return { occupiedCells: occupied, totalCells: FRAME_CELL_COUNT * requiredViews };
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

// Geometry that turns a MobileSAM mask into the crop BioCLIP sees.
//
// The rules are the same ones implemented in `services/bioclip/crops.py`:
//
// * the crop is the mask bounding box expanded by a relative context margin, so
//   the classifier sees surrounding substrate instead of an isolated blob;
// * the box is clamped to the image, never re-centred and never centre-cropped;
//   a region touching the border keeps its extremes;
// * boxes grow to a minimum side, are downscaled (not truncated) above a
//   maximum side, and near-duplicates are collapsed;
// * every step is recorded (EXIF orientation, analysis proxy, rectification,
//   bounding box, context expansion, downscale, encoder preprocessing) so a
//   suggestion can be mapped back to the untouched original.

import type { Box, TransformStep } from "./types";

export const CONTEXT_MARGIN_RATIO = 0.25;
export const MIN_CROP_SIDE = 48;
export const MAX_CROP_SIDE = 1024;
export const DUPLICATE_IOU = 0.92;
export const MAX_REGIONS_PER_VIEW = 24;

export function maskBoundingBox(mask: ArrayLike<number>, width: number, height: number): Box | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Las dimensiones de la máscara no son válidas.");
  }
  if (mask.length !== width * height) {
    throw new Error("La máscara no coincide con las dimensiones indicadas.");
  }
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    const x = index % width;
    const y = (index - x) / width;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function expandWithContext(
  box: Box,
  imageWidth: number,
  imageHeight: number,
  marginRatio: number = CONTEXT_MARGIN_RATIO,
  minSide: number = MIN_CROP_SIDE,
): Box {
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("Las dimensiones de la imagen no son válidas.");
  }
  const marginX = box.width * marginRatio;
  const marginY = box.height * marginRatio;
  let left = box.x - marginX;
  let top = box.y - marginY;
  let right = box.x + box.width + marginX;
  let bottom = box.y + box.height + marginY;

  if (right - left < minSide) {
    const deficit = (minSide - (right - left)) / 2;
    left -= deficit;
    right += deficit;
  }
  if (bottom - top < minSide) {
    const deficit = (minSide - (bottom - top)) / 2;
    top -= deficit;
    bottom += deficit;
  }

  let leftI = Math.max(0, Math.floor(left));
  let topI = Math.max(0, Math.floor(top));
  let rightI = Math.min(imageWidth, Math.ceil(right));
  let bottomI = Math.min(imageHeight, Math.ceil(bottom));

  // Clamping to the image must never eat into the proposed region itself.
  leftI = Math.min(leftI, box.x);
  topI = Math.min(topI, box.y);
  rightI = Math.max(rightI, Math.min(imageWidth, box.x + box.width));
  bottomI = Math.max(bottomI, Math.min(imageHeight, box.y + box.height));

  return {
    x: leftI,
    y: topI,
    width: Math.max(1, rightI - leftI),
    height: Math.max(1, bottomI - topI),
  };
}

export function intersectionOverUnion(first: Box, second: Box): number {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  const union = first.width * first.height + second.width * second.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function deduplicateBoxes(boxes: readonly Box[], threshold = DUPLICATE_IOU): Box[] {
  const kept: Box[] = [];
  for (const box of boxes) {
    if (kept.some((other) => intersectionOverUnion(box, other) >= threshold)) continue;
    kept.push(box);
  }
  return kept;
}

// A crop larger than the cap is downscaled as a whole; it is never truncated,
// because truncating would silently drop part of the proposed region.
export function scaleToMaxSide(box: Box, maxSide = MAX_CROP_SIDE): number {
  const longest = Math.max(box.width, box.height);
  return longest <= maxSide ? 1 : maxSide / longest;
}

// Maps a box expressed on raw sensor pixels onto the EXIF-oriented image.
export function applyExifOrientationToBox(
  box: Box,
  orientation: number,
  imageWidth: number,
  imageHeight: number,
): Box {
  const { x, y, width: w, height: h } = box;
  switch (orientation) {
    case 0:
    case 1:
      return box;
    case 2:
      return { x: imageWidth - x - w, y, width: w, height: h };
    case 3:
      return { x: imageWidth - x - w, y: imageHeight - y - h, width: w, height: h };
    case 4:
      return { x, y: imageHeight - y - h, width: w, height: h };
    case 5:
      return { x: y, y: x, width: h, height: w };
    case 6:
      return { x: imageHeight - y - h, y: x, width: h, height: w };
    case 7:
      return { x: imageHeight - y - h, y: imageWidth - x - w, width: h, height: w };
    case 8:
      return { x: y, y: imageWidth - x - w, width: h, height: w };
    default:
      throw new Error(`Orientación EXIF no soportada: ${orientation}`);
  }
}

export interface CropPlanInput {
  mask: ArrayLike<number>;
  maskWidth: number;
  maskHeight: number;
  orientation: number;
  proxyScale: number;
  rectified: boolean;
  canonicalWidth: number;
  canonicalHeight: number;
  preprocessMode: string;
}

export interface CropPlan {
  tightBox: Box;
  cropBox: Box;
  downscale: number;
  transformChain: TransformStep[];
}

// Builds the crop and the full transformation chain for one proposed mask.
export function planCrop(input: CropPlanInput): CropPlan | null {
  const tight = maskBoundingBox(input.mask, input.maskWidth, input.maskHeight);
  if (!tight) return null;
  const cropBox = expandWithContext(tight, input.maskWidth, input.maskHeight);
  const downscale = scaleToMaxSide(cropBox);
  return {
    tightBox: tight,
    cropBox,
    downscale,
    transformChain: [
      { step: "exif_orientation", orientation: input.orientation },
      {
        step: "analysis_proxy",
        scale: input.proxyScale,
        width: input.maskWidth,
        height: input.maskHeight,
      },
      {
        step: "rectification",
        applied: input.rectified,
        canonicalWidth: input.canonicalWidth,
        canonicalHeight: input.canonicalHeight,
      },
      { step: "mask_bounding_box", box: tight },
      { step: "context_expansion", box: cropBox, marginRatio: CONTEXT_MARGIN_RATIO },
      { step: "crop_downscale", scale: downscale },
      // The encoder resizes the whole crop and pads it: no centre crop, so the
      // extremes of the region are never lost.
      { step: "encoder_preprocess", mode: input.preprocessMode, centerCrop: false },
    ],
  };
}

// Plans a batch of crops, dropping empty masks and near-duplicates and
// enforcing the per-view region cap.
export function planCropBatch(
  inputs: readonly (CropPlanInput & { regionId: string })[],
  maxRegions = MAX_REGIONS_PER_VIEW,
): Array<CropPlan & { regionId: string }> {
  const kept: Array<CropPlan & { regionId: string }> = [];
  for (const input of inputs) {
    if (kept.length >= maxRegions) break;
    const plan = planCrop(input);
    if (!plan) continue;
    if (kept.some((other) => intersectionOverUnion(plan.cropBox, other.cropBox) >= DUPLICATE_IOU)) {
      continue;
    }
    kept.push({ ...plan, regionId: input.regionId });
  }
  return kept;
}

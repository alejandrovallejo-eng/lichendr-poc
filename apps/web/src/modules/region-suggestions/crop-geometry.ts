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

import type { Box } from "./types";

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

// NOTE: the crop plan (context expansion + downscale) lives on the SERVER, in
// `app/api/vision/region-suggestions/route.ts`, and is applied exactly once
// there. The client only measures the tight bounding box and draws back the
// crop geometry the server reports.

// --- Single geometry contract ----------------------------------------------
//
// EXIF orientation is applied ONCE, upstream: the analysis proxy is generated
// with `.rotate()` and the vision service decodes with `exif_transpose`, so both
// the MobileSAM masks and the proxy live in the same EXIF-oriented canonical
// space and differ only in scale.
//
// Therefore the pilot never rotates coordinates again. A mask box measured on
// the working grid is mapped to proxy pixels by a single proportional scaling,
// and the context margin is applied EXACTLY ONCE, on the server, when the crop
// is cut. The client sends the tight bounding box and draws the crop box the
// server reports back, so overlay and crop always coincide.
export function scaleBoxToSpace(
  box: Box,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): Box {
  for (const value of [fromWidth, fromHeight, toWidth, toHeight]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Las dimensiones del espacio de coordenadas no son válidas.");
    }
  }
  const scaleX = toWidth / fromWidth;
  const scaleY = toHeight / fromHeight;
  // Floor the origin and ceil the far edge: rounding never shrinks the region.
  const left = Math.max(0, Math.min(toWidth - 1, Math.floor(box.x * scaleX)));
  const top = Math.max(0, Math.min(toHeight - 1, Math.floor(box.y * scaleY)));
  const right = Math.max(left + 1, Math.min(toWidth, Math.ceil((box.x + box.width) * scaleX)));
  const bottom = Math.max(top + 1, Math.min(toHeight, Math.ceil((box.y + box.height) * scaleY)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

"use client";

// Browser side of the pilot.
//
// Regions come from MobileSAM (`services/vision`, `vit_t`) through the existing
// vision routes, NOT from the in-browser SlimSAM of `modules/vision-lab`.
//
// Geometry contract (applied once, see `crop-geometry.ts`):
//
// * EXIF orientation is already applied upstream by the proxy and by the vision
//   service, so no coordinate is rotated here;
// * the client sends the TIGHT mask bounding box expressed on the working grid
//   plus that grid's dimensions;
// * the server scales it to proxy pixels and applies the context margin exactly
//   once, then reports the crop box back so the overlay matches the crop.
//
// The suggestion request carries only identifiers, integer boxes and mask pixel
// hashes: no image bytes, no URL, no credential.

import { maskBoundingBox } from "./crop-geometry";
import { encodeMaskRle, maskArea } from "./mask-codec";
import type { Box, ProposedRegion, RegionSuggestion, SuggestionProvenance } from "./types";

export interface SuggestionRequestContext {
  imageId: string;
  treeSampleId: string;
  direction: string;
  requestToken: string;
}

export interface SuggestionResponse {
  context: SuggestionRequestContext;
  cacheKey: string;
  cached: boolean;
  provenance: SuggestionProvenance;
  backend: string;
  headWarning: string | null;
  geometry: Array<{ regionId: string; cropBoxNormalized: Box }>;
  suggestions: RegionSuggestion[];
  notice: string;
}

// Fixed, reproducible prompt grid — proposals must not depend on where the
// reviewer happens to click.
export function gridPromptPoints(rows = 5, columns = 2): Array<{ x: number; y: number }> {
  if (rows <= 0 || columns <= 0) throw new Error("La rejilla de propuestas no es válida.");
  const points: Array<{ x: number; y: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      points.push({ x: (column + 0.5) / columns, y: (row + 0.5) / rows });
    }
  }
  return points;
}

export interface MaskInput {
  regionId: string;
  mask: Uint8Array;
  samScore: number;
}

export interface WorkingGrid {
  width: number;
  height: number;
  // Scale from the EXIF-oriented original to the working grid, recorded for
  // traceability only: no coordinate is rotated again.
  originalWidth: number;
  originalHeight: number;
  orientationAppliedUpstream: boolean;
  rectified: boolean;
}

// Deterministic content hash of the mask pixels (FNV-1a over the encoded runs).
// Different pixels give a different key, so a cached suggestion can never be
// reused for a mask the reviewer edited.
export function maskPixelHash(encodedMask: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < encodedMask.length; index += 1) {
    hash ^= encodedMask.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// Turns real MobileSAM masks into proposed regions. Empty masks are dropped;
// the mask pixels are preserved (run-length encoded), never replaced by a box.
export function regionsFromMasks(
  inputs: readonly MaskInput[],
  grid: WorkingGrid,
  maxRegions: number,
): ProposedRegion[] {
  const regions: ProposedRegion[] = [];
  const seenHashes = new Set<string>();
  for (const input of inputs) {
    if (regions.length >= maxRegions) break;
    const tightBox = maskBoundingBox(input.mask, grid.width, grid.height);
    if (!tightBox) continue;
    const maskRle = encodeMaskRle(input.mask, grid.width, grid.height);
    const maskSha = maskPixelHash(maskRle);
    // MobileSAM returns the same region for neighbouring prompts: identical
    // pixels are kept once so nothing is double counted later.
    if (seenHashes.has(maskSha)) continue;
    seenHashes.add(maskSha);
    regions.push({
      regionId: input.regionId,
      maskWidth: grid.width,
      maskHeight: grid.height,
      maskRle,
      maskSha,
      maskAreaPixels: maskArea(input.mask),
      box: tightBox,
      cropBoxNormalized: null,
      // MobileSAM's own score: mask quality, never evidence of lichen.
      samScore: input.samScore,
      transformChain: [
        { step: "exif_orientation", appliedUpstream: grid.orientationAppliedUpstream },
        {
          step: "working_grid",
          width: grid.width,
          height: grid.height,
          originalWidth: grid.originalWidth,
          originalHeight: grid.originalHeight,
        },
        { step: "rectification", applied: grid.rectified },
        { step: "mask_bounding_box", box: tightBox },
      ],
    });
  }
  return regions;
}

// A region the reviewer adds because MobileSAM missed it. It starts EMPTY and
// pending: "no proposal" is not proof of absence, so the reviewer must be able
// to draw a mask even when nothing was proposed at all.
export function manualRegion(regionId: string, grid: WorkingGrid): ProposedRegion {
  const empty = new Uint8Array(grid.width * grid.height);
  const maskRle = encodeMaskRle(empty, grid.width, grid.height);
  return {
    regionId,
    maskWidth: grid.width,
    maskHeight: grid.height,
    maskRle,
    maskSha: maskPixelHash(maskRle),
    maskAreaPixels: 0,
    box: { x: 0, y: 0, width: 0, height: 0 },
    cropBoxNormalized: null,
    // No MobileSAM involved: the score is not a measurement of anything.
    samScore: 0,
    transformChain: [
      { step: "exif_orientation", appliedUpstream: grid.orientationAppliedUpstream },
      {
        step: "working_grid",
        width: grid.width,
        height: grid.height,
        originalWidth: grid.originalWidth,
        originalHeight: grid.originalHeight,
      },
      { step: "rectification", applied: grid.rectified },
      { step: "mask_bounding_box", box: { x: 0, y: 0, width: 0, height: 0 } },
    ],
  };
}

// Re-anchors a region on the pixels the reviewer just painted: new hash, new
// area and, crucially, a new bounding box, so a later crop follows the edited
// mask instead of the proposal it came from.
export function applyEditedMask(
  region: ProposedRegion,
  mask: Uint8Array,
  width: number,
  height: number,
): ProposedRegion {
  const maskRle = encodeMaskRle(mask, width, height);
  const box = maskBoundingBox(mask, width, height) ?? { x: 0, y: 0, width: 0, height: 0 };
  return {
    ...region,
    maskWidth: width,
    maskHeight: height,
    maskRle,
    maskSha: maskPixelHash(maskRle),
    maskAreaPixels: maskArea(mask),
    box,
    // The server crop of the previous pixels no longer describes this mask.
    cropBoxNormalized: null,
    transformChain: region.transformChain.map((step) =>
      step.step === "mask_bounding_box" ? { step: "mask_bounding_box", box } : step,
    ),
  };
}

export class SuggestionRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SuggestionRequestError";
    this.status = status;
  }
}

export function buildSuggestionPayload(
  context: SuggestionRequestContext,
  regions: readonly ProposedRegion[],
  grid: { width: number; height: number },
) {
  return {
    ...context,
    // Working grid dimensions: the server scales the boxes into proxy pixels.
    sourceWidth: grid.width,
    sourceHeight: grid.height,
    regions: regions.map((region) => ({
      regionId: region.regionId,
      // TIGHT bounding box: the context margin is added once, on the server.
      box: region.box,
      maskAreaPixels: region.maskAreaPixels,
      maskSha: region.maskSha,
      samScore: region.samScore,
    })),
  };
}

export async function requestRegionSuggestions(
  context: SuggestionRequestContext,
  regions: readonly ProposedRegion[],
  grid: { width: number; height: number },
  signal?: AbortSignal,
): Promise<SuggestionResponse> {
  const response = await fetch("/api/vision/region-suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSuggestionPayload(context, regions, grid)),
    signal,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    throw new SuggestionRequestError(
      "El servicio de sugerencias devolvió una respuesta inválida. Tus fotografías y revisiones se conservan.",
      response.status,
    );
  }
  if (!response.ok) {
    const error = (body as { error?: unknown })?.error;
    throw new SuggestionRequestError(
      typeof error === "string"
        ? error
        : "No se pudieron obtener sugerencias. Puedes anotar manualmente y reintentar.",
      response.status,
    );
  }
  return body as SuggestionResponse;
}

// Applies the crop geometry the server reports so the overlay draws exactly the
// crop BioCLIP saw, instead of a box the client expanded on its own.
export function applyServerGeometry(
  regions: readonly ProposedRegion[],
  geometry: readonly { regionId: string; cropBoxNormalized: Box }[],
): ProposedRegion[] {
  const byId = new Map(geometry.map((entry) => [entry.regionId, entry.cropBoxNormalized]));
  return regions.map((region) => {
    const cropBoxNormalized = byId.get(region.regionId) ?? region.cropBoxNormalized;
    if (!cropBoxNormalized) return region;
    return {
      ...region,
      cropBoxNormalized,
      transformChain: [
        ...region.transformChain.filter((step) => step.step !== "server_crop"),
        { step: "server_crop", boxNormalized: cropBoxNormalized },
      ],
    };
  });
}

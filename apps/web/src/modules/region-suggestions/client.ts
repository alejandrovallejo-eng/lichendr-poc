"use client";

// Browser side of the pilot: it asks the in-browser SAM worker for region
// proposals and then asks the server route for BioCLIP label suggestions.
//
// The image bytes never travel in the suggestion request: only identifiers and
// integer bounding boxes are sent, and the server cuts the crops from the
// private analysis proxy. No signed URL is ever handled here.

import type { SegmentationCandidate } from "../vision-lab/types";
import { planCropBatch, MAX_REGIONS_PER_VIEW } from "./crop-geometry";
import type { ProposedRegion, RegionSuggestion, SuggestionProvenance } from "./types";

export interface SuggestionRequestContext {
  imageId: string;
  treeSampleId: string;
  direction: string;
  requestToken: string;
}

export interface SuggestionResponse {
  context: SuggestionRequestContext;
  cacheKey: string;
  provenance: SuggestionProvenance;
  backend: string;
  suggestions: RegionSuggestion[];
  notice: string;
}

// Fixed, reproducible prompt grid — the same shape the vision service uses, so
// proposals do not depend on where the reviewer happens to click.
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

// Turns raw SAM candidates into regions with their crop plan and full
// transformation chain, dropping empty and duplicated masks.
export function regionsFromCandidates(
  candidates: readonly SegmentationCandidate[],
  options: {
    orientation: number;
    proxyScale: number;
    rectified: boolean;
    canonicalWidth: number;
    canonicalHeight: number;
    preprocessMode: string;
  },
): ProposedRegion[] {
  const inputs = candidates.map((candidate) => {
    const height = candidate.mask.length;
    const width = height > 0 ? candidate.mask[0].length : 0;
    const flat = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        flat[y * width + x] = candidate.mask[y][x] ? 1 : 0;
      }
    }
    return {
      regionId: candidate.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || `region-${x36()}`,
      mask: flat,
      maskWidth: width,
      maskHeight: height,
      ...options,
    };
  });
  const scores = new Map(inputs.map((input, index) => [input.regionId, candidates[index]?.score ?? 0]));
  const planned = planCropBatch(inputs, MAX_REGIONS_PER_VIEW);
  return planned.map((plan) => {
    const source = inputs.find((item) => item.regionId === plan.regionId)!;
    let area = 0;
    for (let position = 0; position < source.mask.length; position += 1) {
      if (source.mask[position] !== 0) area += 1;
    }
    return {
      regionId: plan.regionId,
      maskWidth: source.maskWidth,
      maskHeight: source.maskHeight,
      maskAreaPixels: area,
      box: plan.cropBox,
      // SAM's own score: mask quality, never evidence of lichen.
      samScore: scores.get(plan.regionId) ?? 0,
      transformChain: plan.transformChain,
    };
  });
}

export class SuggestionRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SuggestionRequestError";
    this.status = status;
  }
}

export async function requestRegionSuggestions(
  context: SuggestionRequestContext,
  regions: readonly ProposedRegion[],
  signal?: AbortSignal,
): Promise<SuggestionResponse> {
  const response = await fetch("/api/vision/region-suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...context,
      regions: regions.map((region) => ({
        regionId: region.regionId,
        box: region.box,
        maskAreaPixels: region.maskAreaPixels,
        samScore: region.samScore,
      })),
    }),
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

function x36(): string {
  return Math.random().toString(36).slice(2, 10);
}

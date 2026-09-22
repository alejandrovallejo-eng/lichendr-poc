import { trunkOutlineError, rasterizeTrunk, type TrunkPoint } from "../region-suggestions/trunk-outline";
import { parseColorConfig, type ColorConfig, type ColorResult } from "../region-suggestions/trunk-colors";
import { manualRegion, applyEditedMask, requestRegionSuggestions, type SuggestionResponse } from "../region-suggestions/client";
import type { Direction } from "./types";
import type { GuidedCloudStore } from "./guided-cloud";
import type { VerifiedCalibration } from "./cell-frequency";

export const GUIDED_VERSION = 1;
export interface GuidedContext { projectId: string; siteId: string; eventId: string; treeId: string }
export interface GuidedSession { ownerId: string; treeSampleId: string; views: Partial<Record<Direction, string>>; completed: boolean; savedViews?: Partial<Record<Direction, boolean>> }
export interface GuidedServices {
  cloud: GuidedCloudStore;
  load(context: GuidedContext): Promise<GuidedSession>;
  upload(context: GuidedContext, direction: Direction, file: File, requestKey: string): Promise<{imageId:string;treeSampleId:string}>;
  photo(ownerId: string, imageId: string): Promise<Blob>;
  // Read an existing private proxy only. The summary must not prepare images,
  // invoke a model, or write any records just to display saved results.
  storedPhoto(ownerId: string, imageId: string): Promise<Blob>;
}
export interface GuidedReview {
  version: 1;
  outline: TrunkPoint[];
  config: ColorConfig;
  savedAt: string | null;
  analysis: { counts: number[]; total: number; lichen: number; width: number; height: number; ai: SuggestionResponse | null } | null;
  calibration?: VerifiedCalibration;
}
export function guidedKey(ownerId: string, treeSampleId: string, direction: Direction, imageId: string) {
  if (![ownerId, treeSampleId, direction, imageId].every(Boolean)) throw new Error("Falta el contexto de la fotografía.");
  return `lichendr:guided:v${GUIDED_VERSION}:${ownerId}:${treeSampleId}:${direction}:${imageId}`;
}
export function parseGuidedReview(raw: string | null): GuidedReview | null {
  try {
    if (!raw || raw.length > 200_000) return null;
    const value = JSON.parse(raw), config = parseColorConfig(JSON.stringify(value.config));
    if (value.version !== GUIDED_VERSION || !config || (config.version === 1 && config.samples.length > 6) || config.samples.some(s => s.label === 2)
      || !Array.isArray(value.outline) || value.outline.length > 64
      || (value.outline.length >= 3 && trunkOutlineError(value.outline))) return null;
    if (value.outline.some((p: TrunkPoint) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return null;
    const a = value.analysis;
    if (a && (trunkOutlineError(value.outline) || !config.samples.length
      || !Number.isSafeInteger(a.total) || a.total < 1 || !Number.isSafeInteger(a.lichen) || a.lichen < 0 || a.lichen > a.total
      || !Number.isSafeInteger(a.width) || !Number.isSafeInteger(a.height) || a.width < 1 || a.height < 1 || a.width > 1024 || a.height > 1024
      || !Array.isArray(a.counts) || a.counts.length !== (config.version === 2 ? 11 : 6) || a.counts.some((n: number) => !Number.isSafeInteger(n) || n < 0)
      || a.total > a.width * a.height || a.counts[0] !== 0 || a.counts[2] !== 0
      || a.counts.reduce((x: number, y: number) => x + y, 0) !== a.total
      || a.lichen !== a.counts.slice(3).reduce((x: number, y: number) => x + y, 0)
      || (a.ai && !Array.isArray(a.ai.suggestions)))) return null;
    return { version: 1, outline: value.outline, config, analysis: a ?? null, calibration: value.calibration,
      savedAt: a && typeof value.savedAt === "string" && Number.isFinite(Date.parse(value.savedAt)) ? value.savedAt : null };
  } catch { return null; }
}

// BioCLIP checks representative patches at the HUMAN-selected lichen samples.
// It does not create or validate the colour mask. Keep that distinction in UI.
// Every patch is clipped to the trunk; cap cost to six distinct sample points.
export async function checkLichenSamples(reference: { imageId: string; treeSampleId: string; direction: Direction },
  outline: TrunkPoint[], config: ColorConfig, width: number, height: number, signal: AbortSignal, experimental = false) {
  const roi = rasterizeTrunk(outline, width, height);
  const grid = { width, height, originalWidth: width, originalHeight: height, orientationAppliedUpstream: true, rectified: false };
  const seen = new Set<string>();
  const regions = config.samples.filter(s => {
    const key = `${Math.floor(s.x * width)}:${Math.floor(s.y * height)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 6).map((sample, index) => {
    const mask = new Uint8Array(width * height), cx = Math.floor(sample.x * width), cy = Math.floor(sample.y * height);
    const radius = Math.max(8, Math.round(Math.max(width, height) * .035));
    for (let y = Math.max(0, cy - radius); y < Math.min(height, cy + radius + 1); y++)
      for (let x = Math.max(0, cx - radius); x < Math.min(width, cx + radius + 1); x++) mask[y * width + x] = roi[y * width + x];
    return applyEditedMask(manualRegion(`sample-${index}`, grid), mask, width, height);
  });
  return requestRegionSuggestions({ ...reference, requestToken: crypto.randomUUID(), ...(experimental ? { experimental: true } : {}) }, regions, grid, signal);
}
export function analysisRecord(result: ColorResult, width: number, height: number, ai: SuggestionResponse | null) {
  return { counts: result.counts, total: result.total, lichen: result.lichen, width, height, ai };
}

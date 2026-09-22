import { parseColorConfig, type ColorConfig, type ColorClass } from "../region-suggestions/trunk-colors";
import { rasterizeTrunk, trunkOutlineError, type TrunkPoint } from "../region-suggestions/trunk-outline";
import { reviewFingerprint } from "./guided-cloud";
import type { StandardizedCellReview } from "./cell-frequency";

export interface Morphospecies { id: string; event_id: string; ordinal: number; custom_name?: string | null; name_revision?: number }
export interface Quadrat { x: number; y: number; width: number; height: number }
export interface EcologyReview {
  version: 1; scale: "uncalibrated"; sourceOutline: TrunkPoint[];
  quadrat: Quadrat; width: number; height: number; config: ColorConfig;
  counts: number[]; total: number; savedAt: string;
  standardized?: StandardizedCellReview;
}
export interface EcologyRow { image_id: string; event_id: string; tree_sample_id: string; direction: string; review: EcologyReview; revision: number }
export function morphName(ordinal: number) {
  let letters = "", n = ordinal;
  while (n > 0) { n--; letters = String.fromCharCode(65 + n % 26) + letters; n = Math.floor(n / 26); }
  return `Morfoespecie ${letters}`;
}
export const morphDisplayName = (m: Morphospecies) => m.custom_name?.trim() || morphName(m.ordinal);
export function normalizeMorphName(value: string): string | null {
  const name = value.trim();
  if (name.length > 80 || [...name].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)) throw new Error("Usa un nombre de hasta 80 caracteres, en una sola línea.");
  return name || null;
}
export function emptyEcologyConfig(): ColorConfig {
  return { version: 2, tolerance: 12, samples: [], confirmed: { legacyCount: 0, legacyTolerance: 12,
    groups: [{ id: "unassigned", label: 3, name: "Elige una morfoespecie" }] } };
}
// Catalogue identity is shared, never samples, masks or pixel class numbers.
export function selectMorph(config: ColorConfig, morph: Morphospecies): { config: ColorConfig; label: ColorClass } {
  const existing = config.confirmed!.groups.find(g => g.id === morph.id);
  if (existing) return { config, label: existing.label };
  const groups = config.confirmed!.groups.filter(g => g.id !== "unassigned");
  if (groups.length >= 8) throw new Error("Este cuadrante admite hasta 8 morfoespecies.");
  const label = Array.from({ length: 8 }, (_, i) => i + 3).find(n => !groups.some(g => g.label === n)) as ColorClass;
  return { label, config: { ...config, confirmed: { ...config.confirmed!, groups: [...groups, { id: morph.id, label, name: morphName(morph.ordinal) }] } } };
}
export function quadratOutline(q: Quadrat, width: number, height: number): TrunkPoint[] {
  return [{ x: q.x / width, y: q.y / height }, { x: (q.x + q.width) / width, y: q.y / height },
    { x: (q.x + q.width) / width, y: (q.y + q.height) / height }, { x: q.x / width, y: (q.y + q.height) / height }];
}
export function quadratFromPoints(a: TrunkPoint, b: TrunkPoint, width: number, height: number): Quadrat {
  const x1 = Math.floor(a.x * width), y1 = Math.floor(a.y * height), x2 = Math.floor(b.x * width), y2 = Math.floor(b.y * height);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
export function validQuadrat(q: Quadrat, outline: TrunkPoint[], width: number, height: number): boolean {
  if (![width, height].every(n => Number.isInteger(n) && n >= 1 && n <= 1024) || trunkOutlineError(outline)) return false;
  if (![q.x, q.y, q.width, q.height].every(Number.isSafeInteger) || q.x < 0 || q.y < 0 || q.width < 4 || q.height < 4 || q.x + q.width > width || q.y + q.height > height) return false;
  const trunk = rasterizeTrunk(outline, width, height);
  for (let y = q.y; y < q.y + q.height; y++) for (let x = q.x; x < q.x + q.width; x++) if (!trunk[y * width + x]) return false;
  return true;
}
export function parseEcologyReview(value: unknown): EcologyReview | null {
  try {
    const r = value as EcologyReview;
    if (!r || JSON.stringify(r).length > 200000 || r.version !== 1 || r.scale !== "uncalibrated" || !Array.isArray(r.sourceOutline) || !r.quadrat
      || !validQuadrat(r.quadrat, r.sourceOutline, r.width, r.height)) return null;
    const config = parseColorConfig(JSON.stringify(r.config));
    if (!config || config.version !== 2 || config.confirmed?.legacyCount !== 0 || config.samples.some(s => s.label === 2)) return null;
    if (config.confirmed.groups.some(g => g.id === "unassigned") && (config.samples.length || config.confirmed.groups.length !== 1)) return null;
    const q = r.quadrat;
    if (config.samples.some(s => s.x * r.width < q.x || s.x * r.width >= q.x + q.width || s.y * r.height < q.y || s.y * r.height >= q.y + q.height)) return null;
    if (r.total !== q.width * q.height || !Array.isArray(r.counts) || r.counts.length !== 11 || r.counts.some(n => !Number.isSafeInteger(n) || n < 0)
      || r.counts[0] !== 0 || r.counts[2] !== 0 || r.counts.reduce((a, b) => a + b, 0) !== r.total) return null;
    for (let label = 3; label <= 10; label++) if (r.counts[label] && !config.samples.some(s => s.label === label)) return null;
    if (typeof r.savedAt !== "string" || !Number.isFinite(Date.parse(r.savedAt))) return null;
    if (r.standardized !== undefined) {
      const standardized = r.standardized as StandardizedCellReview;
      if (standardized.method !== "cell-frequency-v1"
        || !standardized.frame || standardized.frame.widthCm !== 10 || standardized.frame.heightCm !== 50
        || !Array.isArray(standardized.decisions) && typeof standardized.decisions !== "object"
        || !Number.isSafeInteger(standardized.maskWidth) || !Number.isSafeInteger(standardized.maskHeight)) return null;
    }
    return { version: 1, scale: "uncalibrated", sourceOutline: r.sourceOutline, quadrat: q, width: r.width, height: r.height, config, counts: r.counts, total: r.total, savedAt: r.savedAt, standardized: r.standardized };
  } catch { return null; }
}
export function sameEcologySource(review: EcologyReview, outline: TrunkPoint[], width: number, height: number) {
  return review.width === width && review.height === height && reviewFingerprint(review.sourceOutline) === reviewFingerprint(outline);
}
export function observedMorphs(review: EcologyReview): string[] {
  return review.config.confirmed!.groups.filter(g => g.id !== "unassigned" && review.counts[g.label] > 0).map(g => g.id);
}
export function referenceTones(rows: EcologyRow[], morphId: string): number[][] {
  const colors = new Map<string, number[]>();
  for (const row of rows) {
    const group = row.review.config.confirmed!.groups.find(g => g.id === morphId);
    if (group && row.review.counts[group.label] > 0) for (const s of row.review.config.samples) if (s.label === group.label) colors.set(s.rgb.join(","), s.rgb);
  }
  return [...colors.values()].slice(0, 12);
}
export const ecologyHref = (eventId: string, sampleId?: string) => `/analysis?mode=ecology&eventId=${encodeURIComponent(eventId)}${sampleId ? `&treeSampleId=${encodeURIComponent(sampleId)}` : ""}`;

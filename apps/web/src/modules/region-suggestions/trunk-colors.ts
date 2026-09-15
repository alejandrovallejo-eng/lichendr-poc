import { rasterizeTrunk, type TrunkPoint } from "./trunk-outline";

// Exploratory colour segmentation, not species identification. Codes are
// disjoint: 0 outside, 1 unknown, 2 bark, 3..5 user-labelled lichen tones.
export const COLOR_VERSION = 1;
export const COLOR_SIDE = 1024;
export const MAX_COLOR_SAMPLES = 24;
export const COLOR_NAMES = ["Sin clasificar", "Corteza", "Liquen · tono 1", "Liquen · tono 2", "Liquen · tono 3"];
export const OVERLAY_RGB = [[148, 163, 184], [180, 110, 55], [16, 220, 130], [250, 204, 21], [216, 90, 240]];
export type RGB = [number, number, number];
export type ColorClass = 2 | 3 | 4 | 5;
export interface ColorSample { x: number; y: number; rgb: RGB; label: ColorClass }
export interface ColorConfig { version: 1; samples: ColorSample[]; tolerance: number }
export interface ColorResult { labels: Uint8Array; counts: number[]; total: number; lichen: number }
export const initialColorConfig = (): ColorConfig => ({ version: COLOR_VERSION, samples: [], tolerance: 12 });

// Same sRGB/D65 CIELAB conversion as annotations/color-selection.worker.ts.
// DeltaE76 deliberately includes lightness: shadows are not silently equated.
export function rgbToLab(rgb: RGB): RGB {
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  const f = (v: number) => v > 216 / 24389 ? Math.cbrt(v) : (841 / 108) * v + 4 / 29;
  const x = f((r * .4124564 + g * .3575761 + b * .1804375) / .95047);
  const y = f(r * .2126729 + g * .7151522 + b * .072175);
  const z = f((r * .0193339 + g * .119192 + b * .9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function parseColorConfig(raw: string | null): ColorConfig | null {
  try {
    if (!raw || raw.length > 16384) return null;
    const v = JSON.parse(raw);
    if (v?.version !== COLOR_VERSION || !Number.isInteger(v.tolerance) || v.tolerance < 3 || v.tolerance > 35
      || !Array.isArray(v.samples) || v.samples.length > MAX_COLOR_SAMPLES) return null;
    for (const s of v.samples) {
      if (!s || ![2, 3, 4, 5].includes(s.label) || !Number.isFinite(s.x) || !Number.isFinite(s.y)
        || s.x < 0 || s.x >= 1 || s.y < 0 || s.y >= 1 || !Array.isArray(s.rgb) || s.rgb.length !== 3
        || s.rgb.some((n: number) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    }
    return { version: COLOR_VERSION, tolerance: v.tolerance, samples: v.samples.map((s: ColorSample) => ({ x: s.x, y: s.y, rgb: [...s.rgb], label: s.label })) };
  } catch { return null; }
}

// The complete normalized outline is part of identity: edits never reuse a
// measurement or samples from a different ROI. No sensitive values in this key.
export function colorStorageKey(baseIdentity: string, outline: readonly TrunkPoint[]): string {
  return `${baseIdentity}:colors:v${COLOR_VERSION}:${JSON.stringify(outline)}`;
}

export function colorWorkingSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error("La fotografía no tiene dimensiones válidas.");
  const scale = Math.min(1, COLOR_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Average 3x3 neighbourhood, but never sample the background or transparent
// pixels across the trunk boundary. Coordinates always refer to original photo.
export function sampleColor(rgba: Uint8ClampedArray, width: number, height: number, roi: Uint8Array,
  x: number, y: number, label: ColorClass): ColorSample | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= 1 || y < 0 || y >= 1) return null;
  if (roi.length !== width * height || rgba.length !== width * height * 4) return null;
  const cx = Math.floor(x * width), cy = Math.floor(y * height);
  if (!roi[cy * width + cx] || rgba[(cy * width + cx) * 4 + 3] < 255) return null;
  const rgb: RGB = [0, 0, 0]; let count = 0;
  for (let py = Math.max(0, cy - 1); py <= Math.min(height - 1, cy + 1); py++) {
    for (let px = Math.max(0, cx - 1); px <= Math.min(width - 1, cx + 1); px++) {
      const index = py * width + px;
      if (!roi[index] || rgba[index * 4 + 3] < 255) continue;
      for (let c = 0; c < 3; c++) rgb[c] += rgba[index * 4 + c];
      count++;
    }
  }
  return count ? { x, y, label, rgb: rgb.map(c => Math.round(c / count)) as RGB } : null;
}

// Bounded and cooperative: yields every 8192 pixels; aborts obsolete slider/
// sample/image work. No model calls, new large images, or per-sample full masks.
export async function classifyTrunkColors(rgba: Uint8ClampedArray, width: number, height: number,
  outline: readonly TrunkPoint[], config: ColorConfig, signal?: AbortSignal,
  mode: "bark-and-lichen" | "lichen-only" = "bark-and-lichen"): Promise<ColorResult> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > COLOR_SIDE || height > COLOR_SIDE || rgba.length !== width * height * 4)
    throw new Error("La imagen de colores excede el tamaño de trabajo seguro.");
  if (!parseColorConfig(JSON.stringify(config))) throw new Error("Las muestras de color no son válidas.");
  if (!config.samples.some(s => s.label >= 3) || (mode === "bark-and-lichen" && !config.samples.some(s => s.label === 2)))
    throw new Error(mode === "lichen-only" ? "Marca al menos un color de liquen." : "Marca al menos una muestra de corteza y una de liquen.");
  if (mode === "lichen-only" && config.samples.some(s => s.label === 2))
    throw new Error("Esta selección utiliza solamente colores de liquen.");
  const roi = rasterizeTrunk(outline, width, height);
  if (config.samples.some(s => !roi[Math.floor(s.y * height) * width + Math.floor(s.x * width)]))
    throw new Error("Una muestra está fuera del tronco. Vuelve a marcarla.");
  const references = config.samples.map(s => ({ label: s.label, lab: rgbToLab(s.rgb) }));
  const labels = new Uint8Array(roi.length), counts = [0, 0, 0, 0, 0, 0];
  const distances = new Float64Array(6);
  for (let i = 0; i < roi.length; i++) {
    if (i % 8192 === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (signal?.aborted) throw new DOMException("Selección cancelada", "AbortError");
    }
    if (!roi[i]) continue;
    let code = 1;
    if (rgba[i * 4 + 3] === 255) {
      const lab = rgbToLab([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
      distances.fill(Infinity);
      for (const ref of references) {
        const d = Math.hypot(lab[0] - ref.lab[0], lab[1] - ref.lab[1], lab[2] - ref.lab[2]);
        if (d < distances[ref.label]) distances[ref.label] = d;
      }
      let best = Infinity, second = Infinity, winner = 1;
      for (let c = 2; c <= 5; c++) {
        const d = distances[c];
        if (d < best) { second = best; best = d; winner = c; }
        else if (d < second) second = d;
      }
      // Competing classes within two DeltaE units are unknown, including ties.
      if (best <= config.tolerance && second - best > 2) code = winner;
    }
    labels[i] = code; counts[code]++;
  }
  return { labels, counts, total: counts.reduce((a, b) => a + b, 0), lichen: counts[3] + counts[4] + counts[5] };
}

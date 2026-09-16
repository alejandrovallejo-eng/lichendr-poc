import type { GuidedReview } from "./guided-flow";
import { DIRECTIONS, type Direction } from "./types";
import { rasterizeTrunk, type TrunkPoint } from "../region-suggestions/trunk-outline";
import { classifyTrunkColors, colorWorkingSize } from "../region-suggestions/trunk-colors";
import { buildOrbitWrapMap, wrapOrbitPixels, type OrbitSkin, type OrbitSurface } from "./tree-orbit-render";

export type OrbitEntry = { src: string; review: GuidedReview | null };
export type OrbitTexture = OrbitSkin & { fingerprint: string; warning: string };
export const normalizeRotation = (angle: number) => ((angle % 360) + 360) % 360;
export const orbitDirection = (rotation: number): Direction => DIRECTIONS[Math.round(normalizeRotation(-rotation) / 90) % 4];
export const directionRotation = (direction: Direction) => -90 * DIRECTIONS.indexOf(direction);

// Display-only reference for exact decoded duplicate photos. First available
// N/E/S/O wins, deterministically. Never write this back to per-view reviews or
// apply it to missing/unidentified/different photos. UI must disclose the source.
export function consistentOrbitTextures(input: Record<Direction, OrbitTexture | null>) {
  const textures = { ...input }, sources: Record<Direction, Direction> = { N: "N", E: "E", S: "S", W: "W" };
  const seen = new Map<string, Direction>();
  for (const d of DIRECTIONS) {
    const texture = input[d];
    if (!texture?.fingerprint) continue;
    const reference = seen.get(texture.fingerprint);
    if (reference) { textures[d] = input[reference]; sources[d] = reference; }
    else seen.set(texture.fingerprint, d);
  }
  return { textures, sources };
}

// One stable visual highlight, not a species or the photographed lichen hue.
export const ORBIT_HIGHLIGHT = [35, 191, 135, 150] as const;

// Copy only occupied polygon pixels; concave background is transparent, never
// filled from another orientation. Input pixels and stored outlines are immutable.
export function cropTrunkPixels(rgba: Uint8ClampedArray, width: number, height: number, outline: readonly TrunkPoint[]) {
  const mask = rasterizeTrunk(outline, width, height);
  if (rgba.length !== width * height * 4) throw new Error("La foto y el contorno no coinciden.");
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error("El contorno no contiene píxeles visibles.");
  const cropWidth = right - left + 1, cropHeight = bottom - top + 1;
  const pixels = new Uint8ClampedArray(cropWidth * cropHeight * 4);
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const from = (y * width + x) * 4;
    if (mask[from / 4]) pixels.set(rgba.subarray(from, from + 4), ((y - top) * cropWidth + x - left) * 4);
  }
  return { pixels, width: cropWidth, height: cropHeight };
}

const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); };
async function decodePhoto(src: string, signal: AbortSignal): Promise<HTMLImageElement> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const image = document.createElement("img");
    const cleanup = () => { image.onload = null; image.onerror = null; signal.removeEventListener("abort", cancel); };
    const cancel = () => { cleanup(); image.src = ""; reject(new DOMException("Cancelled", "AbortError")); };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error("No se pudo abrir la fotografía guardada.")); };
    signal.addEventListener("abort", cancel, { once: true }); image.src = src;
  });
}

// Local rendering only: no fetch, model inference, storage writes or new
// measurement. Overlay is reconstructed from saved settings and must match
// every saved count before it can be displayed.
export async function prepareOrbitTexture(entry: OrbitEntry, signal: AbortSignal): Promise<OrbitTexture> {
  if (!entry.src || !entry.review?.savedAt || !entry.review.outline.length) throw new Error("Falta una foto con contorno guardado.");
  const photo = await decodePhoto(entry.src, signal);
  const canvas = document.createElement("canvas");
  try {
    checkAbort(signal);
    const { width, height } = colorWorkingSize(photo.naturalWidth, photo.naturalHeight);
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Tu navegador no pudo preparar el recorte.");
    ctx.drawImage(photo, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const crop = cropTrunkPixels(rgba, width, height, entry.review.outline);
    const map = buildOrbitWrapMap(crop);
    // Exact decoded-image duplicate warning, independent of different outlines.
    const hash = globalThis.crypto?.subtle ? await crypto.subtle.digest("SHA-256", new Uint8Array(rgba)) : null;
    const fingerprint = hash ? `${width}x${height}:` + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("") : "";
    const base = wrapOrbitPixels(crop, map);
    let overlay: OrbitSurface | null = null, warning = "";
    const a = entry.review.analysis;
    if (a) try {
      if (a.width !== width || a.height !== height) throw new Error("La selección guardada no coincide con esta copia de la foto.");
      const result = await classifyTrunkColors(rgba, width, height, entry.review.outline, entry.review.config, signal, "lichen-only");
      if (result.counts.some((n, i) => n !== a.counts[i])) throw new Error("La selección guardada no coincide con esta copia de la foto.");
      const marked = new Uint8ClampedArray(rgba.length);
      result.labels.forEach((code, i) => { if (code >= 3) marked.set(ORBIT_HIGHLIGHT, i * 4); });
      const mask = cropTrunkPixels(marked, width, height, entry.review.outline);
      overlay = wrapOrbitPixels(mask, map);
    } catch (error) {
      checkAbort(signal);
      warning = (error instanceof Error ? error.message : "No se pudo mostrar la selección.") + " Se muestra solo el tronco; el análisis guardado no cambia.";
    }
    checkAbort(signal);
    return { photo: base, overlay, profile: map.profile, aspect: map.aspect, fingerprint, warning };
  }
  finally { canvas.width = 0; canvas.height = 0; photo.src = ""; }
}

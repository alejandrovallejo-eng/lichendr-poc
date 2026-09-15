import type { GuidedReview } from "./guided-flow";
import { DIRECTIONS, type Direction } from "./types";
import { rasterizeTrunk, type TrunkPoint } from "../region-suggestions/trunk-outline";
import { classifyTrunkColors, colorWorkingSize, OVERLAY_RGB } from "../region-suggestions/trunk-colors";

export type OrbitEntry = { src: string; review: GuidedReview | null };
export type OrbitTexture = { photo: string; overlay: string; fingerprint: string; warning: string };
export const normalizeRotation = (angle: number) => ((angle % 360) + 360) % 360;
export const orbitDirection = (rotation: number): Direction => DIRECTIONS[Math.round(normalizeRotation(-rotation) / 90) % 4];
export const directionRotation = (direction: Direction) => -90 * DIRECTIONS.indexOf(direction);

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
async function pngUrl(pixels: Uint8ClampedArray, width: number, height: number, signal: AbortSignal) {
  checkAbort(signal);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Tu navegador no pudo preparar el recorte.");
    const image = ctx.createImageData(width, height); image.data.set(pixels); ctx.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("No se pudo preparar el recorte.")), "image/png"));
    checkAbort(signal); return URL.createObjectURL(blob);
  } finally { canvas.width = 0; canvas.height = 0; }
}

// Local rendering only: no fetch, model inference, storage writes or new
// measurement. Overlay is reconstructed from saved settings and must match
// every saved count before it can be displayed.
export async function prepareOrbitTexture(entry: OrbitEntry, signal: AbortSignal): Promise<OrbitTexture> {
  if (!entry.src || !entry.review?.savedAt || !entry.review.outline.length) throw new Error("Falta una foto con contorno guardado.");
  const urls: string[] = [];
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
    // Exact decoded-image duplicate warning, independent of different outlines.
    const hash = globalThis.crypto?.subtle ? await crypto.subtle.digest("SHA-256", new Uint8Array(rgba)) : null;
    const fingerprint = hash ? `${width}x${height}:` + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("") : "";
    const base = await pngUrl(crop.pixels, crop.width, crop.height, signal); urls.push(base);
    let overlay = "", warning = "";
    const a = entry.review.analysis;
    if (a) try {
      if (a.width !== width || a.height !== height) throw new Error("La selección guardada no coincide con esta copia de la foto.");
      const result = await classifyTrunkColors(rgba, width, height, entry.review.outline, entry.review.config, signal, "lichen-only");
      if (result.counts.some((n, i) => n !== a.counts[i])) throw new Error("La selección guardada no coincide con esta copia de la foto.");
      const marked = new Uint8ClampedArray(rgba.length);
      result.labels.forEach((code, i) => { if (code >= 3) marked.set([...OVERLAY_RGB[code - 1], 150], i * 4); });
      const mask = cropTrunkPixels(marked, width, height, entry.review.outline);
      overlay = await pngUrl(mask.pixels, mask.width, mask.height, signal); urls.push(overlay);
    } catch (error) {
      checkAbort(signal);
      warning = (error instanceof Error ? error.message : "No se pudo mostrar la selección.") + " Se muestra solo el tronco; el análisis guardado no cambia.";
    }
    checkAbort(signal);
    return { photo: base, overlay, fingerprint, warning };
  } catch (error) { urls.forEach(url => URL.revokeObjectURL(url)); throw error; }
  finally { canvas.width = 0; canvas.height = 0; photo.src = ""; }
}

export function releaseOrbitTexture(texture: OrbitTexture) {
  if (texture.photo) URL.revokeObjectURL(texture.photo);
  if (texture.overlay) URL.revokeObjectURL(texture.overlay);
}

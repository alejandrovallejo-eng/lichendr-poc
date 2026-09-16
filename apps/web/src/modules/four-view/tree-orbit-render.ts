import { DIRECTIONS, type Direction } from "./types";

export type OrbitSurface = { pixels: Uint8ClampedArray; width: number; height: number };
export type OrbitSkin = { photo: OrbitSurface; overlay: OrbitSurface | null; profile: Float32Array; aspect: number };
export type OrbitWrapMap = { width: number; height: number; indices: Int32Array; profile: Float32Array; aspect: number };
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const median = (values: number[]) => values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] : 1;

// Presentation only: straighten each occupied row between the saved trunk edges.
// The same source-index map is used for the photo AND its verified overlay.
// Interior holes and empty rows remain empty, even for a concave outline.
export function buildOrbitWrapMap(source: OrbitSurface, targetWidth = 256): OrbitWrapMap {
  const { pixels, width, height } = source;
  if (pixels.length !== width * height * 4 || width < 1 || height < 1 || targetWidth < 1 || !Number.isInteger(targetWidth)) throw new Error("Recorte inválido.");
  const indices = new Int32Array(targetWidth * height).fill(-1);
  const spans = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let left = width, right = -1;
    for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3]) { left = Math.min(left, x); right = x; }
    if (right < left) continue;
    const span = right - left + 1; spans[y] = span;
    for (let x = 0; x < targetWidth; x++) {
      const from = y * width + left + Math.min(span - 1, Math.floor((x + .5) * span / targetWidth));
      if (pixels[from * 4 + 3]) indices[y * targetWidth + x] = from;
    }
  }
  const typical = median(Array.from(spans).filter(n => n > 0));
  const profile = new Float32Array(height), window = Math.max(1, Math.round(height * .035));
  for (let y = 0; y < height; y++) {
    let sum = 0, count = 0;
    for (let i = Math.max(0, y - window); i <= Math.min(height - 1, y + window); i++) if (spans[i]) { sum += spans[i]; count++; }
    // Mild smoothing, not a reconstruction of the real tree's geometry.
    profile[y] = clamp(count ? sum / count / typical : 1, .8, 1.2);
  }
  return { width: targetWidth, height, indices, profile, aspect: typical / height };
}

export function wrapOrbitPixels(source: OrbitSurface, map: OrbitWrapMap): OrbitSurface {
  const pixels = new Uint8ClampedArray(map.width * map.height * 4);
  for (let i = 0; i < map.indices.length; i++) {
    const from = map.indices[i];
    if (from >= 0) pixels.set(source.pixels.subarray(from * 4, from * 4 + 4), i * 4);
  }
  return { pixels, width: map.width, height: map.height };
}

function sample(surface: OrbitSurface, u: number, v: number) {
  return (Math.min(surface.height - 1, Math.floor(v * surface.height)) * surface.width + Math.min(surface.width - 1, Math.floor(u * surface.width))) * 4;
}

// Small CPU-only renderer. No dependencies, synthetic bark, network requests,
// continuous animation loop, or analytical outputs. Unobserved pixels stay grey.
export function renderOrbitPixels(textures: Record<Direction, OrbitSkin | null>, rotation: number, marked: boolean, width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const available = DIRECTIONS.map(d => textures[d]).filter((t): t is OrbitSkin => t !== null);
  const trunkHeight = height * .83, top = (height - trunkHeight) / 2;
  const radius = trunkHeight * clamp(median(available.map(t => t.aspect)), .27, .42) / 2;
  for (let y = Math.ceil(top); y < top + trunkHeight; y++) {
    const v = clamp((y - top) / trunkHeight, 0, .999999);
    const profile = available.length ? available.reduce((sum, t) => sum + t.profile[Math.min(t.profile.length - 1, Math.floor(v * t.profile.length))], 0) / available.length : 1;
    const rowRadius = radius * (1 + (profile - 1) * .35) * (.94 + .1 * v + .035 * v ** 8);
    for (let x = Math.ceil(width / 2 - rowRadius); x < width / 2 + rowRadius; x++) {
      if (x < 0 || x >= width) continue;
      const normal = clamp((x + .5 - width / 2) / rowRadius, -1, 1);
      const theta = Math.asin(normal);
      const angle = ((theta * 180 / Math.PI - rotation + 45) % 360 + 360) % 360;
      const sector = Math.floor(angle / 90), u = angle / 90 - sector;
      const skin = textures[DIRECTIONS[sector]], dest = (y * width + x) * 4;
      const source = skin ? sample(skin.photo, u, v) : 0;
      const valid = Boolean(skin?.photo.pixels[source + 3]);
      if (!valid || !skin) {
        const hatch = (x + y) % 12 < 3 ? 168 : 188;
        pixels.set([hatch, hatch + 9, hatch + 3, 255], dest);
        continue;
      }
      const rgb = [skin.photo.pixels[source], skin.photo.pixels[source + 1], skin.photo.pixels[source + 2]];
      // Preserve photographed RGB: no angle-dependent lighting or cross-photo
      // colour blending. Volume comes from projection/silhouette, not tinting.
      const overlay = marked ? skin.overlay : null;
      const mark = overlay ? sample(overlay, u, v) : 0;
      const alpha = overlay ? overlay.pixels[mark + 3] / 255 : 0;
      for (let c = 0; c < 3; c++) pixels[dest + c] = rgb[c] * (1 - alpha) + (overlay ? overlay.pixels[mark + c] * alpha : 0);
      pixels[dest + 3] = 255 * Math.min(1, rowRadius * (1 - Math.abs(normal)));
    }
  }
  return pixels;
}

// Real mask editing.
//
// "Editing a mask" has to change pixels, not a boolean: what the reviewer paints
// is what is later counted, so the edited mask replaces the proposed one and the
// `maskEdited` flag is derived from an actual pixel difference.

export interface BrushStroke {
  // Centre of the brush in mask coordinates.
  x: number;
  y: number;
  radius: number;
  // `add` paints the region, `erase` removes it.
  mode: "add" | "erase";
}

export function applyBrush(
  mask: Uint8Array,
  width: number,
  height: number,
  stroke: BrushStroke,
): Uint8Array {
  if (mask.length !== width * height) {
    throw new Error("La máscara no coincide con las dimensiones indicadas.");
  }
  if (!Number.isFinite(stroke.x) || !Number.isFinite(stroke.y) || !(stroke.radius > 0)) {
    throw new Error("El trazo del pincel no es válido.");
  }
  const value = stroke.mode === "add" ? 1 : 0;
  const next = Uint8Array.from(mask);
  const radius = Math.min(stroke.radius, Math.max(width, height));
  const radiusSquared = radius * radius;
  const minX = Math.max(0, Math.floor(stroke.x - radius));
  const maxX = Math.min(width - 1, Math.ceil(stroke.x + radius));
  const minY = Math.max(0, Math.floor(stroke.y - radius));
  const maxY = Math.min(height - 1, Math.ceil(stroke.y + radius));
  for (let y = minY; y <= maxY; y += 1) {
    const dy = y - stroke.y;
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - stroke.x;
      if (dx * dx + dy * dy <= radiusSquared) next[y * width + x] = value;
    }
  }
  return next;
}

export function masksEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if ((left[index] === 0) !== (right[index] === 0)) return false;
  }
  return true;
}

// How the region is carried inside the decoded RGBA pixels. This is a CONTRACT
// with whoever produced the image, not something to guess from the file
// extension: a PNG can carry the mask either way.
//
// * `alpha`: the region is the opaque part (an RGBA mask with transparency).
// * `grayscale`: the image is opaque everywhere and the region is the WHITE
//   part. This is what `services/vision` sends: `_mask_to_png_data_url` writes a
//   PIL `mode="L"` PNG with 0 for background and 255 for the region. Reading its
//   alpha channel would mark every pixel as region, turn every mask into the
//   whole photograph and collapse them all into one.
export type MaskEncoding = "alpha" | "grayscale";

// Turns a decoded RGBA mask image into a binary mask.
export function maskFromRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: { encoding?: MaskEncoding; alphaThreshold?: number; lumaThreshold?: number } = {},
): Uint8Array {
  if (data.length !== width * height * 4) {
    throw new Error("Los píxeles de la máscara no coinciden con sus dimensiones.");
  }
  // Default `alpha` keeps every existing caller reading exactly as before.
  const encoding: MaskEncoding = options.encoding ?? "alpha";
  const alphaThreshold = options.alphaThreshold ?? 8;
  const lumaThreshold = options.lumaThreshold ?? 128;
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    const opaque = data[index * 4 + 3] >= alphaThreshold;
    if (encoding === "grayscale") {
      // Opaque AND white: an opaque black pixel is background, not region.
      mask[index] = opaque && data[index * 4] >= lumaThreshold ? 1 : 0;
    } else {
      mask[index] = opaque ? 1 : 0;
    }
  }
  return mask;
}

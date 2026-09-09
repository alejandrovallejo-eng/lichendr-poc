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

// Turns a decoded RGBA mask image into a binary mask. MobileSAM returns the
// mask as a PNG, so the alpha channel carries the region.
export function maskFromRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  alphaThreshold = 8,
): Uint8Array {
  if (data.length !== width * height * 4) {
    throw new Error("Los píxeles de la máscara no coinciden con sus dimensiones.");
  }
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = data[index * 4 + 3] >= alphaThreshold ? 1 : 0;
  }
  return mask;
}

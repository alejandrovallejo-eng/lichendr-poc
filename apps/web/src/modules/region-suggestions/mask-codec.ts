// Compact, serialisable representation of a binary mask.
//
// The masks MobileSAM proposes are real pixels, not boxes: they have to survive
// state updates, a page reload and the review of a whole series. A dense
// Uint8Array per region is too heavy for storage, so masks travel run-length
// encoded and are decoded only to draw, edit or measure them.
//
// Format: `"<width>:<height>:<run>,<run>,..."` where runs alternate starting
// with background, exactly like a binary RLE. The sum of the runs must equal
// width * height, so a truncated or corrupted value is rejected instead of
// silently producing a wrong mask (and therefore a wrong coverage).

export interface DecodedMask {
  mask: Uint8Array;
  width: number;
  height: number;
}

export function encodeMaskRle(mask: Uint8Array, width: number, height: number): string {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Las dimensiones de la máscara no son válidas.");
  }
  if (mask.length !== width * height) {
    throw new Error("La máscara no coincide con las dimensiones indicadas.");
  }
  const runs: number[] = [];
  let current = 0;
  let run = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const value = mask[index] === 0 ? 0 : 1;
    if (value === current) {
      run += 1;
    } else {
      runs.push(run);
      current = value;
      run = 1;
    }
  }
  runs.push(run);
  return `${width}:${height}:${runs.join(",")}`;
}

export function decodeMaskRle(encoded: string): DecodedMask {
  const parts = encoded.split(":");
  if (parts.length !== 3) throw new Error("La máscara codificada no es válida.");
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Las dimensiones de la máscara codificada no son válidas.");
  }
  const total = width * height;
  const mask = new Uint8Array(total);
  let position = 0;
  let value = 0;
  for (const chunk of parts[2].split(",")) {
    const run = Number(chunk);
    if (!Number.isSafeInteger(run) || run < 0) throw new Error("La máscara codificada no es válida.");
    if (position + run > total) throw new Error("La máscara codificada excede sus dimensiones.");
    if (value === 1) mask.fill(1, position, position + run);
    position += run;
    value = value === 0 ? 1 : 0;
  }
  if (position !== total) throw new Error("La máscara codificada está incompleta.");
  return { mask, width, height };
}

export function maskArea(mask: Uint8Array): number {
  let area = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 0) area += 1;
  }
  return area;
}

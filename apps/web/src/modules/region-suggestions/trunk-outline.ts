// Normalized, image-relative geometry. No EXIF rotation or display-size storage.
export interface TrunkPoint { x: number; y: number }
export const MAX_TRUNK_POINTS = 64;

const cross = (a: TrunkPoint, b: TrunkPoint, c: TrunkPoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function onSegment(a: TrunkPoint, b: TrunkPoint, c: TrunkPoint): boolean {
  return Math.abs(cross(a, b, c)) < 1e-10 && c.x >= Math.min(a.x, b.x) - 1e-10
    && c.x <= Math.max(a.x, b.x) + 1e-10 && c.y >= Math.min(a.y, b.y) - 1e-10
    && c.y <= Math.max(a.y, b.y) + 1e-10;
}
function intersects(a: TrunkPoint, b: TrunkPoint, c: TrunkPoint, d: TrunkPoint): boolean {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
export function trunkOutlineError(points: readonly TrunkPoint[]): string | null {
  if (points.length < 3) return "Añade al menos tres puntos alrededor del tronco.";
  if (points.length > MAX_TRUNK_POINTS) return `Usa como máximo ${MAX_TRUNK_POINTS} puntos.`;
  if (points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)
    || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return "Todos los puntos deben estar dentro de la fotografía.";
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    if (Math.hypot(points[i].x - points[next].x, points[i].y - points[next].y) < 1e-6)
      return "Hay puntos repetidos. Elimina uno o sepáralos.";
    for (let j = i + 1; j < points.length; j++) {
      if (j === next || (j + 1) % points.length === i) continue;
      if (intersects(points[i], points[next], points[j], points[(j + 1) % points.length]))
        return "Los bordes se cruzan. Mueve un punto para corregir el contorno.";
    }
  }
  const area = Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0)) / 2;
  return area < 0.00001 ? "El contorno es demasiado pequeño o está sobre una línea." : null;
}

// Pixel-centre scanline fill. Concavities are preserved, not replaced by a box.
export function rasterizeTrunk(points: readonly TrunkPoint[], width: number, height: number): Uint8Array {
  const error = trunkOutlineError(points);
  if (error) throw new Error(error);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width * height > 4_194_304) throw new Error("Dimensiones de tronco no válidas.");
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const scan = (y + 0.5) / height;
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length];
      if ((p.y > scan) !== (q.y > scan)) xs.push(p.x + (scan - p.y) * (q.x - p.x) / (q.y - p.y));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const start = Math.max(0, Math.ceil(xs[i] * width - 0.5));
      const end = Math.min(width, Math.ceil(xs[i + 1] * width - 0.5));
      mask.fill(1, y * width + start, y * width + end);
    }
  }
  return mask;
}

// Five occupied rows, three points per row: bounded cost, includes the trunk's
// centre, and EVERY prompt is inside the confirmed polygon, including concavity.
export function trunkPromptPoints(mask: Uint8Array, width: number, height: number): TrunkPoint[] {
  if (mask.length !== width * height) throw new Error("La máscara del tronco no coincide con la fotografía.");
  const occupiedRows: number[] = [];
  for (let y = 0; y < height; y++) if (mask.subarray(y * width, (y + 1) * width).some(Boolean)) occupiedRows.push(y);
  const points: TrunkPoint[] = [];
  const seen = new Set<number>();
  for (let row = 0; row < 5 && occupiedRows.length; row++) {
    const y = occupiedRows[Math.min(occupiedRows.length - 1, Math.floor((row + 0.5) / 5 * occupiedRows.length))];
    const xs: number[] = [];
    for (let x = 0; x < width; x++) if (mask[y * width + x]) xs.push(x);
    for (let col = 0; col < 3; col++) {
      const x = xs[Math.min(xs.length - 1, Math.floor((col + 0.5) / 3 * xs.length))];
      if (seen.has(y * width + x)) continue;
      seen.add(y * width + x);
      points.push({ x: (x + 0.5) / width, y: (y + 0.5) / height });
    }
  }
  return points;
}

export function clipToTrunk(mask: Uint8Array, trunk: Uint8Array): Uint8Array {
  if (mask.length !== trunk.length) throw new Error("Las máscaras no tienen las mismas dimensiones.");
  return mask.map((value, i) => value && trunk[i] ? 1 : 0);
}

// Kept separately from asynchronous classifier batches: a late response cannot
// overwrite a confirmed outline. Same owner/tree/view/image isolation as batches.
export function trunkStorageKey(identity: { ownerId: string; treeSampleId: string; direction: string; imageId: string }): string {
  if (Object.values(identity).some(value => !value)) throw new Error("Falta el contexto de la fotografía.");
  return `lichendr:trunk-outline:${identity.ownerId}:${identity.treeSampleId}:${identity.direction}:${identity.imageId}`;
}
export function parseTrunkOutline(raw: string | null): TrunkPoint[] | null {
  try {
    if (!raw || raw.length > 32768) return null;
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !Array.isArray(value.points) || trunkOutlineError(value.points)) return null;
    return value.points.map((p: TrunkPoint) => ({ x: p.x, y: p.y }));
  } catch { return null; }
}

import type { CornerPoint } from "./types";

export type ManualMeasurementMode = "manual_confirmed" | "manual_assisted_provisional";

export const CORNER_LABELS = [
  "Superior izquierda",
  "Superior derecha",
  "Inferior derecha",
  "Inferior izquierda",
] as const;

export function defaultManualCorners(width: number, height: number): CornerPoint[] {
  const heightSpan = 0.8;
  const widthSpan = Math.min(0.72, Math.max(0.12, heightSpan * height / Math.max(width, 1) / 5));
  const left = (1 - widthSpan) / 2;
  const right = 1 - left;
  return [
    { x: left, y: 0.1 },
    { x: right, y: 0.1 },
    { x: right, y: 0.9 },
    { x: left, y: 0.9 },
  ];
}

export function cornerGeometryError(
  corners: readonly CornerPoint[] | null,
  width: number,
  height: number,
): string | null {
  if (!corners || corners.length !== 4) return "Debes colocar exactamente cuatro puntos.";
  if (width <= 0 || height <= 0) return "No se conocen las dimensiones de la imagen.";
  if (corners.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1)) {
    return "Los cuatro puntos deben quedar dentro de la imagen.";
  }

  const points = corners.map(({ x, y }) => ({ x: x * (width - 1), y: y * (height - 1) }));
  const crossProducts = points.map((point, index) => {
    const next = points[(index + 1) % 4];
    const after = points[(index + 2) % 4];
    return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
  });
  if (crossProducts.some((value) => Math.abs(value) < 1e-3)
      || !(crossProducts.every((value) => value > 0) || crossProducts.every((value) => value < 0))) {
    return "Los puntos deben formar un cuadrilátero convexo y sin cruces.";
  }

  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  if (topLeft.x >= topRight.x || bottomLeft.x >= bottomRight.x
      || (topLeft.y + topRight.y) / 2 >= (bottomLeft.y + bottomRight.y) / 2) {
    return "Respeta el orden: superior izquierda, superior derecha, inferior derecha e inferior izquierda.";
  }

  const area = Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % 4];
    return sum + point.x * next.y - point.y * next.x;
  }, 0) / 2);
  if (area < Math.max(2500, width * height * 0.005)) return "El área seleccionada es demasiado pequeña.";

  const length = (first: CornerPoint, second: CornerPoint) => Math.hypot(
    (second.x - first.x) * (width - 1),
    (second.y - first.y) * (height - 1),
  );
  const top = length(corners[0], corners[1]);
  const right = length(corners[1], corners[2]);
  const bottom = length(corners[3], corners[2]);
  const left = length(corners[0], corners[3]);
  const ratio = (left + right) / Math.max(top + bottom, 1e-6);
  if (ratio < 2.5 || ratio > 8) return "La selección debe corresponder a la abertura física de proporción 1:5.";
  if (Math.min(top, bottom) / Math.max(top, bottom) < 0.3
      || Math.min(left, right) / Math.max(left, right) < 0.3) {
    return "La perspectiva de la selección no es geométricamente segura.";
  }
  return null;
}

export class ManualOperationGate {
  private readonly active = new Map<string, string>();
  private sequence = 0;

  begin(key: string): string | null {
    if (this.active.has(key)) return null;
    const token = `${key}:${++this.sequence}`;
    this.active.set(key, token);
    return token;
  }

  isCurrent(key: string, token: string): boolean {
    return this.active.get(key) === token;
  }

  invalidate(key: string): void {
    this.active.delete(key);
  }

  finish(key: string, token: string): void {
    if (this.isCurrent(key, token)) this.active.delete(key);
  }
}

export async function runManualOperation<Result>(input: {
  gate: ManualOperationGate;
  key: string;
  request: () => Promise<Result>;
  onStart: (token: string) => void;
  onSuccess: (result: Result, token: string) => Promise<void> | void;
  onError: (error: Error) => void;
}): Promise<"success" | "error" | "duplicate" | "stale"> {
  const token = input.gate.begin(input.key);
  if (!token) return "duplicate";
  input.onStart(token);
  try {
    const result = await input.request();
    if (!input.gate.isCurrent(input.key, token)) return "stale";
    await input.onSuccess(result, token);
    return input.gate.isCurrent(input.key, token) ? "success" : "stale";
  } catch (reason) {
    if (!input.gate.isCurrent(input.key, token)) return "stale";
    input.onError(reason instanceof Error ? reason : new Error("No se pudo analizar el área confirmada."));
    return "error";
  } finally {
    input.gate.finish(input.key, token);
  }
}

// MobileSAM region proposals through the existing vision service.
//
// The pilot uses the SAME MobileSAM (`vit_t`) that already segments in this
// project, via the existing `/api/vision/prepare`, `/api/vision/segment` and
// `/api/vision/sessions/:id` routes. It deliberately does NOT use the in-browser
// SlimSAM of `modules/vision-lab`, which is a different, smaller model: the
// pilot must propose regions with MobileSAM as documented.
//
// The masks returned by the service are real pixels and are kept as such; only
// their resolution is reduced to a bounded working grid so a whole series can be
// reviewed, edited and measured in the browser.

import { maskFromRgba } from "./mask-edit";

export const MAX_WORKING_SIDE = 1024;

export interface SegmentationSession {
  sessionId: string;
  width: number;
  height: number;
}

export interface ServiceCandidate {
  id: string;
  score: number;
  maskDataUrl: string;
  width: number;
  height: number;
  areaPixels: number;
  modelName?: string;
  modelVersion?: string;
}

export class SegmentationServiceError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SegmentationServiceError";
    this.status = status;
  }
}

// Working grid: bounded so masks, union and coverage stay affordable in the
// browser, while keeping the aspect ratio of the photograph.
export function workingSize(
  width: number,
  height: number,
  maxSide = MAX_WORKING_SIDE,
): { width: number; height: number; scale: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Las dimensiones de la imagen no son válidas.");
  }
  const longest = Math.max(width, height);
  const scale = longest <= maxSide ? 1 : maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

// MobileSAM returns three candidates per prompt; the pilot keeps the highest
// scoring non-empty one. The score measures mask quality, never lichen.
export function pickBestCandidate(
  candidates: readonly ServiceCandidate[],
  recommendedIndex: number,
): ServiceCandidate | null {
  const usable = candidates.filter((candidate) => candidate.areaPixels > 0);
  if (usable.length === 0) return null;
  const recommended = candidates[recommendedIndex];
  if (recommended && recommended.areaPixels > 0) return recommended;
  return usable.reduce((best, candidate) => (candidate.score > best.score ? candidate : best));
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function prepareSegmentationSession(
  file: File,
  signal?: AbortSignal,
): Promise<SegmentationSession> {
  const body = new FormData();
  body.append("image", file);
  const response = await fetch("/api/vision/prepare", { method: "POST", body, signal });
  const payload = await readJson(response);
  if (!response.ok || typeof payload.sessionId !== "string") {
    throw new SegmentationServiceError(
      "MobileSAM no pudo preparar la fotografía. Tus fotografías y revisiones se conservan.",
      response.status,
    );
  }
  const width = Number(payload.width);
  const height = Number(payload.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new SegmentationServiceError("MobileSAM devolvió dimensiones inválidas.", response.status);
  }
  return { sessionId: payload.sessionId, width, height };
}

export async function segmentAtPoint(
  sessionId: string,
  point: { x: number; y: number },
  signal?: AbortSignal,
): Promise<{ candidates: ServiceCandidate[]; recommendedIndex: number }> {
  const response = await fetch("/api/vision/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, points: [{ x: point.x, y: point.y, label: 1 }] }),
    signal,
  });
  const payload = await readJson(response);
  if (!response.ok || !Array.isArray(payload.candidates)) {
    throw new SegmentationServiceError(
      "MobileSAM no pudo proponer regiones en esta vista.",
      response.status,
    );
  }
  const recommendedIndex = Number(payload.recommendedIndex);
  return {
    candidates: payload.candidates as ServiceCandidate[],
    recommendedIndex: Number.isSafeInteger(recommendedIndex) ? recommendedIndex : 0,
  };
}

export async function releaseSegmentationSession(sessionId: string): Promise<void> {
  try {
    await fetch(`/api/vision/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  } catch {
    // The service expires its own sessions; a failure here is not a review error.
  }
}

// Decodes the mask PNG the service returns and rasterises it onto the working
// grid, preserving the real region instead of its bounding box.
export async function decodeMaskToWorkingGrid(
  maskDataUrl: string,
  workingWidth: number,
  workingHeight: number,
): Promise<Uint8Array> {
  if (!maskDataUrl.startsWith("data:image/")) {
    throw new Error("La máscara recibida no es una imagen embebida.");
  }
  const bitmap = await createImageBitmap(await (await fetch(maskDataUrl)).blob());
  try {
    const canvas = new OffscreenCanvas(workingWidth, workingHeight);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No se pudo preparar el lienzo de la máscara.");
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, workingWidth, workingHeight);
    context.drawImage(bitmap, 0, 0, workingWidth, workingHeight);
    const image = context.getImageData(0, 0, workingWidth, workingHeight);
    return maskFromRgba(image.data, workingWidth, workingHeight);
  } finally {
    bitmap.close();
  }
}

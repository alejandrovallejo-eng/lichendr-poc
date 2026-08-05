/// <reference lib="webworker" />

import type {
  ColorPaletteCandidate,
  ColorWorkerRequest,
  ColorWorkerResponse,
  SimilarColorComponent,
} from "./color-worker-types";

let imageWidth = 0;
let imageHeight = 0;
let imageRgba: Uint8ClampedArray | null = null;
let scopeMask: Uint8Array | null = null;
let componentLabels: Int32Array | null = null;
let retainedComponents: SimilarColorComponent[] = [];
let latestRequestId = 0;

const MAX_DIMENSION = 1024;
const MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION;
const MAX_PALETTE_SAMPLES = 60_000;
const MAX_PALETTE_BUCKETS = 512;
const MAX_FINAL_COLORS = 10;
const MAX_COMPONENTS = 256;
const MIN_COMPONENT_AREA = 16;

function post(response: ColorWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, transfer);
}

function postProgress(requestId: number, stage: Extract<ColorWorkerResponse, { type: "progress" }>["stage"]): void {
  if (!isStale(requestId)) post({ type: "progress", requestId, stage });
}

function postError(
  requestId: number,
  code: Extract<ColorWorkerResponse, { type: "error" }>["code"],
  message: string,
): void {
  post({ type: "error", requestId, code, message, recoverable: true });
}

function srgbChannelToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(red: number, green: number, blue: number): [number, number, number] {
  const r = srgbChannelToLinear(red);
  const g = srgbChannelToLinear(green);
  const b = srgbChannelToLinear(blue);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / 1;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const transform = (value: number) => value > 216 / 24389
    ? Math.cbrt(value)
    : (841 / 108) * value + 4 / 29;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE76(left: [number, number, number], right: [number, number, number]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

async function yieldToMessages(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function isStale(requestId: number): boolean {
  return requestId !== latestRequestId;
}

interface PaletteGroup {
  count: number;
  red: number;
  green: number;
  blue: number;
  x: number;
  y: number;
}

async function buildPalette(
  requestId: number,
  maximumColors: number,
  minimumPercentage: number,
): Promise<void> {
  const rgba = imageRgba;
  const scope = scopeMask;
  if (!rgba || !scope || imageWidth <= 0 || imageHeight <= 0) {
    postError(requestId, "not-configured", "La imagen de trabajo no está preparada.");
    return;
  }

  let scopedPixels = 0;
  for (let index = 0; index < scope.length; index += 1) {
    if (scope[index] !== 0) scopedPixels += 1;
    if (index > 0 && index % 131072 === 0) {
      await yieldToMessages();
      if (isStale(requestId)) return;
    }
  }
  if (scopedPixels === 0) {
    post({ type: "palette", requestId, candidates: [] });
    return;
  }

  postProgress(requestId, "comparing-colors");
  const stride = Math.max(1, Math.ceil(Math.sqrt(scopedPixels / MAX_PALETTE_SAMPLES)));
  const buckets = new Map<string, PaletteGroup>();
  let sampledPixels = 0;
  outer: for (let y = 0; y < imageHeight; y += stride) {
    for (let x = 0; x < imageWidth; x += stride) {
      const index = y * imageWidth + x;
      if (scope[index] === 0) continue;
      const rgbaIndex = index * 4;
      const red = rgba[rgbaIndex];
      const green = rgba[rgbaIndex + 1];
      const blue = rgba[rgbaIndex + 2];
      const [lightness, a, b] = rgbToLab(red, green, blue);
      const key = `${Math.round(lightness / 8)}:${Math.round(a / 12)}:${Math.round(b / 12)}`;
      const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0, x: 0, y: 0 };
      bucket.count += 1;
      bucket.red += red;
      bucket.green += green;
      bucket.blue += blue;
      bucket.x += x;
      bucket.y += y;
      buckets.set(key, bucket);
      sampledPixels += 1;
      if (sampledPixels >= MAX_PALETTE_SAMPLES) break outer;
    }
    if (y % (stride * 32) === 0) {
      await yieldToMessages();
      if (isStale(requestId)) return;
    }
  }

  if (sampledPixels === 0 || isStale(requestId)) {
    if (!isStale(requestId)) post({ type: "palette", requestId, candidates: [] });
    return;
  }
  postProgress(requestId, "grouping-regions");
  const merged: PaletteGroup[] = [];
  const sortedBuckets = [...buckets.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, MAX_PALETTE_BUCKETS);
  for (let bucketIndex = 0; bucketIndex < sortedBuckets.length; bucketIndex += 1) {
    const bucket = sortedBuckets[bucketIndex];
    const bucketRgb: [number, number, number] = [
      bucket.red / bucket.count,
      bucket.green / bucket.count,
      bucket.blue / bucket.count,
    ];
    const bucketLab = rgbToLab(...bucketRgb);
    const close = merged.find((group) => {
      const groupLab = rgbToLab(group.red / group.count, group.green / group.count, group.blue / group.count);
      return deltaE76(bucketLab, groupLab) < 10;
    });
    if (close) {
      close.count += bucket.count;
      close.red += bucket.red;
      close.green += bucket.green;
      close.blue += bucket.blue;
      close.x += bucket.x;
      close.y += bucket.y;
    } else {
      merged.push({ ...bucket });
    }
    if (bucketIndex > 0 && bucketIndex % 64 === 0) {
      await yieldToMessages();
      if (isStale(requestId)) return;
    }
  }

  postProgress(requestId, "preparing-results");
  const candidates: ColorPaletteCandidate[] = merged
    .filter((group) => group.count / sampledPixels * 100 >= minimumPercentage)
    .sort((left, right) => right.count - left.count)
    .slice(0, Math.max(1, Math.min(MAX_FINAL_COLORS, maximumColors)))
    .map((group, index) => ({
      id: index + 1,
      rgb: [
        Math.round(group.red / group.count),
        Math.round(group.green / group.count),
        Math.round(group.blue / group.count),
      ],
      percentage: group.count / sampledPixels * 100,
      centroidX: group.x / group.count / imageWidth,
      centroidY: group.y / group.count / imageHeight,
    }));
  post({ type: "palette", requestId, candidates });
}

async function selectSimilarColors(
  requestId: number,
  sampleRgb: [number, number, number],
  toleranceDeltaE: number,
  minimumArea: number,
): Promise<void> {
  const rgba = imageRgba;
  const scope = scopeMask;
  if (!rgba || !scope || imageWidth <= 0 || imageHeight <= 0) {
    postError(requestId, "not-configured", "La imagen de trabajo no está preparada.");
    return;
  }

  const pixelCount = imageWidth * imageHeight;
  const matches = new Uint8Array(pixelCount);
  const sampleLab = rgbToLab(sampleRgb[0], sampleRgb[1], sampleRgb[2]);
  postProgress(requestId, "comparing-colors");
  for (let y = 0; y < imageHeight; y += 1) {
    const rowOffset = y * imageWidth;
    for (let x = 0; x < imageWidth; x += 1) {
      const pixelIndex = rowOffset + x;
      if (scope[pixelIndex] === 0) continue;
      const rgbaIndex = pixelIndex * 4;
      const pixelLab = rgbToLab(rgba[rgbaIndex], rgba[rgbaIndex + 1], rgba[rgbaIndex + 2]);
      if (deltaE76(sampleLab, pixelLab) <= toleranceDeltaE) matches[pixelIndex] = 1;
    }
    if (y % 32 === 0) {
      await yieldToMessages();
      if (isStale(requestId)) return;
    }
  }

  const labels = new Int32Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components: SimilarColorComponent[] = [];
  const effectiveMinimumArea = Math.max(MIN_COMPONENT_AREA, Math.floor(minimumArea));
  let nextLabel = 1;
  postProgress(requestId, "grouping-regions");
  for (let start = 0; start < pixelCount; start += 1) {
    if (start > 0 && start % 32768 === 0) {
      await yieldToMessages();
      if (isStale(requestId)) return;
    }
    if (matches[start] === 0 || labels[start] !== 0) continue;
    let read = 0;
    let write = 1;
    let sumX = start % imageWidth;
    let sumY = Math.floor(start / imageWidth);
    queue[0] = start;
    labels[start] = nextLabel;
    while (read < write) {
      const current = queue[read];
      read += 1;
      const x = current % imageWidth;
      const neighbors = [
        current - imageWidth,
        current + imageWidth,
        x > 0 ? current - 1 : -1,
        x + 1 < imageWidth ? current + 1 : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= pixelCount || matches[neighbor] === 0 || labels[neighbor] !== 0) continue;
        labels[neighbor] = nextLabel;
        queue[write] = neighbor;
        write += 1;
        sumX += neighbor % imageWidth;
        sumY += Math.floor(neighbor / imageWidth);
      }
      if (read % 65536 === 0) {
        await yieldToMessages();
        if (isStale(requestId)) return;
      }
    }
    if (write >= effectiveMinimumArea && components.length < MAX_COMPONENTS) {
      components.push({
        id: nextLabel,
        areaPixels: write,
        centroidX: sumX / write / imageWidth,
        centroidY: sumY / write / imageHeight,
      });
      nextLabel += 1;
    } else {
      for (let queueIndex = 0; queueIndex < write; queueIndex += 1) {
        labels[queue[queueIndex]] = -1;
      }

    }
  }

  if (isStale(requestId)) return;
  componentLabels = labels;
  retainedComponents = components;
  postProgress(requestId, "preparing-results");
  await renderComponents(requestId, []);
}

async function renderComponents(requestId: number, excludedComponentIds: number[]): Promise<void> {
  const labels = componentLabels;
  if (!labels) {
    postError(requestId, "not-configured", "No hay componentes de color para actualizar.");
    return;
  }
  const excluded = new Set(excludedComponentIds);
  const output = new Uint8Array(labels.length);
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    if (label > 0 && !excluded.has(label)) output[index] = 1;
    if (index % 131072 === 0) {
      await yieldToMessages();
      if (isStale(requestId)) return;
    }
  }
  post(
    { type: "result", requestId, mask: output.buffer, components: retainedComponents },
    [output.buffer],
  );
}

function configure(request: Extract<ColorWorkerRequest, { type: "configure" }>): void {
  const { width, height } = request;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > MAX_DIMENSION
    || height > MAX_DIMENSION
    || width * height > MAX_PIXELS
  ) {
    throw new Error("Las dimensiones de la imagen no son válidas.");
  }
  const pixelCount = width * height;
  if (request.rgba.byteLength !== pixelCount * 4 || request.scopeMask.byteLength !== pixelCount) {
    throw new Error("Los píxeles o la máscara no coinciden con las dimensiones de la imagen.");
  }
  imageWidth = width;
  imageHeight = height;
  imageRgba = new Uint8ClampedArray(request.rgba);
  scopeMask = new Uint8Array(request.scopeMask);
  componentLabels = null;
  retainedComponents = [];
}

function validateSelect(request: Extract<ColorWorkerRequest, { type: "select" }>): void {
  if (
    request.sampleRgb.length !== 3
    || request.sampleRgb.some((value) => !Number.isFinite(value) || value < 0 || value > 255)
    || !Number.isFinite(request.toleranceDeltaE)
    || request.toleranceDeltaE <= 0
    || !Number.isFinite(request.minimumArea)
    || request.minimumArea <= 0
  ) {
    throw new Error("Los parámetros de selección de color no son válidos.");
  }
}

async function handleRequest(request: ColorWorkerRequest): Promise<void> {
  if (!Number.isSafeInteger(request.requestId) || request.requestId <= 0) {
    throw new Error("El identificador de análisis no es válido.");
  }
  if (request.requestId < latestRequestId) return;
  latestRequestId = request.requestId;
  if (request.type === "configure") {
    configure(request);
    return;
  }
  if (request.type === "cancel") return;
  if (request.type === "select") {
    validateSelect(request);
    await selectSimilarColors(
      request.requestId,
      request.sampleRgb,
      request.toleranceDeltaE,
      request.minimumArea,
    );
    return;
  }
  if (request.type === "palette") {
    await buildPalette(
      request.requestId,
      request.maximumColors,
      request.minimumPercentage,
    );
    return;
  }
  await renderComponents(request.requestId, request.excludedComponentIds.slice(0, MAX_COMPONENTS));
}

self.onmessage = (event: MessageEvent<ColorWorkerRequest>) => {
  const requestId = Number.isSafeInteger(event.data?.requestId) ? event.data.requestId : latestRequestId;
  void handleRequest(event.data).catch((reason: unknown) => {
    if (requestId !== latestRequestId) return;
    postError(
      requestId,
      reason instanceof Error && reason.message.includes("dimensiones")
        ? "invalid-input"
        : "processing-failed",
      reason instanceof Error ? reason.message : "No se pudo completar el análisis de colores.",
    );
  });
};

export {};

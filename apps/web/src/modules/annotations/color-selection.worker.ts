/// <reference lib="webworker" />

import type {
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

function post(response: ColorWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, transfer);
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

async function selectSimilarColors(
  requestId: number,
  sampleRgb: [number, number, number],
  toleranceDeltaE: number,
  minimumArea: number,
): Promise<void> {
  const rgba = imageRgba;
  const scope = scopeMask;
  if (!rgba || !scope || imageWidth <= 0 || imageHeight <= 0) {
    post({ type: "error", requestId, message: "La imagen de trabajo no está preparada." });
    return;
  }

  const pixelCount = imageWidth * imageHeight;
  const matches = new Uint8Array(pixelCount);
  const sampleLab = rgbToLab(sampleRgb[0], sampleRgb[1], sampleRgb[2]);
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
  let nextLabel = 1;
  for (let start = 0; start < pixelCount; start += 1) {
    if (matches[start] === 0 || labels[start] !== 0) continue;
    let read = 0;
    let write = 1;
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
      }
      if (read % 65536 === 0) {
        await yieldToMessages();
        if (isStale(requestId)) return;
      }
    }
    if (write >= minimumArea) {
      components.push({ id: nextLabel, areaPixels: write });
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
  await renderComponents(requestId, []);
}

async function renderComponents(requestId: number, excludedComponentIds: number[]): Promise<void> {
  const labels = componentLabels;
  if (!labels) {
    post({ type: "error", requestId, message: "No hay componentes de color para actualizar." });
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

self.onmessage = (event: MessageEvent<ColorWorkerRequest>) => {
  const request = event.data;
  if (request.type === "configure") {
    imageWidth = request.width;
    imageHeight = request.height;
    imageRgba = new Uint8ClampedArray(request.rgba);
    scopeMask = new Uint8Array(request.scopeMask);
    componentLabels = null;
    retainedComponents = [];
    return;
  }
  latestRequestId = request.requestId;
  if (request.type === "cancel") return;
  if (request.type === "select") {
    void selectSimilarColors(
      request.requestId,
      request.sampleRgb,
      request.toleranceDeltaE,
      request.minimumArea,
    );
    return;
  }
  void renderComponents(request.requestId, request.excludedComponentIds);
};

export {};

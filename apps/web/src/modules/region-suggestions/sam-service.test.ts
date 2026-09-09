import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  MAX_WORKING_SIDE,
  decodeMaskToWorkingGrid,
  pickBestCandidate,
  prepareSegmentationSession,
  segmentAtPoint,
  workingSize,
  type ServiceCandidate,
} from "./sam-service.ts";

// Minimal `createImageBitmap` + `OffscreenCanvas` for `node --test`, backed by
// sharp. It only does what `decodeMaskToWorkingGrid` asks for: decode to RGBA and
// draw with NEAREST NEIGHBOUR onto the working grid. It emulates the browser
// APIs, so this test proves the ENCODING contract and the rasterisation, not the
// exact pixel behaviour of Chrome.
function installCanvasPolyfill(): () => void {
  const globalAny = globalThis as unknown as Record<string, unknown>;
  const previous = {
    createImageBitmap: globalAny.createImageBitmap,
    OffscreenCanvas: globalAny.OffscreenCanvas,
  };
  interface Bitmap {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    close(): void;
  }
  globalAny.createImageBitmap = async (blob: Blob): Promise<Bitmap> => {
    const input = Buffer.from(await blob.arrayBuffer());
    const { data, info } = await sharp(input)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(data),
      close() {},
    };
  };
  globalAny.OffscreenCanvas = class {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}

    getContext() {
      const pixels = new Uint8ClampedArray(this.width * this.height * 4);
      const canvasWidth = this.width;
      const canvasHeight = this.height;
      return {
        imageSmoothingEnabled: true,
        clearRect() {
          pixels.fill(0);
        },
        drawImage(bitmap: Bitmap, _x: number, _y: number, width: number, height: number) {
          for (let y = 0; y < Math.min(height, canvasHeight); y += 1) {
            const sourceY = Math.min(bitmap.height - 1, Math.floor((y * bitmap.height) / height));
            for (let x = 0; x < Math.min(width, canvasWidth); x += 1) {
              const sourceX = Math.min(bitmap.width - 1, Math.floor((x * bitmap.width) / width));
              const from = (sourceY * bitmap.width + sourceX) * 4;
              const to = (y * canvasWidth + x) * 4;
              pixels[to] = bitmap.data[from];
              pixels[to + 1] = bitmap.data[from + 1];
              pixels[to + 2] = bitmap.data[from + 2];
              pixels[to + 3] = bitmap.data[from + 3];
            }
          }
        },
        getImageData(_x: number, _y: number, width: number, height: number) {
          return { data: pixels, width, height };
        },
      };
    }
  };
  return () => {
    globalAny.createImageBitmap = previous.createImageBitmap;
    globalAny.OffscreenCanvas = previous.OffscreenCanvas;
  };
}

function candidate(id: string, score: number, areaPixels: number): ServiceCandidate {
  return {
    id,
    score,
    maskDataUrl: "data:image/png;base64,AA==",
    width: 8,
    height: 8,
    areaPixels,
    modelName: "MobileSAM vit_t",
  };
}

test("la rejilla de trabajo conserva la proporción y está acotada", () => {
  const big = workingSize(4284, 5712);
  assert.equal(Math.max(big.width, big.height), MAX_WORKING_SIDE);
  assert.ok(Math.abs(big.width / big.height - 4284 / 5712) < 0.01);
  const small = workingSize(300, 200);
  assert.deepEqual(small, { width: 300, height: 200, scale: 1 });
  assert.throws(() => workingSize(0, 10), /no son válidas/);
});

test("se elige la candidata recomendada de MobileSAM salvo que esté vacía", () => {
  const candidates = [candidate("a", 0.4, 100), candidate("b", 0.9, 50)];
  assert.equal(pickBestCandidate(candidates, 1)?.id, "b");
  assert.equal(pickBestCandidate([candidate("a", 0.4, 0), candidate("b", 0.9, 50)], 0)?.id, "b");
  assert.equal(pickBestCandidate([candidate("a", 0.4, 0)], 0), null);
  assert.equal(pickBestCandidate([], 0), null);
});

test("preparar una sesión envía una referencia, nunca la fotografía original", async () => {
  const calls: Array<{ url: string; body: unknown; contentType: string | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({
      url,
      body: init?.body,
      contentType: (init?.headers as Record<string, string> | undefined)?.["Content-Type"] ?? null,
    });
    if (url.endsWith("/prepare")) {
      return Response.json({
        sessionId: "abcdefgh",
        ticket: "ticket-firmado.abc",
        width: 2048,
        height: 1536,
      });
    }
    return Response.json({ candidates: [], recommendedIndex: 0, space: "analysis_proxy" });
  }) as typeof fetch;
  try {
    const session = await prepareSegmentationSession({
      imageId: "44444444-4444-4444-8444-444444444441",
      treeSampleId: "33333333-3333-4333-8333-333333333333",
      direction: "N",
    });
    assert.equal(session.sessionId, "abcdefgh");
    assert.equal(session.ticket, "ticket-firmado.abc");
    assert.equal(session.width, 2048);
    // El ticket firmado viaja en cada uso: el servidor no guarda estado local.
    await segmentAtPoint(session, { x: 10, y: 10 });
    assert.equal(calls[1].url, "/api/vision/region-suggestions/segment");
    assert.deepEqual(JSON.parse(calls[1].body as string), {
      sessionId: "abcdefgh",
      ticket: "ticket-firmado.abc",
      points: [{ x: 10, y: 10, label: 1 }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 2);
  // La ruta autorizada del piloto, no la genérica de vision-lab.
  assert.equal(calls[0].url, "/api/vision/region-suggestions/prepare");
  assert.equal(calls[0].contentType, "application/json");
  assert.equal(typeof calls[0].body, "string");
  // Sólo identificadores: ni bytes ni multipart.
  assert.ok(!(calls[0].body instanceof FormData));
  assert.deepEqual(JSON.parse(calls[0].body as string), {
    imageId: "44444444-4444-4444-8444-444444444441",
    treeSampleId: "33333333-3333-4333-8333-333333333333",
    direction: "N",
  });
});

test("una máscara PNG real del servicio se rasteriza como región, no como imagen completa", async () => {
  // A PNG built with the SAME contract as `services/vision`
  // (`_mask_to_png_data_url`): one opaque grayscale channel, 0 background and
  // 255 region. It goes through the real `decodeMaskToWorkingGrid`, including
  // `createImageBitmap` and the 2D canvas.
  const width = 8;
  const height = 8;
  const gray = Buffer.alloc(width * height, 0);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) gray[y * width + x] = 255;
  }
  const png = await sharp(gray, { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  // Same encoding as the service: opaque, no alpha channel at all.
  assert.equal((await sharp(png).metadata()).hasAlpha, false);

  const restore = installCanvasPolyfill();
  try {
    const mask = await decodeMaskToWorkingGrid(dataUrl, width, height);
    assert.equal(mask.length, width * height);
    // A quarter of the image, not the whole image.
    assert.equal(mask.reduce((total, value) => total + value, 0), 16);
    assert.equal(mask[0], 1);
    assert.equal(mask[width - 1], 0);

    // Reading the same PNG as alpha is the real bug: everything becomes region.
    const asAlpha = await decodeMaskToWorkingGrid(dataUrl, width, height, "alpha");
    assert.equal(asAlpha.reduce((total, value) => total + value, 0), width * height);

    // Nearest neighbour on the bounded working grid: still a quarter, no blur.
    const half = await decodeMaskToWorkingGrid(dataUrl, 4, 4);
    assert.equal(half.reduce((total, value) => total + value, 0), 4);
  } finally {
    restore();
  }
});

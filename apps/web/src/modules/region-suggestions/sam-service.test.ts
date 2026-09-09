import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_WORKING_SIDE,
  pickBestCandidate,
  prepareSegmentationSession,
  segmentAtPoint,
  workingSize,
  type ServiceCandidate,
} from "./sam-service.ts";

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

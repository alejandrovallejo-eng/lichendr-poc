import assert from "node:assert/strict";
import test from "node:test";
import { readStoredAnalysisResponse, storedAnalysisRequest } from "./stored-analysis.ts";

const imageId = "123e4567-e89b-42d3-a456-426614174000";

test("serializes only a small stored-image reference for analysis", () => {
  const request = storedAnalysisRequest(imageId);
  assert.equal(request.headers["Content-Type"], "application/json");
  assert.ok(Buffer.byteLength(request.body) < 1024);
  assert.deepEqual(JSON.parse(request.body), { imageId, action: "detect" });
  assert.equal(request.body.includes("data:image"), false);
});

test("keeps a recoverable message when Vercel or Render rejects the request", async () => {
  await assert.rejects(
    readStoredAnalysisResponse(new Response("<html>FUNCTION_PAYLOAD_TOO_LARGE</html>", { status: 413 })),
    /fotografía quedó guardada.*reintentar/i,
  );
  await assert.rejects(
    readStoredAnalysisResponse(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 })),
    /fotografía quedó guardada.*reintentar/i,
  );
});

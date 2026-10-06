import test from "node:test";
import assert from "node:assert/strict";
import { analysisCapabilities, capabilityAvailable } from "./analysis-capabilities";
test("MobileSAM availability does not depend on BioCLIP", () => {
  const caps = analysisCapabilities({ VISION_SERVICE_URL: "https://vision.example", VISION_SERVICE_TOKEN: "x".repeat(32), NEXT_PUBLIC_BIOCLIP_SUGGESTIONS: "0" });
  assert.equal(capabilityAvailable(caps.segmentation), true);
  assert.equal(capabilityAvailable(caps.classification), false);
});
test("each engine requires its own enabled configuration", () => {
  const caps = analysisCapabilities({ NEXT_PUBLIC_MOBILESAM_ASSISTANCE: "0", VISION_SERVICE_URL: "https://vision.example", VISION_SERVICE_TOKEN: "x".repeat(32), NEXT_PUBLIC_BIOCLIP_SUGGESTIONS: "1", BIOCLIP_WORKER_URL: "https://worker.example", BIOCLIP_WORKER_TOKEN: "secret" });
  assert.equal(capabilityAvailable(caps.segmentation), false);
  assert.equal(capabilityAvailable(caps.classification), true);
  assert.equal(capabilityAvailable(analysisCapabilities({}).segmentation), false);
  assert.equal(capabilityAvailable(analysisCapabilities({ NEXT_PUBLIC_BIOCLIP_SUGGESTIONS: "1" }).classification), false);
});

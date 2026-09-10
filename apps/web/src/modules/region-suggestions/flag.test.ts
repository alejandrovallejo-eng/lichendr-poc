import assert from "node:assert/strict";
import test from "node:test";

import {
  REGION_SUGGESTIONS_FLAG,
  regionSuggestionsEnabled,
  regionSuggestionsWorkerConfigured,
} from "./flag.ts";

test("el flag está apagado por defecto", () => {
  assert.equal(regionSuggestionsEnabled({}), false);
  assert.equal(regionSuggestionsEnabled({ [REGION_SUGGESTIONS_FLAG]: "0" }), false);
  assert.equal(regionSuggestionsEnabled({ [REGION_SUGGESTIONS_FLAG]: "true" }), false);
  assert.equal(regionSuggestionsEnabled({ [REGION_SUGGESTIONS_FLAG]: "" }), false);
});

test("el flag sólo se enciende con el valor exacto 1", () => {
  assert.equal(regionSuggestionsEnabled({ [REGION_SUGGESTIONS_FLAG]: "1" }), true);
});

test("sin worker configurado no hay asistencia aunque el flag esté encendido", () => {
  assert.equal(regionSuggestionsWorkerConfigured({}), false);
  assert.equal(regionSuggestionsWorkerConfigured({ BIOCLIP_WORKER_URL: "" }), false);
  assert.equal(regionSuggestionsWorkerConfigured({ BIOCLIP_WORKER_URL: "no-es-una-url" }), false);
  assert.equal(
    regionSuggestionsWorkerConfigured({ BIOCLIP_WORKER_URL: "file:///etc/passwd" }),
    false,
  );
  assert.equal(
    regionSuggestionsWorkerConfigured({ BIOCLIP_WORKER_URL: "http://127.0.0.1:8500" }),
    true,
  );
});

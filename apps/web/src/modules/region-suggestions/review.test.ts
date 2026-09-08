import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptedLichenRegionIds,
  applyDecision,
  initialReview,
  isCachedBatchUsable,
  mergeReviews,
  nextPhase,
  phaseNotice,
  restoreState,
  resultBelongsToContext,
  reviewCounts,
  suggestionCacheKey,
} from "./review.ts";
import type { RegionReview, RegionSuggestion } from "./types.ts";

const identity = {
  ownerId: "owner-1",
  imageId: "image-1",
  imageSha256: "aaa",
  proxySha256: "bbb",
  maskSetSha256: "ccc",
  encoderId: "imageomics/bioclip-2@2957b322090f",
  headSha256: null,
  backend: "zeroshot",
  preprocessVersion: "crop-context-1",
  suggestionVersion: "1",
};

function suggestion(regionId: string): RegionSuggestion {
  return {
    regionId,
    ranking: [
      { label: "lichen", labelEs: "liquen", rawScore: 0.31 },
      { label: "moss", labelEs: "musgo", rawScore: 0.22 },
      { label: "bare tree bark", labelEs: "corteza desnuda", rawScore: 0.2 },
    ],
    backend: "zeroshot",
    encoderId: identity.encoderId,
    headSha256: null,
    preprocess: "whole_crop_pad",
    versions: { schema: "1" },
  };
}

test("la clave de caché incluye propietario, hashes y versiones", () => {
  const key = suggestionCacheKey(identity);
  assert.ok(key.includes("owner-1"));
  assert.notEqual(key, suggestionCacheKey({ ...identity, maskSetSha256: "otro" }));
  assert.notEqual(key, suggestionCacheKey({ ...identity, preprocessVersion: "crop-context-2" }));
  assert.notEqual(key, suggestionCacheKey({ ...identity, headSha256: "1fbef280" }));
  assert.throws(() => suggestionCacheKey({ ...identity, ownerId: "" }), /incompleta/);
});

test("la caché de otro propietario o de otra versión nunca se reutiliza", () => {
  const key = suggestionCacheKey(identity);
  assert.equal(isCachedBatchUsable({ key, ownerId: "owner-1" }, identity), true);
  assert.equal(isCachedBatchUsable({ key, ownerId: "owner-2" }, identity), false);
  assert.equal(
    isCachedBatchUsable({ key, ownerId: "owner-1" }, { ...identity, proxySha256: "otro" }),
    false,
  );
  assert.equal(isCachedBatchUsable(null, identity), false);
});

test("una predicción nueva nunca sobrescribe una decisión humana", () => {
  const reviewed: RegionReview[] = [
    {
      regionId: "r1",
      decision: "accepted",
      reviewedLabel: "lichen",
      maskEdited: true,
      reviewedAt: "2026-01-01T00:00:00.000Z",
      reviewedBy: "revisor",
    },
    initialReview("r2"),
  ];
  const merged = mergeReviews(reviewed, [suggestion("r1"), suggestion("r2"), suggestion("r3")]);
  assert.deepEqual(merged[0], reviewed[0]);
  assert.equal(merged[1].decision, "pending");
  assert.equal(merged[2].regionId, "r3");
  assert.equal(merged[2].decision, "pending");
});

test("una decisión humana sobrevive aunque la nueva tanda ya no proponga la región", () => {
  const reviewed: RegionReview[] = [
    {
      regionId: "r9",
      decision: "rejected",
      reviewedLabel: null,
      maskEdited: false,
      reviewedAt: "2026-01-01T00:00:00.000Z",
      reviewedBy: "revisor",
    },
  ];
  const merged = mergeReviews(reviewed, [suggestion("r1")]);
  assert.deepEqual(merged.map((item) => item.regionId).sort(), ["r1", "r9"]);
});

test("aceptar exige etiqueta confirmada y excluir la borra", () => {
  let reviews = [initialReview("r1")];
  assert.throws(
    () => applyDecision(reviews, {
      regionId: "r1",
      decision: "accepted",
      reviewedBy: "revisor",
      reviewedAt: "2026-01-01T00:00:00.000Z",
    }),
    /etiqueta/,
  );
  reviews = applyDecision(reviews, {
    regionId: "r1",
    decision: "accepted",
    label: "lichen",
    reviewedBy: "revisor",
    reviewedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(reviews[0].reviewedLabel, "lichen");
  reviews = applyDecision(reviews, {
    regionId: "r1",
    decision: "rejected",
    reviewedBy: "revisor",
    reviewedAt: "2026-01-01T00:01:00.000Z",
  });
  assert.equal(reviews[0].reviewedLabel, null);
  assert.throws(
    () => applyDecision(reviews, {
      regionId: "desconocida",
      decision: "rejected",
      reviewedBy: "revisor",
      reviewedAt: "2026-01-01T00:01:00.000Z",
    }),
    /no existe/,
  );
});

test("sólo el liquen aceptado cuenta: pendiente, excluido y sin determinar quedan fuera", () => {
  const reviews: RegionReview[] = [
    { regionId: "r1", decision: "accepted", reviewedLabel: "lichen", maskEdited: false, reviewedAt: "t", reviewedBy: "u" },
    { regionId: "r2", decision: "accepted", reviewedLabel: "moss", maskEdited: false, reviewedAt: "t", reviewedBy: "u" },
    { regionId: "r3", decision: "pending", reviewedLabel: null, maskEdited: false, reviewedAt: "", reviewedBy: "" },
    { regionId: "r4", decision: "rejected", reviewedLabel: null, maskEdited: false, reviewedAt: "t", reviewedBy: "u" },
    { regionId: "r5", decision: "undetermined", reviewedLabel: null, maskEdited: true, reviewedAt: "t", reviewedBy: "u" },
  ];
  assert.deepEqual(acceptedLichenRegionIds(reviews), ["r1"]);
  assert.deepEqual(reviewCounts(reviews), {
    pending: 1,
    accepted: 2,
    rejected: 1,
    undetermined: 1,
    acceptedLichen: 1,
    maskEdited: 1,
  });
});

test("una respuesta tardía de otro árbol, vista o versión se descarta", () => {
  const expected = {
    ownerId: "owner-1",
    treeSampleId: "tree-1",
    direction: "N",
    imageId: "image-1",
    requestToken: "token-1",
    suggestionVersion: "1",
  };
  assert.equal(resultBelongsToContext(expected, { ...expected }), true);
  assert.equal(resultBelongsToContext(expected, { ...expected, treeSampleId: "tree-2" }), false);
  assert.equal(resultBelongsToContext(expected, { ...expected, direction: "E" }), false);
  assert.equal(resultBelongsToContext(expected, { ...expected, imageId: "image-2" }), false);
  assert.equal(resultBelongsToContext(expected, { ...expected, requestToken: "token-2" }), false);
  assert.equal(resultBelongsToContext(expected, { ...expected, suggestionVersion: "2" }), false);
  assert.equal(resultBelongsToContext(expected, { ...expected, ownerId: "owner-2" }), false);
});

test("las fases avanzan Buscando regiones → Sugiriendo etiquetas → Revisar", () => {
  let phase = nextPhase("idle", { type: "start" });
  assert.equal(phase, "searching_regions");
  phase = nextPhase(phase, { type: "regions_found", count: 3 });
  assert.equal(phase, "suggesting_labels");
  phase = nextPhase(phase, { type: "labels_ready" });
  assert.equal(phase, "review");
  assert.equal(nextPhase("searching_regions", { type: "regions_found", count: 0 }), "review");
});

test("un fallo del worker nunca simula éxito y conserva la anotación manual", () => {
  const phase = nextPhase("suggesting_labels", { type: "worker_failed" });
  assert.equal(phase, "unavailable");
  const notice = phaseNotice(phase, 3, "El worker BioCLIP no respondió.");
  assert.match(notice.detail, /se conservan/);
  assert.equal(notice.manualAnnotationAvailable, true);
  assert.notEqual(notice.title, "Revisar");
});

test("sin regiones propuestas se pide revisar el ROI, no se declara ausencia", () => {
  const notice = phaseNotice("review", 0);
  assert.match(notice.detail, /no demuestra ausencia/);
});

test("la restauración devuelve fotos, sugerencias y revisiones sin reanalizar", () => {
  const restored = restoreState({
    regions: [
      {
        regionId: "r1",
        maskWidth: 10,
        maskHeight: 10,
        maskAreaPixels: 12,
        box: { x: 1, y: 1, width: 4, height: 4 },
        samScore: 0.9,
        transformChain: [],
      },
    ],
    suggestions: [suggestion("r1")],
    reviews: [
      {
        regionId: "r1",
        decision: "accepted",
        reviewedLabel: "lichen",
        maskEdited: true,
        reviewedAt: "2026-01-01T00:00:00.000Z",
        reviewedBy: "revisor",
      },
    ],
  });
  assert.equal(restored.phase, "review");
  assert.equal(restored.reanalysisRequired, false);
  assert.equal(restored.regions.length, 1);
  assert.equal(restored.reviews[0].decision, "accepted");
  assert.equal(restored.reviews[0].maskEdited, true);
});

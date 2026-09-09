import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptedLichenRegionIds,
  applyDecision,
  applyMaskEdit,
  initialReview,
  isCachedBatchUsable,
  mergeReviews,
  nextPhase,
  phaseNotice,
  restoreState,
  resultBelongsToContext,
  sameViewIdentity,
  reviewCounts,
  suggestionCacheKey,
} from "./review.ts";
import type { ProposedRegion, RegionReview, RegionSuggestion } from "./types.ts";

const identity = {
  ownerId: "owner-1",
  imageId: "image-1",
  proxySha256: "bbb",
  maskSetSha256: "ccc",
  encoderId: "imageomics/bioclip-2@2957b322090f",
  headSha256: null,
  backend: "zeroshot",
  preprocessVersion: "crop-context-1",
  suggestionVersion: "1",
};

function review(regionId: string, maskSha: string, extra: Partial<RegionReview> = {}): RegionReview {
  return { ...initialReview(regionId, maskSha), ...extra };
}

function region(regionId: string, maskSha: string): ProposedRegion {
  return {
    regionId,
    maskWidth: 4,
    maskHeight: 4,
    maskRle: "4:4:0,16",
    maskSha,
    maskAreaPixels: 4,
    box: { x: 1, y: 1, width: 2, height: 2 },
    cropBoxNormalized: null,
    samScore: 0.9,
    transformChain: [],
  };
}

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
    review("r1", "m1", {
      decision: "accepted",
      reviewedLabel: "lichen",
      maskEdited: true,
      reviewedAt: "2026-01-01T00:00:00.000Z",
      reviewedBy: "revisor",
    }),
    review("r2", "m2"),
  ];
  const merged = mergeReviews(reviewed, [
    { regionId: "r1", maskSha: "m1" },
    { regionId: "r2", maskSha: "m2" },
    { regionId: "r3", maskSha: "m3" },
  ]);
  assert.deepEqual(merged[0], reviewed[0]);
  assert.equal(merged[1].decision, "pending");
  assert.equal(merged[2].regionId, "r3");
  assert.equal(merged[2].decision, "pending");
});

test("una decisión no se conserva sólo por regionId si la máscara cambió", () => {
  const reviewed: RegionReview[] = [
    review("r1", "m1", {
      decision: "accepted",
      reviewedLabel: "lichen",
      maskEdited: false,
      reviewedAt: "2026-01-01T00:00:00.000Z",
      reviewedBy: "revisor",
    }),
  ];
  const merged = mergeReviews(reviewed, [{ regionId: "r1", maskSha: "OTRA" }]);
  assert.equal(merged[0].decision, "pending");
  assert.equal(merged[0].maskSha, "OTRA");
  assert.equal(merged[0].reviewedLabel, null);
});

test("editar la máscara re-clava la revisión sobre los píxeles nuevos", () => {
  let reviews = [review("r1", "m1")];
  reviews = applyMaskEdit(reviews, "r1", "m1", "m1");
  assert.equal(reviews[0].maskEdited, false, "sin cambio de píxeles no hay edición");
  reviews = applyMaskEdit(reviews, "r1", "m2", "m1");
  assert.equal(reviews[0].maskEdited, true);
  assert.equal(reviews[0].maskSha, "m2");
  assert.throws(() => applyMaskEdit(reviews, "otra", "m3", "m1"), /no existe/);
});

test("una decisión humana sobrevive aunque la nueva tanda ya no proponga la región", () => {
  const reviewed: RegionReview[] = [
    review("r9", "m9", {
      decision: "rejected",
      reviewedLabel: null,
      maskEdited: false,
      reviewedAt: "2026-01-01T00:00:00.000Z",
      reviewedBy: "revisor",
    }),
  ];
  const merged = mergeReviews(reviewed, [{ regionId: "r1", maskSha: "m1" }]);
  assert.deepEqual(merged.map((item) => item.regionId).sort(), ["r1", "r9"]);
});

test("aceptar exige etiqueta confirmada y excluir la borra", () => {
  let reviews = [initialReview("r1", "m1")];
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
    review("r1", "m1", { decision: "accepted", reviewedLabel: "lichen", reviewedAt: "t", reviewedBy: "u" }),
    review("r2", "m2", { decision: "accepted", reviewedLabel: "moss", reviewedAt: "t", reviewedBy: "u" }),
    review("r3", "m3"),
    review("r4", "m4", { decision: "rejected", reviewedAt: "t", reviewedBy: "u" }),
    review("r5", "m5", { decision: "undetermined", maskEdited: true, reviewedAt: "t", reviewedBy: "u" }),
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
    generation: 7,
    ownerId: "owner-1",
    treeSampleId: "tree-1",
    direction: "N",
    imageId: "image-1",
    requestToken: "token-1",
    maskSetSha: "set-1",
    suggestionVersion: "1",
  };
  assert.equal(resultBelongsToContext(expected, { ...expected }), true);
  assert.equal(resultBelongsToContext(expected, { ...expected, treeSampleId: "tree-2" }), false);
  assert.equal(resultBelongsToContext(expected, { ...expected, direction: "E" }), false);
  assert.equal(resultBelongsToContext(expected, { ...expected, imageId: "image-2" }), false);
  assert.equal(resultBelongsToContext(expected, { ...expected, requestToken: "token-2" }), false);
  assert.equal(resultBelongsToContext(expected, { ...expected, maskSetSha: "set-2" }), false);
  assert.equal(resultBelongsToContext(expected, { ...expected, suggestionVersion: "2" }), false);
  assert.equal(resultBelongsToContext(expected, { ...expected, ownerId: "owner-2" }), false);
});

test("A→B: la respuesta tardía de A no se aplica a B aunque el contexto viejo sea coherente", () => {
  // El panel guarda la generación viva en una ref. La ejecución A captura su
  // propio contexto; comparar ese contexto con su propio eco siempre casaría.
  const generationRef = { current: 0 };

  const startRun = (direction: string, imageId: string) => {
    generationRef.current += 1;
    return {
      generation: generationRef.current,
      ownerId: "owner-1",
      treeSampleId: "tree-1",
      direction,
      imageId,
      requestToken: `token-${direction}`,
      maskSetSha: `set-${direction}`,
      suggestionVersion: "1",
    };
  };

  const runA = startRun("N", "image-N");
  const runB = startRun("E", "image-E");

  // Respuesta de A que llega DESPUÉS de haber empezado B.
  const liveContext = { ...runB, generation: generationRef.current };
  assert.equal(resultBelongsToContext(liveContext, runA), false);
  assert.equal(resultBelongsToContext(liveContext, runB), true);

  // Cambiar de vista limpia el estado en vez de arrastrarlo.
  assert.equal(sameViewIdentity(runA, runB), false);
  const { ownerId, treeSampleId, direction, imageId } = runA;
  assert.equal(sameViewIdentity({ ownerId, treeSampleId, direction, imageId }, runA), true);
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
  const stored = region("r1", "m-editada");
  const restored = restoreState({
    regions: [stored],
    suggestions: [suggestion("r1")],
    reviews: [
      review("r1", "m-editada", {
        decision: "accepted",
        reviewedLabel: "lichen",
        maskEdited: true,
        reviewedAt: "2026-01-01T00:00:00.000Z",
        reviewedBy: "revisor",
      }),
    ],
  });
  assert.equal(restored.phase, "review");
  assert.equal(restored.reanalysisRequired, false);
  assert.equal(restored.regions.length, 1);
  assert.equal(restored.regions[0].maskRle, stored.maskRle);
  assert.equal(restored.reviews[0].decision, "accepted");
  assert.equal(restored.reviews[0].maskEdited, true);
  assert.equal(restored.reviews[0].maskSha, "m-editada");
});

test("una revisión guardada sobre otra máscara no se reaplica al restaurar", () => {
  const restored = restoreState({
    regions: [region("r1", "m-nueva")],
    suggestions: [suggestion("r1")],
    reviews: [
      review("r1", "m-vieja", {
        decision: "accepted",
        reviewedLabel: "lichen",
        reviewedAt: "2026-01-01T00:00:00.000Z",
        reviewedBy: "revisor",
      }),
    ],
  });
  assert.equal(restored.reviews[0].decision, "pending");
});

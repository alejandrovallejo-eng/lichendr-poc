import { strict as assert } from "node:assert";
import test from "node:test";
import {
  aggregateCompatiblePollutants,
  buildDescriptiveProfile,
  buildReadinessChecklist,
  selectCompletedEvaluations,
  type EnvironmentalEvaluation,
  type ReadinessInput,
} from "./science";

const completeReadiness: ReadinessInput = {
  completedAnnotations: 2,
  metricsAvailable: 2,
  confirmedTrunks: 2,
  sampleCount: 2,
  samplingHeightRecorded: 2,
  orientationRecorded: 2,
  sampledAreaRecorded: 2,
  hostMetadataAvailable: 2,
  barkCharacteristicsAvailable: 2,
  microclimateAvailable: 2,
  representedSites: 2,
  candidateReferenceSites: 1,
  pollutantMeasurements: 3,
  representedTrees: 2,
};

function evaluation(
  overrides: Partial<EnvironmentalEvaluation> = {},
): EnvironmentalEvaluation {
  return {
    annotationSetId: "set-1",
    imageId: "image-1",
    status: "completed",
    completedAt: "2026-08-05T12:00:00Z",
    siteId: "site-1",
    samplingEventId: "event-1",
    treeId: "tree-1",
    treeSampleId: "sample-1",
    morphotypeLabels: ["M1"],
    metrics: {
      trunk_area_pixels: 100,
      lichen_union_area_pixels: 20,
      coverage_percent: 20,
      lichen_region_count: 2,
      morphotype_count: 1,
      calculation_method: "mask_union_intersection",
      calculation_version: "1.1.0",
      calculated_at: "2026-08-05T13:00:00Z",
      quality_flags: [],
    },
    ...overrides,
  };
}

test("marca preparación completa, parcial y faltante sin producir puntaje", () => {
  assert.ok(buildReadinessChecklist(completeReadiness).every((item) => item.status === "Completo"));

  const partial = buildReadinessChecklist({
    ...completeReadiness,
    samplingHeightRecorded: 1,
    barkCharacteristicsAvailable: 0,
  });
  assert.equal(partial.find((item) => item.key === "height")?.status, "Parcial");
  assert.equal(partial.find((item) => item.key === "bark")?.status, "Faltante");
  assert.equal("score" in partial, false);
});

test("usa No aplica para metadatos de una colección sin muestras ni sitios", () => {
  const empty = buildReadinessChecklist(Object.fromEntries(
    Object.keys(completeReadiness).map((key) => [key, 0]),
  ) as unknown as ReadinessInput);
  assert.equal(empty.find((item) => item.key === "height")?.status, "No aplica");
  assert.equal(empty.find((item) => item.key === "references")?.status, "No aplica");
  assert.equal(empty.find((item) => item.key === "annotations")?.status, "Faltante");
});

test("excluye anotaciones en borrador aunque tengan métricas", () => {
  const completed = evaluation();
  const draft = evaluation({ annotationSetId: "set-2", status: "draft", completedAt: null });
  assert.deepEqual(selectCompletedEvaluations([completed, draft]), [completed]);
  assert.equal(buildDescriptiveProfile([completed, draft]).excludedRecords, 1);
});

test("calcula cobertura ponderada con áreas de unión sin sumar solapamientos", () => {
  const profile = buildDescriptiveProfile([
    evaluation(),
    evaluation({
      annotationSetId: "set-2",
      imageId: "image-2",
      metrics: {
        ...evaluation().metrics!,
        trunk_area_pixels: 300,
        lichen_union_area_pixels: 60,
      },
    }),
  ]);
  assert.equal(profile.weightedCoverage, 20);
});

test("registra annotation_metrics faltante e incompleto", () => {
  const profile = buildDescriptiveProfile([
    evaluation({ metrics: null }),
    evaluation({
      annotationSetId: "set-2",
      metrics: { ...evaluation().metrics!, coverage_percent: null },
    }),
  ]);
  assert.equal(profile.missingMetrics, 1);
  assert.equal(profile.incompleteMetrics, 1);
});

test("no agrega unidades incompatibles del mismo contaminante", () => {
  const aggregates = aggregateCompatiblePollutants([
    { pollutantCode: "NO2", unit: "ppb", averagingPeriod: "1 h", value: 10 },
    { pollutantCode: "NO2", unit: "ppb", averagingPeriod: "1 h", value: 20 },
    { pollutantCode: "NO2", unit: "µg/m³", averagingPeriod: "1 h", value: 30 },
  ]);
  assert.equal(aggregates.length, 2);
  assert.equal(aggregates.find((item) => item.unit === "ppb")?.mean, 15);
});

test("propaga alertas de calidad únicas", () => {
  const profile = buildDescriptiveProfile([
    evaluation({ metrics: { ...evaluation().metrics!, quality_flags: ["missing_trunk"] } }),
    evaluation({
      annotationSetId: "set-2",
      metrics: { ...evaluation().metrics!, quality_flags: { missing_trunk: true, no_lichen_regions: true } },
    }),
  ]);
  assert.deepEqual(profile.qualityFlags.sort(), ["missing_trunk", "no_lichen_regions"]);
});

test("resume proyectos vacíos sin inventar resultados", () => {
  const profile = buildDescriptiveProfile([]);
  assert.equal(profile.completedImages, 0);
  assert.equal(profile.weightedCoverage, null);
  assert.deepEqual(profile.perSiteCoverage, []);
});

import type { EcologyData } from "./ecology-client";
import { morphDisplayName, observedMorphs, sameEcologySource, type EcologyRow } from "./ecology";
import { DIRECTIONS, type Direction } from "./types";
import { confirmedFrequency, confirmedFrequencyByMorph } from "./cell-frequency";

export function currentQuadrat(data: EcologyData, sampleId: string, direction: Direction): {
  state: "saved" | "pending" | "changed" | "unavailable"; row?: EcologyRow;
} {
  const tree = data.rows.find(r => r.sampleId === sampleId), view = tree?.views[direction];
  if (!tree || !view?.imageId || view.state !== "saved") return { state: "unavailable" };
  const source = data.sources[view.imageId];
  const matches = data.reviews.filter(r => r.image_id === view.imageId && r.tree_sample_id === sampleId
    && r.direction === direction && r.event_id === tree.event.id);
  if (!source?.analysis || !source.savedAt || matches.length > 1) return { state: "unavailable" };
  const saved = matches[0];
  if (!saved) return { state: "pending" };
  return sameEcologySource(saved.review, source.outline, source.analysis.width, source.analysis.height, { ...source, imageId: view.imageId })
    ? { state: "saved", row: saved } : { state: "changed", row: saved };
}

// Descriptive snapshot only: no pooled pixels, mean cover, inferred absence,
// full-trunk metrics, model requests, or database writes.
export function buildEcologySummary(data: EcologyData, eventId: string) {
  const first = data.rows[0];
  if (data.rows.some(r => r.event.id !== eventId || r.site.id !== first.site.id
      || r.project.id !== first.project.id || r.project.owner_id !== first.project.owner_id)
    || new Set(data.rows.map(r => r.sampleId)).size !== data.rows.length
    || new Set(data.rows.map(r => r.tree.id)).size !== data.rows.length
    || new Set(data.catalog.map(m => m.id)).size !== data.catalog.length
    || data.catalog.some(m => m.event_id !== eventId)) {
    throw new Error("No se pudo conciliar la jornada. Actualiza la lectura; no se mostrará un resumen parcial como completo.");
  }
  const trees = data.rows.map(tree => {
    const views = DIRECTIONS.map(direction => ({ direction, ...currentQuadrat(data, tree.sampleId, direction) }));
    const saved = views.filter(v => v.state === "saved");
    const morphIds = [...new Set(saved.flatMap(v => observedMorphs(v.row!.review)))];
    const frequencyByMorph = views.map(view => view.state === "saved" && view.row?.review.standardized
      ? confirmedFrequencyByMorph(view.row.review.standardized.decisions,
        view.row.review.config.confirmed?.groups.filter(g => g.id !== "unassigned").map(g => g.id) ?? []) : {});
    const frequencies = views.map(view => view.state === "saved" && view.row?.review.standardized
      ? confirmedFrequency(view.row.review.standardized.decisions,
        1, view.row.review.config.confirmed?.groups.filter(g => g.id !== "unassigned").map(g => g.id)) : null);
    const completeFrequencies = views.length === DIRECTIONS.length
      && views.every(view => view.state === "saved")
      && frequencies.every(Boolean);
    const viewFrequencyByMorph = views.map((view, index) => ({ ...view, frequencyByMorph: frequencyByMorph[index] }));
    return { tree, views: viewFrequencyByMorph, savedCount: saved.length, morphIds, frequencies,
      frequencyCells: completeFrequencies ? frequencies.reduce((sum, value) => sum + (value?.occupiedCells ?? 0), 0) : null,
      frequencyByMorph: Object.fromEntries([...new Set(views.flatMap((view,index) =>
        Object.keys(frequencyByMorph[index] ?? {})))].map(id => {
          const values = frequencyByMorph.map(value => value[id]);
          return [id, values.every(Boolean) ? { occupiedCells: values.reduce((sum, value) => sum + (value?.occupiedCells ?? 0), 0), totalCells: 20 } : null];
        })) };
  });
  const valid = trees.flatMap(t => t.views.filter(v => v.state === "saved").map(v => ({
    sampleId: t.tree.sampleId, treeCode: t.tree.tree.code, direction: v.direction, row: v.row!,
  })));
  const catalog = new Map(data.catalog.map(m => [m.id, m]));
  if (valid.some(v => observedMorphs(v.row.review).some(id => !catalog.has(id))))
    throw new Error("Falta una morfoespecie del catálogo. Actualiza la lectura antes de comparar resultados.");
  const morphs = [...data.catalog].sort((a, b) => a.ordinal - b.ordinal).map(m => {
    const occurrences = valid.flatMap(v => {
      const group = v.row.review.config.confirmed!.groups.find(g => g.id === m.id);
      if (!group || v.row.review.counts[group.label] <= 0) return [];
      return [{ sampleId: v.sampleId, treeCode: v.treeCode, direction: v.direction,
        percent: 100 * v.row.review.counts[group.label] / v.row.review.total }];
    });
    return { id: m.id, name: morphDisplayName(m), trees: new Set(occurrences.map(o => o.sampleId)).size, occurrences };
  }).filter(m => m.occurrences.length > 0);
  return {
    trees, morphs, quadrats: valid.length, expectedViews: trees.length * DIRECTIONS.length,
    treesReviewed: trees.filter(t => t.savedCount > 0).length,
    treesComplete: trees.filter(t => t.savedCount === DIRECTIONS.length).length,
    pending: trees.flatMap(t => t.views).filter(v => v.state === "pending").length,
    changed: trees.flatMap(t => t.views).filter(v => v.state === "changed").length,
    unavailable: trees.flatMap(t => t.views).filter(v => v.state === "unavailable").length,
    frequencyViews: trees.flatMap(t => t.frequencies).filter(Boolean).length,
    frequencyTrees: trees.filter(t => t.frequencyCells !== null).length,
    catalogueOnly: data.catalog.length - morphs.length,
    lastSavedAt: valid.map(v => v.row.review.savedAt).sort().at(-1) ?? null,
  };
}
export type EcologySummaryData = ReturnType<typeof buildEcologySummary>;

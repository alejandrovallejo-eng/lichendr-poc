// A separate, opt-in comparison. Never substitutes human labels or coverage.
export const EXPERIMENTAL_MODEL = "inat-five-class-20260917";
export const EXPERIMENTAL_BUNDLE = "564fb614774d3c34731186e0bf8384700758c67c692879a6ad39959ea252863c";
export const EXPERIMENTAL_LABELS = ["lichen", "moss", "bark", "algae", "other_fungus"] as const;
export type ExperimentalLabel = typeof EXPERIMENTAL_LABELS[number];
export type ExperimentalDecision = ExperimentalLabel | "undetermined";
export const EXPERIMENTAL_NAMES: Record<ExperimentalDecision, string> = {
  lichen: "Liquen", moss: "Musgo", bark: "Corteza", algae: "Algas", other_fungus: "Otro hongo", undetermined: "Sin determinar",
};
export interface ExperimentalSuggestion {
  regionId: string;
  decision: ExperimentalDecision;
  status: "pending";
  ranking: Array<{ label: ExperimentalLabel; rawScore: number }>;
}
export interface ExperimentalComparison {
  modelId: string;
  bundleSha256: string;
  experimental: true;
  preprocess: "standard_center_crop";
  suggestions: ExperimentalSuggestion[];
}

export function parseExperimental(value: unknown, regionIds: readonly string[]): ExperimentalComparison | null {
  if (!value || typeof value !== "object" || !regionIds.length) return null;
  const v = value as ExperimentalComparison;
  if (v.modelId !== EXPERIMENTAL_MODEL || v.bundleSha256 !== EXPERIMENTAL_BUNDLE || v.experimental !== true
    || v.preprocess !== "standard_center_crop" || !Array.isArray(v.suggestions) || v.suggestions.length !== regionIds.length) return null;
  const seen = new Set<string>();
  for (const s of v.suggestions) {
    if (!s || !regionIds.includes(s.regionId) || seen.has(s.regionId) || s.status !== "pending"
      || ![...EXPERIMENTAL_LABELS, "undetermined"].includes(s.decision)
      || !Array.isArray(s.ranking) || s.ranking.length !== 5) return null;
    seen.add(s.regionId);
    const labels = new Set<string>();
    for (const r of s.ranking) {
      if (!r || !EXPERIMENTAL_LABELS.includes(r.label) || labels.has(r.label) || !Number.isFinite(r.rawScore)) return null;
      labels.add(r.label);
    }
    if (s.ranking.some((r, i) => i > 0 && r.rawScore > s.ranking[i - 1].rawScore)
      || (s.decision !== "undetermined" && s.decision !== s.ranking[0].label)) return null;
  }
  return { modelId: v.modelId, bundleSha256: v.bundleSha256, experimental: true, preprocess: v.preprocess,
    suggestions: v.suggestions.map(s => ({ regionId: s.regionId, decision: s.decision, status: "pending",
      ranking: s.ranking.map(r => ({ label: r.label, rawScore: r.rawScore })) })) };
}

export function experimentalCounts(comparison: ExperimentalComparison) {
  return {
    total: comparison.suggestions.length,
    lichen: comparison.suggestions.filter(s => s.decision === "lichen").length,
    undetermined: comparison.suggestions.filter(s => s.decision === "undetermined").length,
  };
}

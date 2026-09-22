import { parseGuidedReview } from "./guided-flow";
import { DIRECTIONS, type Direction } from "./types";

export interface ResultProject { id: string; name: string; owner_id: string }
export interface ResultSite { id: string; name: string; project_id: string }
export interface ResultEvent { id: string; name: string; site_id: string; sampled_at: string }
export interface ResultTree { id: string; code: string; site_id: string }
export interface ResultSample { id: string; tree_id: string; site_id: string; sampling_event_id: string }
export interface ResultSeries { id: string; tree_sample_id: string; created_at: string }
export interface ResultCapture { id: string; capture_series_id: string; image_id: string; direction: string; active: boolean }
export interface ResultReview { image_id: string; tree_sample_id: string; owner_id: string; direction: string; review: unknown }
export interface ResultSource {
  projects: ResultProject[]; sites: ResultSite[]; events: ResultEvent[]; trees: ResultTree[];
  samples: ResultSample[]; series: ResultSeries[]; captures: ResultCapture[]; reviews: ResultReview[];
}
export interface SavedViewResult {
  state: "missing" | "pending" | "saved" | "invalid";
  imageId: string | null; coverage: number | null; savedAt: string | null;
}
export interface GuidedTreeResult {
  sampleId: string; tree: ResultTree; project: ResultProject; site: ResultSite; event: ResultEvent;
  views: Record<Direction, SavedViewResult>; savedCount: number; uploadedCount: number;
  complete: boolean; lastSavedAt: string | null;
}

// Match the guided editor: the most recently CREATED series is current.
// Never recover a saved result from a superseded image/series or another event.
export function latestResultSeries(series: ResultSeries[]): ResultSeries[] {
  const latest = new Map<string, ResultSeries>();
  for (const row of [...series].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)))
    if (!latest.has(row.tree_sample_id)) latest.set(row.tree_sample_id, row);
  return [...latest.values()];
}

export function buildGuidedResults(source: ResultSource, ownerId: string): GuidedTreeResult[] {
  const projects = new Map(source.projects.filter(p => p.owner_id === ownerId).map(p => [p.id, p]));
  const sites = new Map(source.sites.filter(s => projects.has(s.project_id)).map(s => [s.id, s]));
  const events = new Map(source.events.map(e => [e.id, e]));
  const trees = new Map(source.trees.map(t => [t.id, t]));
  const series = new Map(latestResultSeries(source.series).map(s => [s.tree_sample_id, s]));
  const captures = new Map<string, ResultCapture[]>();
  for (const view of source.captures.filter(v => v.active)) {
    const key = `${view.capture_series_id}:${view.direction}`;
    captures.set(key, [...(captures.get(key) ?? []), view]);
  }
  const reviews = new Map(source.reviews.filter(r => r.owner_id === ownerId).map(r => [r.image_id, r]));
  const results: GuidedTreeResult[] = [];
  for (const sample of source.samples) {
    const site = sites.get(sample.site_id), event = events.get(sample.sampling_event_id), tree = trees.get(sample.tree_id);
    if (!site || !event || !tree || event.site_id !== site.id || tree.site_id !== site.id) continue;
    const views = {} as Record<Direction, SavedViewResult>;
    for (const direction of DIRECTIONS) {
      const active = captures.get(`${series.get(sample.id)?.id}:${direction}`) ?? [];
      let value: SavedViewResult = { state: "missing", imageId: null, coverage: null, savedAt: null };
      if (active.length > 1) value.state = "invalid"; // Fail closed on ambiguous active captures.
      else if (active.length === 1) {
        value = { ...value, imageId: active[0].image_id, state: "pending" };
        const row = reviews.get(active[0].image_id);
        if (row) {
          const review = row.tree_sample_id === sample.id && row.direction === direction
            ? parseGuidedReview(JSON.stringify(row.review)) : null;
          if (!review) value.state = "invalid";
          else if (review.savedAt && review.analysis) value = { ...value, state: "saved",
            coverage: 100 * review.analysis.lichen / review.analysis.total, savedAt: review.savedAt };
        }
      }
      views[direction] = value;
    }
    const saved = DIRECTIONS.map(d => views[d]).filter(v => v.state === "saved");
    results.push({ sampleId: sample.id, tree, project: projects.get(site.project_id)!, site, event, views,
      savedCount: saved.length, uploadedCount: DIRECTIONS.filter(d => views[d].state !== "missing").length,
      complete: saved.length === 4, lastSavedAt: saved.map(v => v.savedAt!).sort().at(-1) ?? null });
  }
  return results.sort((a, b) => b.event.sampled_at.localeCompare(a.event.sampled_at)
    || a.event.id.localeCompare(b.event.id) || a.tree.code.localeCompare(b.tree.code) || a.sampleId.localeCompare(b.sampleId));
}

export function guidedProgress(rows: GuidedTreeResult[]) {
  return { evaluations: rows.length, trees: new Set(rows.map(r => r.tree.id)).size,
    complete: rows.filter(r => r.complete).length,
    started: rows.filter(r => !r.complete && r.uploadedCount > 0).length,
    pending: rows.filter(r => r.uploadedCount === 0).length,
    savedViews: rows.reduce((sum, r) => sum + r.savedCount, 0) };
}
export interface ResultFilters { projectId?: string; siteId?: string; eventId?: string; treeSampleId?: string }
export function filterGuidedResults(rows: GuidedTreeResult[], filters: ResultFilters) {
  return rows.filter(r => (!filters.projectId || r.project.id === filters.projectId)
    && (!filters.siteId || r.site.id === filters.siteId) && (!filters.eventId || r.event.id === filters.eventId)
    && (!filters.treeSampleId || r.sampleId === filters.treeSampleId));
}
export function guidedResultHref(row: GuidedTreeResult, summary = true) {
  return `/images?${new URLSearchParams({ ...(summary ? { mode: "summary" } : {}), projectId: row.project.id,
    siteId: row.site.id, eventId: row.event.id, treeSampleId: row.sampleId })}`;
}

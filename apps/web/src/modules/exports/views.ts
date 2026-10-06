import { buildGuidedResults, type ResultSource } from "../four-view/guided-results";
import { DIRECTIONS } from "../four-view/types";
import { type DataExport, type ExportRow } from "./data";
export function viewExportRows(snapshot: DataExport): ExportRow[] {
  const t = snapshot.tables;
  const source = { projects: t.projects, sites: t.sites, events: t.sampling_events, trees: t.trees,
    samples: t.tree_samples, series: t.capture_series, captures: t.capture_views, reviews: t.guided_capture_reviews } as unknown as ResultSource;
  return buildGuidedResults(source, snapshot.ownerId).flatMap(row => DIRECTIONS.map(direction => ({
    project_id: row.project.id, project: row.project.name, site_id: row.site.id, site: row.site.name,
    event_id: row.event.id, event: row.event.name, sampled_at: row.event.sampled_at,
    tree_id: row.tree.id, tree: row.tree.code, tree_sample_id: row.sampleId,
    direction, image_id: row.views[direction].imageId, state: row.views[direction].state,
    coverage_percent: row.views[direction].coverage, saved_at: row.views[direction].savedAt,
    unit: "percent_of_selected_trunk", scientific_notice: snapshot.scientificNotice,
  })));
}
export const VIEW_COLUMNS = ["project_id", "project", "site_id", "site", "event_id", "event", "sampled_at", "tree_id", "tree", "tree_sample_id", "direction", "image_id", "state", "coverage_percent", "saved_at", "unit", "scientific_notice"];

import { DIRECTIONS, DIRECTION_LABELS, type Direction } from "../four-view/types";
import { guidedResultHref, type GuidedTreeResult, type ResultProject, type ResultSite } from "../four-view/guided-results";
import type { EcologySummaryData } from "../four-view/ecology-summary";

export type SamplingEventRow = {
  id: string;
  site_id: string;
  name: string;
  sampled_at: string;
  status: string;
  updated_at: string;
};

export type TreeRow = { id: string; site_id: string };
export type SampleRow = { id: string; tree_id: string; sampling_event_id: string };
export type CaptureSeriesRow = {
  id: string;
  tree_sample_id: string;
  status: string;
  valid_view_count: number;
  pending_view_count: number;
  confirmed_at: string | null;
  updated_at: string;
};

export interface DashboardJourneySummary {
  event: SamplingEventRow;
  site: ResultSite;
  project: ResultProject;
  rows: GuidedTreeResult[];
  sampleCount: number;
  uniqueTreeCount: number;
  savedViews: number;
  lastSavedAt: string | null;
  latestActivityAt: string | null;
  workHref: string;
  workLabel: string;
  resultsHref: string | null;
  indicatorHref: string;
  suggestedRow: GuidedTreeResult | null;
  suggestedTreeLabel: string | null;
}

export interface DashboardHomeSnapshot {
  projects: number;
  sites: number;
  journeys: number;
  uniqueTrees: number;
  openJourneys: DashboardJourneySummary[];
  recentJourneys: DashboardJourneySummary[];
}

export interface DashboardFocusSnapshot {
  journey: DashboardJourneySummary;
  guardado: { status: string; detail: string };
  captura: { status: string; detail: string };
  diversidad: { status: string; detail: string };
  jornada: { status: string; detail: string };
}

function maxIso(values: readonly (string | null | undefined)[]) {
  const filtered = values.filter((value): value is string => Boolean(value));
  return filtered.sort().at(-1) ?? null;
}

function incompleteDirections(row: GuidedTreeResult, predicate: (direction: Direction) => boolean) {
  return DIRECTIONS.filter((direction) => predicate(direction)).map((direction) => DIRECTION_LABELS[direction]);
}

function captureDetail(row: GuidedTreeResult) {
  const invalid = incompleteDirections(row, (direction) => row.views[direction].state === "invalid");
  if (invalid.length) {
    return {
      status: "Requiere revisión",
      detail: invalid.length === 1 ? `Revisa ${invalid[0]}` : `Revisa ${invalid.join(", ")}`,
    };
  }
  if (row.savedCount === 4) {
    return { status: "Completo", detail: "4 de 4 vistas revisadas" };
  }
  if (row.uploadedCount === 0) {
    return { status: "Sin iniciar", detail: "Aún no hay vistas guardadas para este árbol" };
  }
  const pending = incompleteDirections(row, (direction) => row.views[direction].state !== "saved");
  return {
    status: "En progreso",
    detail: `${row.savedCount} de 4 vistas revisadas${pending.length ? ` · Falta ${pending.join(" y ")}` : ""}`,
  };
}

function persistedDetail(row: GuidedTreeResult) {
  const invalid = DIRECTIONS.some((direction) => row.views[direction].state === "invalid");
  if (invalid) {
    return { status: "Requiere revisión", detail: `${row.savedCount} de 4 vistas con guardado persistido` };
  }
  if (row.savedCount === 4) {
    return { status: "Completo", detail: "4 de 4 vistas con guardado persistido" };
  }
  if (row.uploadedCount === 0) {
    return { status: "Sin iniciar", detail: "Todavía no hay fotos persistidas" };
  }
  return { status: "En progreso", detail: `${row.savedCount} de 4 vistas con guardado persistido` };
}

function sortContinueCandidate(a: GuidedTreeResult, b: GuidedTreeResult) {
  const score = (row: GuidedTreeResult) => {
    const invalid = DIRECTIONS.some((direction) => row.views[direction].state === "invalid") ? 10 : 0;
    return invalid + row.savedCount * 2 + row.uploadedCount;
  };
  return score(b) - score(a)
    || (b.lastSavedAt ?? "").localeCompare(a.lastSavedAt ?? "")
    || a.tree.code.localeCompare(b.tree.code);
}

function continueTarget(event: SamplingEventRow, rows: GuidedTreeResult[], sampleCount: number) {
  if (event.status === "completed") {
    return {
      href: `/analysis?eventId=${encodeURIComponent(event.id)}`,
      label: "Ver resultados",
      row: null as GuidedTreeResult | null,
    };
  }
  const row = [...rows].filter((candidate) => !candidate.complete).sort(sortContinueCandidate)[0] ?? null;
  if (row) {
    return { href: guidedResultHref(row, false), label: "Continuar jornada", row };
  }
  if (sampleCount > 0) {
    return {
      href: `/analysis?eventId=${encodeURIComponent(event.id)}`,
      label: "Continuar jornada",
      row: null as GuidedTreeResult | null,
    };
  }
  return {
    href: `/jornada/${encodeURIComponent(event.id)}`,
    label: "Continuar jornada",
    row: null as GuidedTreeResult | null,
  };
}

export function buildDashboardHomeSnapshot(input: {
  projects: ResultProject[];
  sites: ResultSite[];
  events: SamplingEventRow[];
  trees: TreeRow[];
  samples: SampleRow[];
  series: CaptureSeriesRow[];
  rows: GuidedTreeResult[];
}): DashboardHomeSnapshot {
  const projects = new Map(input.projects.map((project) => [project.id, project]));
  const sites = new Map(input.sites.map((site) => [site.id, site]));
  const rowsByEvent = new Map<string, GuidedTreeResult[]>();
  for (const row of input.rows) rowsByEvent.set(row.event.id, [...(rowsByEvent.get(row.event.id) ?? []), row]);
  const samplesByEvent = new Map<string, SampleRow[]>();
  for (const sample of input.samples) samplesByEvent.set(sample.sampling_event_id, [...(samplesByEvent.get(sample.sampling_event_id) ?? []), sample]);
  const seriesBySample = new Map(input.series.map((series) => [series.tree_sample_id, series]));
  const summaries = input.events.flatMap((event) => {
    const site = sites.get(event.site_id);
    const project = site ? projects.get(site.project_id) : null;
    if (!site || !project) return [];
    const rows = rowsByEvent.get(event.id) ?? [];
    const samples = samplesByEvent.get(event.id) ?? [];
    const target = continueTarget(event, rows, samples.length);
    const latestSeries = maxIso(samples.map((sample) => seriesBySample.get(sample.id)?.updated_at ?? null));
    return [{
      event,
      site,
      project,
      rows,
      sampleCount: samples.length,
      uniqueTreeCount: new Set(samples.map((sample) => sample.tree_id)).size,
      savedViews: rows.reduce((sum, row) => sum + row.savedCount, 0),
      lastSavedAt: maxIso(rows.map((row) => row.lastSavedAt)),
      latestActivityAt: maxIso([maxIso(rows.map((row) => row.lastSavedAt)), latestSeries]),
      workHref: target.href,
      workLabel: target.label,
      resultsHref: rows.length || samples.length ? `/analysis?eventId=${encodeURIComponent(event.id)}` : null,
      indicatorHref: `/environmental-quality?mode=guided&eventId=${encodeURIComponent(event.id)}`,
      suggestedRow: target.row,
      suggestedTreeLabel: target.row?.tree.code ?? null,
    }];
  }).sort((a, b) =>
    Number(b.event.status !== "completed") - Number(a.event.status !== "completed")
    || (b.latestActivityAt ?? "").localeCompare(a.latestActivityAt ?? "")
    || b.event.sampled_at.localeCompare(a.event.sampled_at)
    || a.event.name.localeCompare(b.event.name));
  return {
    projects: input.projects.length,
    sites: input.sites.length,
    journeys: summaries.length,
    uniqueTrees: new Set(input.trees.map((tree) => tree.id)).size,
    openJourneys: summaries.filter((summary) => summary.event.status !== "completed"),
    recentJourneys: summaries.slice(0, 5),
  };
}

export function buildDashboardFocusSnapshot(summary: DashboardJourneySummary, ecology?: EcologySummaryData): DashboardFocusSnapshot {
  const persisted = summary.suggestedRow ? persistedDetail(summary.suggestedRow) : summary.sampleCount
    ? { status: "En progreso", detail: `${summary.savedViews} vista(s) guardadas en esta jornada` }
    : { status: "Sin iniciar", detail: "Todavía no hay árboles vinculados a esta jornada" };
  const capture = summary.suggestedRow ? captureDetail(summary.suggestedRow) : summary.sampleCount
    ? { status: "En progreso", detail: "Abre el resumen para revisar pendientes de la jornada" }
    : { status: "Sin iniciar", detail: "Añade el primer árbol para empezar la captura" };
  const diversity = !ecology || !ecology.trees.length
    ? { status: "Sin iniciar", detail: "Aún no hay cuadrantes iniciados" }
    : ecology.changed > 0
      ? { status: "Requiere revisión", detail: `${ecology.changed} cuadrante(s) deben actualizarse tras cambiar el tronco` }
      : ecology.unavailable > 0
        ? { status: "Requiere revisión", detail: `${ecology.unavailable} vista(s) necesitan guardar o revisar la captura` }
        : ecology.quadrats === 0
          ? { status: "Sin iniciar", detail: "La diversidad todavía no se ha empezado" }
          : ecology.quadrats < ecology.expectedViews
            ? { status: "En progreso", detail: `${ecology.quadrats} de ${ecology.expectedViews} cuadrantes guardados` }
            : { status: "Completo", detail: `${ecology.expectedViews} de ${ecology.expectedViews} cuadrantes guardados` };
  return {
    journey: summary,
    guardado: persisted,
    captura: capture,
    diversidad: diversity,
    jornada: {
      status: summary.event.status === "completed" ? "Completo" : "En progreso",
      detail: summary.event.status === "completed" ? "Jornada cerrada" : "Jornada abierta",
    },
  };
}

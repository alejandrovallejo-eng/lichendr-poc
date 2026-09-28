"use client";

import { useState } from "react";
import ContextTrail from "@/components/ContextTrail";
import { DIRECTIONS, DIRECTION_LABELS } from "./types";
import { filterGuidedResults, guidedProgress, guidedResultHref, type GuidedTreeResult, type ResultFilters, type SavedViewResult } from "./guided-results";
import { useGuidedResults } from "./use-guided-results";
import { ecologyHref } from "./ecology";
import JornadaSummary from "./JornadaSummary";

export function savedViewLabel(view: SavedViewResult) {
  if (view.state === "saved") return `${view.coverage!.toFixed(1)}%`;
  return { missing: "Sin foto", pending: "Sin guardar", invalid: "Revisar guardado" }[view.state];
}
export function GuidedProgress({ rows }: { rows: GuidedTreeResult[] }) {
  const progress = guidedProgress(rows);
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Progreso de las capturas guiadas">
    {[[progress.complete, "Con 4 vistas guardadas"], [progress.started, "En progreso"],
      [progress.pending, "Sin iniciar"], [progress.savedViews, "Vistas guardadas"]].map(([count, label]) =>
      <div key={label} className="rounded-lg border p-3" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <p className="text-2xl font-bold">{count}</p><p className="text-sm">{label}</p>
      </div>)}
  </div>;
}

// Presentation is separate from the reader so filters, links and missing-data
// states can be tested without a database, a photograph or model weights.
export function GuidedResultsView({ rows, filters = {}, onRefresh, environmental = false }: {
  rows: GuidedTreeResult[]; filters?: ResultFilters; onRefresh?: () => void;
  environmental?: boolean;
}) {
  const [draft, setDraft] = useState(filters);
  const selected = filterGuidedResults(rows, filters);
  const unique = <T extends { id: string; name: string }>(items: T[]) => [...new Map(items.map(item => [item.id, item])).values()];
  const projects = unique(rows.map(r => r.project));
  const sites = unique(rows.filter(r => !draft.projectId || r.project.id === draft.projectId).map(r => r.site));
  const events = unique(rows.filter(r => (!draft.projectId || r.project.id === draft.projectId) && (!draft.siteId || r.site.id === draft.siteId)).map(r => r.event));
  const resultPath = environmental ? "/environmental-quality" : "/analysis";
  const journeyHref = (eventId: string) => `${resultPath}?${new URLSearchParams(environmental ? { mode: "guided", eventId } : { eventId }).toString()}`;
  const selector = (name: "projectId" | "siteId" | "eventId", title: string, options: { id: string; name: string }[]) =>
    <label className="flex min-w-0 flex-col gap-1 text-sm"><span>{title}</span>
      <select name={name} value={draft[name] ?? ""} className="min-w-0 rounded border bg-white p-2" onChange={e => setDraft({ ...draft,
        [name]: e.target.value, ...(name === "projectId" ? { siteId: "", eventId: "" } : name === "siteId" ? { eventId: "" } : {}), treeSampleId: "" })}>
        <option value="">Todos</option>
        {draft[name] && !options.some(o => o.id === draft[name]) ? <option value={draft[name]}>Selección sin resultados</option> : null}
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>;
  return <section className="space-y-5">
    <header><h1 className="text-2xl font-bold">{environmental ? "Datos para la evaluación ambiental" : "Resultados por jornada"}</h1>
      <p className="mt-1 text-sm">Elige una jornada para ver juntos sus árboles, cuatro vistas, cobertura y diversidad.</p>
      {!environmental ? <p className="mt-2 text-sm">El resumen de jornadas y el indicador biológico relativo se consultan por separado para no mezclar su significado.</p> : null}
      {environmental ? <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm">Aquí se incluyen tus capturas guiadas. La calidad del aire todavía no está estimada; los datos guardados se muestran sin convertirlos en una clasificación ambiental.</p> : null}</header>
    <form action={resultPath} method="get" className="grid items-end gap-3 rounded-lg border p-4 md:grid-cols-4" style={{ borderColor: "var(--ld-border)" }}>
      {environmental ? <input type="hidden" name="mode" value="guided" /> : null}
      {selector("projectId", "Proyecto", projects)}{selector("siteId", "Sitio / zona", sites)}{selector("eventId", "Jornada", events)}
      {draft.treeSampleId ? <input type="hidden" name="treeSampleId" value={draft.treeSampleId} /> : null}
      <button type="submit" className="rounded px-4 py-2 font-semibold text-white" style={{ background: "var(--ld-sidebar, #173D35)" }}>Ver resultados</button>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p>{guidedProgress(selected).trees} árbol(es) · {selected.length} evaluación(es) en {new Set(selected.map(r => r.event.id)).size} jornada(s)</p>
      <div className="flex flex-wrap gap-4"><a href="/analysis" className="underline">Ver todas las jornadas</a>
        {!environmental ? <a href="/environmental-quality" className="underline">Indicador biológico relativo</a> : <a href="/analysis" className="underline">Resumen de jornadas</a>}
        {filters.eventId ? <a href={`/jornada/${encodeURIComponent(filters.eventId)}`} className="underline">Revisar / cerrar jornada</a> : null}
        <button type="button" onClick={onRefresh} className="underline">Actualizar</button></div>
    </div>
    <GuidedProgress rows={selected} />
    <p className="rounded-lg bg-amber-50 p-3 text-sm">Cobertura estimada por colores dentro del tronco delimitado en cada foto. No es cobertura de todo el árbol ni un índice de calidad del aire. BioCLIP revisa ejemplos, no valida toda la máscara. No se suman ni se promedian píxeles entre fotos.</p>
    {selected.length === 0 ? <div className="rounded-lg border p-6"><p>No hay evaluaciones de árboles para esta selección.</p>
      <a className="mt-2 inline-block underline" href="/preparar-jornada">Ir a preparar jornada</a></div> :
      <div className="space-y-4">{selected.map(row => <article key={row.sampleId} className="rounded-xl border bg-white p-4" style={{ borderColor: "var(--ld-border)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div>
          <h2 className="text-lg font-bold">{row.tree.code}</h2>
          <ContextTrail entries={[
            { label: "Proyecto", value: row.project.name },
            { label: "Sitio", value: row.site.name },
            { label: "Jornada", value: row.event.name },
            { label: "Árbol", value: row.tree.code },
          ]} />
          <a className="text-sm underline" href={`/jornada/${encodeURIComponent(row.event.id)}`}>{row.event.name} · {row.event.sampled_at.slice(0, 10)}</a>
          <a className="mt-2 block font-semibold underline" href={journeyHref(row.event.id)}>Abrir resumen de esta jornada</a>
        </div><span className={`rounded-full px-3 py-1 text-sm ${row.complete ? "bg-emerald-100" : "bg-amber-50"}`}>
          {row.savedCount}/4 vistas guardadas{row.complete ? " · Completo" : " · Pendiente"}</span></div>
        <dl className="my-4 grid grid-cols-2 gap-2 md:grid-cols-4">{DIRECTIONS.map(d => <div key={d} className="rounded-lg bg-stone-50 p-3">
          <dt className="text-sm">{DIRECTION_LABELS[d]}</dt><dd className="text-lg font-semibold">{savedViewLabel(row.views[d])}</dd>
        </div>)}</dl>
        <div className="flex flex-wrap gap-3"><a className="rounded px-4 py-2 font-semibold text-white" style={{ background: "var(--ld-sidebar, #173D35)" }} href={guidedResultHref(row)}>Ver las 4 vistas y el 360°</a>
          <a className="rounded border px-4 py-2" href={ecologyHref(row.event.id,row.sampleId)}>Análisis de diversidad</a>
          {!row.complete ? <a className="rounded border px-4 py-2" href={guidedResultHref(row, false)}>Continuar captura</a> : null}</div>
        {row.lastSavedAt ? <p className="mt-3 text-xs text-stone-600">Último guardado: {new Date(row.lastSavedAt).toLocaleString("es-DO")}</p> : null}
      </article>)}</div>}
    <p className="text-sm">¿Buscas evaluaciones del flujo anterior? <a className="underline" href={`${resultPath}?mode=classic`}>Abrir análisis clásico</a>. Se conservan por separado.</p>
  </section>;
}

export default function GuidedResults({ filters = {}, environmental = false }: { filters?: ResultFilters; environmental?: boolean }) {
  if (filters.eventId && !filters.treeSampleId) return <JornadaSummary filters={{ ...filters, eventId: filters.eventId }} environmental={environmental} />;
  return <GuidedResultsList filters={filters} environmental={environmental} />;
}
function GuidedResultsList({ filters, environmental }: { filters: ResultFilters; environmental: boolean }) {
  const { rows, error, retry } = useGuidedResults(filters.eventId);
  if (error) return <section className="rounded-lg border p-5"><h1 className="text-xl font-bold">Resultados por jornada</h1><p role="alert" className="my-3">{error}</p><button onClick={retry} className="underline">Reintentar lectura</button></section>;
  if (!rows) return <p role="status">Cargando análisis guardados…</p>;
  return <GuidedResultsView key={JSON.stringify(filters)} rows={rows} filters={filters} onRefresh={retry} environmental={environmental} />;
}

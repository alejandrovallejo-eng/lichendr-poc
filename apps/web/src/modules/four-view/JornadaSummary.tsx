"use client";

import { useEffect, useState } from "react";
import ContextTrail from "@/components/ContextTrail";
import EcologySummary from "./EcologySummary";
import { ecologyHref } from "./ecology";
import { filterGuidedResults, type ResultFilters } from "./guided-results";
import { loadJornadaSummary, type JornadaSummarySnapshot } from "./jornada-summary-client";

export function JornadaSummaryView({ snapshot, onRefresh, environmental = false }: {
  snapshot: JornadaSummarySnapshot; onRefresh?: () => void; environmental?: boolean;
}) {
  const { data, event } = snapshot;
  const query = new URLSearchParams({ eventId: event.id }).toString();
  const environmentalListHref = "/environmental-quality?mode=guided";
  const context = data.rows[0];
  return <section className="space-y-5" aria-label="Resumen unificado de jornada">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Resumen de la jornada</h1><p className="mt-1 font-semibold">{event.name}</p>
        {context ? <ContextTrail className="mt-1" entries={[
          { label: "Proyecto", value: context.project.name },
          { label: "Sitio", value: context.site.name },
          { label: "Jornada", value: event.name },
        ]} /> : null}
        {context ? <p className="mt-1 text-sm">{context.event.sampled_at.slice(0, 10)}</p> : null}</div>
      <span className="rounded-full bg-emerald-50 px-3 py-1">Jornada {event.status === "completed" ? "cerrada" : "abierta"}</span>
    </header>
    <nav className="flex flex-wrap gap-4 text-sm" aria-label="Acciones del resumen">
      <a className="underline" href={environmental ? environmentalListHref : "/analysis"}>Elegir otra jornada</a>
      <a className="underline" href={`/jornada/${encodeURIComponent(event.id)}`}>{event.status === "completed" ? "Revisar o reabrir jornada" : "Continuar / cerrar jornada"}</a>
      <a className="underline" href={ecologyHref(event.id)}>Editar cuadrantes y catálogo</a>
      <button className="underline" type="button" onClick={onRefresh}>Actualizar resultados</button>
    </nav>
    <aside className="rounded-xl border bg-emerald-50 p-4 text-sm" aria-label="Alcance ambiental">
      <h2 className="font-semibold">Tus datos de cobertura y diversidad están aquí</h2>
      <p className="mt-1">El tronco y el cuadrante son superficies distintas: cada porcentaje se muestra por separado. No se promedian fotos ni se cuentan pendientes como cero.</p>
      <p className="mt-1">Calidad del aire: todavía no estimada. Este resumen describe lo observado; cerrar la jornada no convierte estos datos en una medición del aire.</p>
      <a className="mt-2 inline-block underline" href={`${environmental ? "/analysis" : "/environmental-quality"}?${query}`}>
        {environmental ? "Ver estos mismos resultados en Análisis" : "Ver estos mismos datos en Calidad ambiental"}</a>
    </aside>
    <EcologySummary data={data} eventId={event.id} includeCapture onReview={(sampleId) => {
      window.location.assign(ecologyHref(event.id, sampleId));
    }} />
    <p className="text-sm">Evaluaciones anteriores: <a className="underline" href={`${environmental ? "/environmental-quality" : "/analysis"}?mode=classic`}>Abrir flujo clásico</a>. Se conservan por separado.</p>
  </section>;
}

type Props = { filters: ResultFilters & { eventId: string }; environmental?: boolean; load?: typeof loadJornadaSummary };
export default function JornadaSummary(props: Props) {
  // A new selection remounts the reader; a late response cannot show another event's data.
  return <JornadaSummaryReader key={JSON.stringify(props.filters)} {...props} />;
}
function JornadaSummaryReader({ filters, environmental, load = loadJornadaSummary }: Props) {
  const [snapshot, setSnapshot] = useState<JornadaSummarySnapshot | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const { eventId } = filters;
  useEffect(() => {
    const abort = new AbortController();
    void load(eventId, abort.signal).then(value => {
      if (abort.signal.aborted) return;
      if (value.event.id !== eventId || filterGuidedResults(value.data.rows, { ...filters, treeSampleId: undefined }).length !== value.data.rows.length)
        throw new Error("La jornada no corresponde al proyecto o sitio elegido. Vuelve a elegirla.");
      setSnapshot(value);
    }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo abrir el resumen."); });
    return () => abort.abort();
  }, [eventId, filters, load, attempt]);
  const retry = () => { setSnapshot(null); setError(""); setAttempt(n => n + 1); };
  if (error) return <section className="space-y-3 rounded-xl border p-5"><h1 className="text-xl font-bold">Resumen de la jornada</h1>
    <p role="alert">{error}</p><p>Tus datos no se han modificado. No mostraremos un fallo de lectura como resultados vacíos.</p>
    <button className="underline" onClick={retry}>Reintentar lectura</button> · <a className="underline" href="/analysis">Elegir jornada</a></section>;
  if (!snapshot) return <p role="status">Reuniendo vistas, cuadrantes y catálogo guardados…</p>;
  return <JornadaSummaryView snapshot={snapshot} environmental={environmental} onRefresh={retry} />;
}

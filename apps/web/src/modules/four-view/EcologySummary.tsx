"use client";

import type { EcologyData } from "./ecology-client";
import { buildEcologySummary } from "./ecology-summary";
import { morphDisplayName } from "./ecology";
import { guidedResultHref } from "./guided-results";
import { DIRECTION_LABELS, type Direction } from "./types";

export default function EcologySummary({ data, eventId, onReview, includeCapture = false }: {
  data: EcologyData; eventId: string; onReview: (sampleId: string, direction: Direction) => void;
  includeCapture?: boolean;
}) {
  let summary;
  try { summary = buildEcologySummary(data, eventId); }
  catch (error) { return <p role="alert" className="rounded-lg bg-amber-50 p-4">{error instanceof Error ? error.message : "No se pudo preparar el resumen."}</p>; }
  const missing = summary.expectedViews - summary.quadrats;
  return <div className="space-y-5" aria-label="Resumen ecológico de la jornada">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[[summary.trees.length, "Árboles de la jornada"], includeCapture
        ? [`${data.rows.reduce((n, r) => n + r.savedCount, 0)}/${summary.expectedViews}`, "Vistas guardadas N/E/S/O"]
        : [`${summary.treesReviewed}/${summary.trees.length}`, "Con algún cuadrante revisado"],
        [`${summary.quadrats}/${summary.expectedViews}`, "Cuadrantes vigentes N/E/S/O"], [summary.quadrats ? summary.morphs.length : "—", "Morfoespecies registradas"]].map(([value, label]) =>
        <div key={label} className="rounded-xl border bg-white p-4"><p className="text-2xl font-bold">{value}</p><p className="text-sm">{label}</p></div>)}
    </div>
    {!summary.trees.length ? <p className="rounded-lg bg-stone-50 p-4">Aún no hay árboles para resumir. <a className="underline" href={`/jornada/${encodeURIComponent(eventId)}`}>Volver a la jornada</a>.</p>
      : <div className={`rounded-xl p-4 text-sm ${missing ? "bg-amber-50" : "bg-emerald-50"}`}>
        <p className="font-semibold">{missing ? "Resumen parcial" : "Las cuatro vistas de cada árbol tienen cuadrante vigente"}</p>
        <p>{summary.treesComplete} de {summary.trees.length} árboles tienen los cuatro cuadrantes revisados.</p>
        {missing ? <p>{summary.pending} cuadrantes por elegir · {summary.changed} por actualizar tras cambiar el tronco · {summary.unavailable} vistas que requieren guardar o revisar su captura.</p> : null}
        <p className="mt-1">{missing ? "Cerrar la jornada no completa estos pendientes. Un dato sin revisar no equivale a cero." : "La revisión completa no equivale a validación de especies ni de calidad del aire."}</p>
      </div>}

    <section className="rounded-xl border bg-white p-4" aria-label="Morfoespecies entre árboles">
      <h2 className="text-lg font-bold">Morfoespecies entre árboles</h2>
      <p className="mt-1 text-sm text-stone-600">Cada árbol cuenta una sola vez por morfoespecie, aunque aparezca en varias vistas. Se incluyen solo cuadrantes guardados y vigentes.</p>
      {!summary.quadrats ? <p className="mt-3">Aún no hay cuadrantes revisados; no se puede describir la diversidad.</p>
        : !summary.morphs.length ? <p className="mt-3">Los cuadrantes revisados no tienen morfoespecies marcadas. Esto no demuestra ausencia de líquenes.</p>
        : <ul className="mt-3 divide-y">{summary.morphs.map(m => <li key={m.id} className="py-3">
          <div className="flex flex-wrap justify-between gap-2"><strong className="break-words" style={{ overflowWrap: "anywhere" }}>{m.name}</strong>
            <span className="text-sm">Registrada en {m.trees} de {summary.treesReviewed} árboles con cuadrantes revisados</span></div>
          <details className="mt-2 text-sm"><summary className="cursor-pointer underline">Ver cobertura en sus {m.occurrences.length} cuadrante(s)</summary>
            <ul className="mt-2 space-y-2">{m.occurrences.map(o => <li key={`${o.sampleId}:${o.direction}`} className="flex flex-wrap justify-between gap-2">
              <span>{o.treeCode} · {DIRECTION_LABELS[o.direction]}: <strong>{o.percent.toFixed(1)} % del cuadrante</strong></span>
              <button type="button" className="underline" onClick={() => onReview(o.sampleId, o.direction)}>Abrir {o.treeCode} · {DIRECTION_LABELS[o.direction]}</button>
            </li>)}</ul>
          </details>
        </li>)}</ul>}
      {summary.catalogueOnly > 0 ? <p className="mt-3 text-sm text-stone-600">{summary.catalogueOnly} entrada(s) del catálogo aún no aparecen marcadas en los cuadrantes vigentes; no se cuentan como observaciones.</p> : null}
      {summary.quadrats > 0 ? <p className="mt-3 text-sm text-stone-600">Los árboles con una sola vista revisada también figuran en este recuento. «No registrada» no significa «ausente».</p> : null}
    </section>

    <section className="space-y-3" aria-label="Árboles y cuadrantes">
      <h2 className="text-lg font-bold">Árboles y sus cuatro vistas</h2>
      {summary.trees.map(({ tree, views, savedCount, morphIds }) => <article id={`arbol-${tree.sampleId}`} key={tree.sampleId} className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">{tree.tree.code}</h3>
          {includeCapture ? <p className="text-sm">{tree.savedCount}/4 vistas guardadas</p> : null}
          <p className="text-sm">{savedCount}/4 cuadrantes revisados{savedCount ? ` · ${morphIds.length} morfoespecies registradas` : " · diversidad pendiente"}</p></div>
          <a className="text-sm underline" href={guidedResultHref(tree)}>Ver tronco completo y 360°</a></div>
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">{views.map(v => <div key={v.direction} className={`rounded-lg p-3 text-sm ${v.state === "saved" ? "bg-emerald-50" : "bg-stone-50"}`}>
          <h4 className="font-semibold">{DIRECTION_LABELS[v.direction]}</h4>
          {includeCapture ? <p className="my-2 font-semibold">Tronco delimitado: {tree.views[v.direction].state === "saved"
            ? `${tree.views[v.direction].coverage!.toFixed(1)} %`
            : { missing: "Sin foto", pending: "Sin guardar", invalid: "Revisar guardado", saved: "Guardada" }[tree.views[v.direction].state]}</p> : null}
          <p>{v.state === "saved" ? "Cuadrante guardado" : v.state === "changed" ? "Tronco modificado: revisar" : v.state === "pending" ? "Cuadrante pendiente" : "Captura pendiente o por revisar"}</p>
          {v.state === "saved" ? <details className="mt-2" open={includeCapture || undefined}><summary className="cursor-pointer underline">Cobertura del cuadrante</summary>
            <ul className="mt-2 space-y-1">{v.row!.review.config.confirmed!.groups.filter(g => g.id !== "unassigned" && v.row!.review.counts[g.label] > 0).map(g =>
              <li key={g.id} style={{ overflowWrap: "anywhere" }}>{morphDisplayName(data.catalog.find(m => m.id === g.id)!)}: {(100 * v.row!.review.counts[g.label] / v.row!.review.total).toFixed(1)} %</li>)}
              <li>Sin clasificar: {(100 * v.row!.review.counts[1] / v.row!.review.total).toFixed(1)} %</li></ul>
            {!v.row!.review.config.confirmed!.groups.some(g => g.id !== "unassigned" && v.row!.review.counts[g.label] > 0) ? <p>Revisado sin morfoespecies marcadas.</p> : null}
          </details> : null}
          {v.state === "unavailable" ? <a className="mt-2 inline-block underline" href={guidedResultHref(tree, false)}>Abrir captura</a>
            : <button type="button" className="mt-2 underline" onClick={() => onReview(tree.sampleId, v.direction)}>{v.state === "saved" ? "Revisar" : "Continuar"} {DIRECTION_LABELS[v.direction]}</button>}
        </div>)}</div>
      </article>)}
    </section>
    <details className="rounded-xl border p-4 text-sm"><summary className="cursor-pointer font-semibold">Cómo leer este resumen</summary>
      <p className="mt-2">Describe únicamente los árboles y cuadrantes revisados de esta jornada y sitio. No extrapola al área completa ni estima calidad del aire.</p>
      <p className="mt-2">Cada porcentaje usa como denominador su propio cuadrante. Sin escala física ni protocolo comparable, no sumamos ni promediamos coberturas entre fotos. El tronco completo es un análisis separado.</p>
      <p className="mt-2">Los tonos aceptados delimitan morfoespecies; sus nombres no validan una identificación taxonómica. Lo no clasificado sigue siendo desconocido, no corteza asumida. El recuento es de grupos, no de individuos.</p>
    </details>
  </div>;
}

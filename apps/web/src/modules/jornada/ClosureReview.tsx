"use client";

import { useEffect, useRef, useState } from "react";
import { DIRECTIONS, DIRECTION_LABELS } from "../four-view/types";
import { guidedResultHref } from "../four-view/guided-results";
import { closureBlock, closureSummary, type ClosureEvent, type ClosureSnapshot } from "./closure";
import type { ClosureChange } from "./closure-client";

export interface ClosureReviewProps {
  eventId: string;
  load: (eventId: string) => Promise<ClosureSnapshot>;
  change: (snapshot: ClosureSnapshot, target: ClosureEvent["status"], acknowledged: boolean) => Promise<ClosureChange>;
  onBack: () => void;
  navigate?: (href: string) => void;
}
const button = "rounded-lg border px-4 py-2 font-semibold disabled:opacity-50";

const openResults = (href: string) => window.location.assign(href);
export default function ClosureReview({ eventId, load, change, onBack, navigate = openResults }: ClosureReviewProps) {
  const [snapshot, setSnapshot] = useState<ClosureSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const request = useRef(0);
  const locked = useRef(false);

  useEffect(() => {
    const id = ++request.current;
    load(eventId).then(value => { if (id === request.current) setSnapshot(value); })
      .catch(() => { if (id === request.current) setError("No se pudo cargar la revisión. Reintenta; no se ha cerrado la jornada."); })
      .finally(() => { if (id === request.current) setBusy(false); });
    return () => { request.current++; };
  }, [eventId, load]);

  async function refresh() {
    if (locked.current) return;
    locked.current = true;
    const id = ++request.current;
    setBusy(true); setError(""); setNotice(""); setAcknowledged(false); setSnapshot(null);
    try { const value = await load(eventId); if (id === request.current) setSnapshot(value); }
    catch { if (id === request.current) setError("No se pudo cargar la revisión. Reintenta para comprobar su estado."); }
    finally { if (id === request.current) { setBusy(false); locked.current = false; } }
  }

  async function submit() {
    if (!snapshot || busy || error || locked.current) return;
    locked.current = true;
    const id = ++request.current;
    const target = snapshot.event.status === "completed" ? "draft" : "completed";
    setBusy(true); setNotice("");
    try {
      const result = await change(snapshot, target, acknowledged);
      if (id !== request.current) return;
      setSnapshot(result.snapshot); setAcknowledged(false);
      setNotice(result.changed ? target === "completed" ? "Jornada cerrada. Tus resultados y pendientes siguen disponibles." : "Jornada reabierta. Puedes continuar trabajando."
        : "La jornada cambió desde que la abriste. Revisa la información actualizada antes de confirmar.");
      if (result.changed && target === "completed" && result.snapshot.event.status === "completed")
        navigate(`/analysis?${new URLSearchParams({ eventId })}`);
    } catch (err) {
      if (id === request.current) setError(err instanceof Error ? err.message : "No se pudo confirmar el cambio. Actualiza la revisión.");
    } finally { if (id === request.current) { setBusy(false); locked.current = false; } }
  }

  const summary = snapshot ? closureSummary(snapshot.rows) : null;
  const closed = snapshot?.event.status === "completed";
  const block = snapshot && !closed ? closureBlock(snapshot, acknowledged) : null;
  return <section className="mx-auto max-w-5xl space-y-5" aria-label="Revisión y cierre de jornada" aria-busy={busy}>
    <button type="button" className="text-sm underline disabled:opacity-50" disabled={busy} onClick={onBack}>← Volver a los árboles</button>
    <header className="flex flex-wrap items-start justify-between gap-3"><div>
      <h1 className="text-2xl font-bold">Revisar y cerrar jornada</h1>
      <p className="mt-1">{snapshot?.event.name ?? "Consultando jornada…"}</p>
      {snapshot?.rows[0] ? <p className="text-sm text-stone-600">{snapshot.rows[0].project.name} · {snapshot.rows[0].site.name}</p> : null}
    </div>{snapshot ? <span className={`rounded-full px-3 py-1 font-semibold ${closed ? "bg-stone-200" : "bg-emerald-100"}`}>Jornada {closed ? "cerrada" : "abierta"}</span> : null}</header>
    <p className="text-sm">Cerrar indica que terminaste esta jornada por ahora. No certifica los análisis ni calcula calidad del aire. Los resultados siguen siendo editables; puedes reabrirla para continuar.</p>
    {notice ? <p role="status" className="rounded-lg bg-emerald-50 p-3">{notice}</p> : null}
    {error ? <p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p> : null}
    {busy ? <p role="status">Comprobando información guardada…</p> : null}
    {snapshot && summary ? <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Resumen de cierre">
        {[[summary.trees, "Árboles"], [summary.complete, "Con sus 4 vistas"], [`${summary.saved}/${summary.total}`, "Vistas guardadas"], [summary.pending, "Vistas pendientes"]].map(([value, label]) =>
          <div key={label} className="rounded-lg border bg-white p-3"><p className="text-2xl font-bold">{value}</p><p className="text-sm">{label}</p></div>)}
      </div>
      {summary.pending ? <p className="rounded-lg bg-amber-50 p-3 text-sm">Pendientes: {summary.missing} sin foto · {summary.unsaved} sin guardar · {summary.invalid} para revisar el guardado. No se cuentan como cobertura cero.</p> : null}
      {!summary.trees ? <p>Aún no hay árboles en esta jornada. Vuelve a los árboles para añadir el primero.</p> :
        <div className="space-y-3">{snapshot.rows.map(row => <article key={row.sampleId} className="rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">{row.tree.code}</h2>
            <a className="text-sm underline" href={guidedResultHref(row, row.complete)}>{row.complete ? "Ver árbol y 4 vistas" : "Revisar vistas pendientes"}</a></div>
          <dl className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">{DIRECTIONS.map(d => {
            const view = row.views[d];
            const label = view.state === "saved" ? `Guardada · ${view.coverage!.toFixed(1)}%`
              : { missing: "Sin foto", pending: "Sin guardar", invalid: "Revisar guardado" }[view.state];
            return <div key={d} className={`rounded-lg p-3 text-sm ${view.state === "saved" ? "bg-emerald-50" : "bg-amber-50"}`}><dt className="font-semibold">{DIRECTION_LABELS[d]}</dt><dd>{label}</dd></div>;
          })}</dl>
        </article>)}</div>}
      <div className="rounded-xl border p-4 space-y-4">
        {!closed && summary.pending > 0 ? <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={acknowledged} disabled={busy || !!error}
          onChange={e => setAcknowledged(e.target.checked)} /><span>Quiero cerrar con {summary.pending} vista(s) pendiente(s). Entiendo que seguirán indicadas como pendientes.</span></label> : null}
        <p className="text-sm">El análisis de diversidad es independiente y no es obligatorio para cerrar la captura. No se modifican fotos, colores aceptados ni coberturas.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={`${button} text-white`} style={{ background: "var(--ld-sidebar, #173D35)" }} disabled={busy || !!error || !!block} onClick={submit}>
            {closed ? "Reabrir jornada" : summary.pending ? "Cerrar con pendientes" : "Confirmar cierre de jornada"}</button>
          <button type="button" className={button} disabled={busy} onClick={refresh}>Actualizar revisión</button>
          <a className={button} href={`/analysis?${new URLSearchParams({ eventId })}`}>Ver resumen completo de la jornada</a>
        </div>
        {block && !closed ? <p className="text-sm text-stone-600">{block}</p> : null}
      </div>
    </> : !busy ? <button type="button" className={button} onClick={refresh}>Reintentar lectura</button> : null}
  </section>;
}

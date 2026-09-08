"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  confirmSeries,
  loadSeriesContext,
  loadTreeResults,
  type CaptureSeriesRow,
  type CaptureViewRow,
  type SeriesContext,
} from "@/modules/four-view/client";
import { DIRECTION_LABELS } from "@/modules/four-view/types";
import { jornadaTreesDestination } from "@/modules/four-view/navigation";
import { describeFailure, summarizeCaptureContext } from "@/modules/four-view/capture-flow";

// Plain-Spanish description of the real state of the series, so the user knows
// what is available, what is missing and what to do next.
function seriesStateSummary(series: CaptureSeriesRow): { title: string; detail: string } {
  if (series.status === "completed") {
    return {
      title: "Evaluación guardada",
      detail: "Este árbol quedó completado en esta jornada. Puedes consultarlo cuando quieras.",
    };
  }
  if (series.status === "analysis_ready") {
    return {
      title: "Resultados listos para revisar",
      detail: "Las cuatro vistas están procesadas. Revisa el resumen y guarda la evaluación.",
    };
  }
  return {
    title: "Resultados parciales",
    detail: `Faltan anotaciones por completar: ${series.pending_view_count} de 4 vistas siguen pendientes. Los valores mostrados todavía no son definitivos.`,
  };
}

export default function FourViewTreeResults({ seriesId }: { seriesId: string }) {
  // Everything loaded is tagged with the series it belongs to, so a pending
  // response or a navigation to another tree can never paint the results or
  // the context of the previous one.
  const [loaded, setLoaded] = useState<{
    seriesId: string;
    series: CaptureSeriesRow;
    views: CaptureViewRow[];
  } | null>(null);
  const [loadedContext, setLoadedContext] = useState<{ seriesId: string; context: SeriesContext | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void loadTreeResults(seriesId)
      .then((result) => {
        if (!active) return;
        setLoaded({ seriesId, series: result.series, views: result.views });
      })
      .catch(() => {
        if (active) setError("No se pudieron calcular los resultados de este árbol.");
      });
    void loadSeriesContext(seriesId)
      .then((resolved) => {
        if (active) setLoadedContext({ seriesId, context: resolved });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [seriesId]);

  const series = loaded?.seriesId === seriesId ? loaded.series : null;
  const views = loaded?.seriesId === seriesId ? loaded.views : [];
  const context = loadedContext?.seriesId === seriesId ? loadedContext.context : null;

  const complete = async () => {
    setSaving(true);
    setError(null);
    try {
      await confirmSeries(seriesId);
      const result = await loadTreeResults(seriesId);
      setLoaded({ seriesId, series: result.series, views: result.views });
    } catch (reason) {
      setError(describeFailure("analysis", reason instanceof Error ? reason.message : null).message);
    } finally {
      setSaving(false);
    }
  };

  if (!series) {
    return (
      <div className="rounded border p-4 text-sm" style={{ borderColor: "var(--ld-border)" }}>
        {error ?? "Calculando los resultados de este árbol…"}
      </div>
    );
  }

  const ready = series.status === "analysis_ready" || series.status === "completed";
  const state = seriesStateSummary(series);
  const contextEntries = summarizeCaptureContext({
    project: context?.project,
    site: context?.site,
    event: context?.event,
    tree: context?.tree,
  });
  const calibrated = (series.total_valid_area_cm2 ?? 0) > 0;
  const processedViews = views.filter((view) => view.valid_area_cm2 != null).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Resultados de este árbol"
        subtitle="Cobertura calculada con la unión de máscaras sobre las áreas calibradas. MobileSAM segmenta regiones; no identifica especies."
      />

      <section className="rounded-lg border p-5" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <h2 className="text-base font-semibold">Estás revisando</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {contextEntries.map((entry) => (
            <div key={entry.label}>
              <dt className="text-xs uppercase tracking-wide" style={{ color: "var(--ld-text-secondary)" }}>{entry.label}</dt>
              <dd className="text-sm font-semibold">{entry.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {error ? (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      ) : null}

      <section className="rounded-lg border p-5" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <h2 className="text-lg font-semibold">{state.title}</h2>
        <p className="mt-2 text-sm">{state.detail}</p>
        <p className="mt-2 text-sm">Vistas procesadas: {processedViews} de 4.</p>
        {!calibrated ? (
          <p className="mt-3 rounded p-3 text-sm" style={{ background: "#FFF3D6", color: "#664D03" }}>
            Sin escala calibrada no se pueden expresar áreas físicas. Los valores en cm² solo aparecen cuando la
            plantilla se detectó o se confirmó manualmente en cada vista.
          </p>
        ) : null}
      </section>

      {ready ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded border p-4" style={{ borderColor: "var(--ld-border)" }}><strong className="text-2xl">{series.tree_lichen_coverage_percent?.toFixed(1) ?? "—"}%</strong><p className="text-sm">Cobertura del árbol</p></article>
            <article className="rounded border p-4" style={{ borderColor: "var(--ld-border)" }}><strong className="text-2xl">{series.total_valid_area_cm2?.toFixed(0) ?? "—"}</strong><p className="text-sm">Área total evaluada cm²</p></article>
            <article className="rounded border p-4" style={{ borderColor: "var(--ld-border)" }}><strong className="text-2xl">{series.total_lichen_area_cm2?.toFixed(1) ?? "—"}</strong><p className="text-sm">Área de líquenes cm²</p></article>
            <article className="rounded border p-4" style={{ borderColor: "var(--ld-border)" }}><strong className="text-2xl">{series.provisional_morphotype_richness ?? 0}</strong><p className="text-sm">Morfotipos provisionales, sin identificación de especie</p></article>
          </section>

          <details className="rounded-lg border p-5" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
            <summary className="cursor-pointer font-semibold">Detalles por vista y datos técnicos</summary>
            <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {views.map((view) => (
                <article key={view.id} className="rounded border p-4" style={{ borderColor: "var(--ld-border)" }}>
                  <h3 className="font-semibold">{DIRECTION_LABELS[view.direction]}</h3>
                  <p className="mt-2 text-2xl font-bold">{view.lichen_coverage_percent?.toFixed(1) ?? "—"}%</p>
                  <p className="text-sm">{view.lichen_union_area_cm2?.toFixed(1) ?? "—"} cm² de líquenes / {view.valid_area_cm2?.toFixed(0) ?? "—"} cm²</p>
                  <p className="mt-2 text-xs">Regiones: {view.component_count ?? 0} · Morfotipos: {view.provisional_morphotype_richness ?? 0}</p>
                  <p className="text-xs">Área excluida: {view.excluded_area_cm2?.toFixed(2) ?? "0"} cm²</p>
                  <p className="mt-2 text-xs">Método: mask_union_intersection · {view.algorithm_version}</p>
                  {view.quality_flags.length ? <p className="mt-1 text-xs">Flags: {view.quality_flags.join(", ")}</p> : null}
                </article>
              ))}
            </section>
            <section className="mt-4 rounded border p-4 text-sm" style={{ borderColor: "var(--ld-border)" }}>
              <h3 className="font-semibold">Tamaño del tronco</h3>
              {series.field_circumference_cm ? (
                <p>Medición con cinta a 1.3 m: {series.field_circumference_cm.toFixed(1)} cm de circunferencia · DBH/DAP {series.field_diameter_cm?.toFixed(1)} cm · field_tape.</p>
              ) : (
                <p>Estimación a la altura de muestreo: {series.trunk_estimated_circumference_cm?.toFixed(1) ?? "—"} cm · rango {series.trunk_estimate_min_cm?.toFixed(1) ?? "—"}–{series.trunk_estimate_max_cm?.toFixed(1) ?? "—"} cm · confianza {series.trunk_confidence ?? "—"} · frame_assisted_ai_estimate.</p>
              )}
            </section>
          </details>
        </>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Siguiente paso</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href={`/annotations?captureSeriesId=${encodeURIComponent(seriesId)}&view=0&tool=ai`}
            className="rounded border px-4 py-3 text-center font-semibold"
            style={{ borderColor: "var(--ld-border)", background: "#fff" }}
          >
            {ready ? "Revisar o corregir las máscaras" : "Completar las anotaciones pendientes"}
          </Link>
          <button
            type="button"
            disabled={!ready || saving || series.status === "completed"}
            onClick={() => void complete()}
            className="rounded bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            {series.status === "completed" ? "Evaluación guardada" : saving ? "Guardando…" : "Guardar evaluación de este árbol"}
          </button>
          {context ? (
            <Link
              href={jornadaTreesDestination(context.eventId)}
              className="rounded border px-5 py-3 text-center font-semibold"
              style={{ borderColor: "var(--ld-border)", background: "var(--ld-sand)" }}
            >
              Siguiente árbol de esta jornada
            </Link>
          ) : null}
        </div>
        {!ready ? (
          <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
            Guardar la evaluación se habilita cuando las cuatro anotaciones estén completas. La revisión de máscaras
            sigue disponible: una salida automática sin revisar no es una validación científica.
          </p>
        ) : null}
      </section>
    </div>
  );
}

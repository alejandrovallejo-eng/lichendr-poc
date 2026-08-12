"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  confirmSeries,
  loadTreeResults,
  type CaptureSeriesRow,
  type CaptureViewRow,
} from "@/modules/four-view/client";
import { DIRECTION_LABELS } from "@/modules/four-view/types";
import { nextTreeDestination } from "@/modules/four-view/navigation";

export default function FourViewTreeResults({ seriesId }: { seriesId: string }) {
  const [series, setSeries] = useState<CaptureSeriesRow | null>(null);
  const [views, setViews] = useState<CaptureViewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadTreeResults(seriesId)
      .then((result) => {
        setSeries(result.series);
        setViews(result.views);
      })
      .catch(() => setError("No se pudieron calcular los resultados del árbol."));
  }, [seriesId]);

  const complete = async () => {
    setSaving(true);
    setError(null);
    try {
      await confirmSeries(seriesId);
      const result = await loadTreeResults(seriesId);
      setSeries(result.series);
      setViews(result.views);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la evaluación.");
    } finally {
      setSaving(false);
    }
  };

  if (!series) return <div className="rounded border p-4 text-sm">{error ?? "Calculando unión de máscaras y resultados…"}</div>;
  const ready = series.status === "analysis_ready" || series.status === "completed";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Resultados automáticos del árbol"
        subtitle="Cobertura calculada con la unión de máscaras de líquen, sin doble conteo, sobre las cuatro áreas calibradas."
      />
      {error ? <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
      {!ready ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          Completa las cuatro anotaciones para habilitar los resultados. Estado: {series.status}.
        </div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <article className="rounded border p-4"><strong className="text-2xl">{series.tree_lichen_coverage_percent?.toFixed(1) ?? "—"}%</strong><p className="text-sm">Cobertura del árbol</p></article>
            <article className="rounded border p-4"><strong className="text-2xl">{series.total_valid_area_cm2?.toFixed(0) ?? "—"}</strong><p className="text-sm">Área total evaluada cm²</p></article>
            <article className="rounded border p-4"><strong className="text-2xl">{series.total_lichen_area_cm2?.toFixed(1) ?? "—"}</strong><p className="text-sm">Área de líquenes cm²</p></article>
            <article className="rounded border p-4"><strong className="text-2xl">{series.provisional_morphotype_richness ?? 0}</strong><p className="text-sm">Riqueza de morfotipos provisionales</p></article>
          </section>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {views.map((view) => (
              <article key={view.id} className="rounded border p-4">
                <h2 className="font-semibold">{DIRECTION_LABELS[view.direction]}</h2>
                <p className="mt-2 text-2xl font-bold">{view.lichen_coverage_percent?.toFixed(1) ?? "—"}%</p>
                <p className="text-sm">{view.lichen_union_area_cm2?.toFixed(1) ?? "—"} cm² de líquenes / {view.valid_area_cm2?.toFixed(0) ?? "—"} cm²</p>
                <p className="mt-2 text-xs">Regiones: {view.component_count ?? 0} · Morfotipos: {view.provisional_morphotype_richness ?? 0}</p>
                <p className="text-xs">Área excluida: {view.excluded_area_cm2?.toFixed(2) ?? "0"} cm²</p>
                <p className="mt-2 text-xs">Método: mask_union_intersection · {view.algorithm_version}</p>
                {view.quality_flags.length ? <p className="mt-1 text-xs">Flags: {view.quality_flags.join(", ")}</p> : null}
              </article>
            ))}
          </section>
          <section className="rounded border p-4 text-sm">
            <h2 className="font-semibold">Tamaño del tronco</h2>
            {series.field_circumference_cm ? (
              <p>Medición con cinta a 1.3 m: {series.field_circumference_cm.toFixed(1)} cm de circunferencia · DBH/DAP {series.field_diameter_cm?.toFixed(1)} cm · field_tape.</p>
            ) : (
              <p>Estimación a la altura de muestreo: {series.trunk_estimated_circumference_cm?.toFixed(1) ?? "—"} cm · rango {series.trunk_estimate_min_cm?.toFixed(1) ?? "—"}–{series.trunk_estimate_max_cm?.toFixed(1) ?? "—"} cm · confianza {series.trunk_confidence ?? "—"} · frame_assisted_ai_estimate.</p>
            )}
          </section>
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <Link href={`/annotations?captureSeriesId=${encodeURIComponent(seriesId)}&view=3&tool=layers`} className="rounded border px-4 py-2">Volver a anotaciones</Link>
        <button type="button" disabled={!ready || saving || series.status === "completed"} onClick={() => void complete()} className="rounded bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-50">
          {series.status === "completed" ? "Evaluación guardada" : saving ? "Guardando…" : "Guardar evaluación y trabajar con otro árbol"}
        </button>
        {series.status === "completed" ? <Link href={nextTreeDestination()} className="rounded border px-5 py-3 font-semibold">Trabajar con otro árbol</Link> : null}
      </div>
    </div>
  );
}

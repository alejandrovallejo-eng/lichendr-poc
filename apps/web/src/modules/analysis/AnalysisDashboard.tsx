"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  evaluationQualityFlags,
  listAnalysisEvaluations,
  recalculateEvaluationMetrics,
  type AnalysisEvaluation,
} from "@/modules/analysis/client";
import type { AnnotationQualityFlag } from "@/modules/annotations/studio-mask-utils";

const SCIENTIFIC_NOTICE = "Los resultados son descriptivos y provisionales. No constituyen por sí solos una clasificación de calidad ambiental.";

const QUALITY_LABELS: Record<AnnotationQualityFlag, string> = {
  missing_trunk: "Tronco ausente",
  zero_trunk_area: "Área de tronco cero",
  mask_dimension_mismatch: "Máscaras con dimensiones incompatibles",
  lichen_outside_trunk: "Regiones de liquen fuera del tronco",
  high_lichen_overlap: "Solapamiento elevado entre regiones",
  no_lichen_regions: "Evaluación sin regiones de liquen",
  summary_pending: "Resumen pendiente de cálculo",
  signed_mask_unavailable: "Signed mask no disponible",
};

function formatPercent(value: number | null): string {
  return value == null ? "Datos insuficientes" : `${value.toFixed(1)}%`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function weightedCoverage(evaluations: AnalysisEvaluation[]): number | null {
  let trunkPixels = 0;
  let lichenPixels = 0;
  for (const evaluation of evaluations) {
    const metrics = evaluation.metrics;
    if (
      metrics?.trunk_area_pixels == null
      || metrics.trunk_area_pixels <= 0
      || metrics.lichen_union_area_pixels == null
    ) continue;
    trunkPixels += metrics.trunk_area_pixels;
    lichenPixels += metrics.lichen_union_area_pixels;
  }
  return trunkPixels > 0 ? lichenPixels / trunkPixels * 100 : null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border p-4 shadow-sm" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-1 text-sm" style={{ color: "var(--ld-text-secondary)" }}>{label}</p>
    </article>
  );
}

interface CoverageGroup {
  key: string;
  title: string;
  subtitle: string;
  evaluations: AnalysisEvaluation[];
}

function CoverageBar({ value, label }: { value: number | null; label: string }) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="min-w-40" role="img" aria-label={`${label}: ${formatPercent(value)}`}>
      <div className="h-3 overflow-hidden rounded bg-slate-200">
        <div className="h-full rounded bg-emerald-700" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function AnalysisDashboard() {
  const searchParams = useSearchParams();
  const requestIdRef = useRef(0);
  const recalculateAbortRef = useRef<AbortController | null>(null);
  const [evaluations, setEvaluations] = useState<AnalysisEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recalculatingId, setRecalculatingId] = useState<string | null>(null);
  const [recalculationErrors, setRecalculationErrors] = useState<Record<string, string>>({});
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
  const [siteId, setSiteId] = useState(searchParams.get("siteId") ?? "");
  const [samplingEventId, setSamplingEventId] = useState(searchParams.get("samplingEventId") ?? "");
  const [treeSampleId, setTreeSampleId] = useState(searchParams.get("treeSampleId") ?? "");
  const [startDate, setStartDate] = useState(searchParams.get("startDate") ?? "");
  const [endDate, setEndDate] = useState(searchParams.get("endDate") ?? "");

  useEffect(() => {
    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    void listAnalysisEvaluations(controller.signal)
      .then((result) => {
        if (requestId === requestIdRef.current) setEvaluations(result);
      })
      .catch((reason) => {
        if ((reason as { name?: string }).name !== "AbortError" && requestId === requestIdRef.current) {
          setError("No se pudieron cargar las evaluaciones completadas.");
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
    return () => {
      controller.abort();
      recalculateAbortRef.current?.abort();
      requestIdRef.current += 1;
    };
  }, []);

  const projects = useMemo(() => (
    [...new Map(evaluations.map((item) => [item.projectId, item.projectName])).entries()]
      .sort((left, right) => left[1].localeCompare(right[1]))
  ), [evaluations]);
  const sites = useMemo(() => (
    [...new Map(evaluations
      .filter((item) => !projectId || item.projectId === projectId)
      .map((item) => [item.siteId, item.siteName])).entries()]
      .sort((left, right) => left[1].localeCompare(right[1]))
  ), [evaluations, projectId]);
  const events = useMemo(() => (
    [...new Map(evaluations
      .filter((item) => (!projectId || item.projectId === projectId) && (!siteId || item.siteId === siteId))
      .map((item) => [item.samplingEventId, item.samplingEventName])).entries()]
      .sort((left, right) => left[1].localeCompare(right[1]))
  ), [evaluations, projectId, siteId]);
  const treeSamples = useMemo(() => (
    [...new Map(evaluations
      .filter((item) => (
        (!projectId || item.projectId === projectId)
        && (!siteId || item.siteId === siteId)
        && (!samplingEventId || item.samplingEventId === samplingEventId)
      ))
      .map((item) => [item.treeSampleId, item.treeCode])).entries()]
      .sort((left, right) => left[1].localeCompare(right[1]))
  ), [evaluations, projectId, siteId, samplingEventId]);

  const filtered = useMemo(() => evaluations.filter((evaluation) => {
    if (projectId && evaluation.projectId !== projectId) return false;
    if (siteId && evaluation.siteId !== siteId) return false;
    if (samplingEventId && evaluation.samplingEventId !== samplingEventId) return false;
    if (treeSampleId && evaluation.treeSampleId !== treeSampleId) return false;
    const completedDate = evaluation.completedAt.slice(0, 10);
    if (startDate && completedDate < startDate) return false;
    if (endDate && completedDate > endDate) return false;
    return true;
  }), [evaluations, projectId, siteId, samplingEventId, treeSampleId, startDate, endDate]);

  const coverageValues = filtered.flatMap((item) => (
    item.metrics?.coverage_percent == null ? [] : [item.metrics.coverage_percent]
  ));
  const uniqueTrees = new Set(filtered.map((item) => item.treeId));
  const weighted = weightedCoverage(filtered);
  const coverageMedian = median(coverageValues);
  const morphotypeNames = new Set(filtered.flatMap((item) => item.morphotypes.map((morphotype) => morphotype.label.toLocaleLowerCase())));
  const flagsFor = (evaluation: AnalysisEvaluation): AnnotationQualityFlag[] => {
    const flags = evaluationQualityFlags(evaluation);
    return recalculationErrors[evaluation.annotationSetId]
      ? [...new Set([...flags, "signed_mask_unavailable" as const])]
      : flags;
  };
  const alertCount = filtered.filter((item) => flagsFor(item).length > 0).length;

  const treeGroups = useMemo(() => {
    const grouped = new Map<string, CoverageGroup>();
    for (const evaluation of filtered) {
      const existing = grouped.get(evaluation.treeSampleId);
      if (existing) existing.evaluations.push(evaluation);
      else grouped.set(evaluation.treeSampleId, {
        key: evaluation.treeSampleId,
        title: evaluation.treeCode,
        subtitle: `${evaluation.siteName} · ${evaluation.samplingEventName}`,
        evaluations: [evaluation],
      });
    }
    return [...grouped.values()];
  }, [filtered]);

  const siteGroups = useMemo(() => {
    const grouped = new Map<string, CoverageGroup>();
    for (const evaluation of filtered) {
      const existing = grouped.get(evaluation.siteId);
      if (existing) existing.evaluations.push(evaluation);
      else grouped.set(evaluation.siteId, {
        key: evaluation.siteId,
        title: evaluation.siteName,
        subtitle: evaluation.projectName,
        evaluations: [evaluation],
      });
    }
    return [...grouped.values()];
  }, [filtered]);

  const morphotypeGroups = useMemo(() => {
    const grouped = new Map<string, {
      label: string;
      growthForm: string;
      colorHex: string | null;
      regionCount: number;
      imageIds: Set<string>;
    }>();
    for (const evaluation of filtered) {
      for (const morphotype of evaluation.morphotypes) {
        const key = `${morphotype.label.toLocaleLowerCase()}|${morphotype.growthForm}|${morphotype.colorHex ?? ""}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.regionCount += morphotype.regionCount;
          existing.imageIds.add(evaluation.imageId);
        } else {
          grouped.set(key, {
            label: morphotype.label,
            growthForm: morphotype.growthForm,
            colorHex: morphotype.colorHex,
            regionCount: morphotype.regionCount,
            imageIds: new Set([evaluation.imageId]),
          });
        }
      }
    }
    return [...grouped.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [filtered]);

  const recalculate = async (evaluation: AnalysisEvaluation) => {
    if (recalculatingId) return;
    recalculateAbortRef.current?.abort();
    const controller = new AbortController();
    recalculateAbortRef.current = controller;
    setRecalculatingId(evaluation.annotationSetId);
    setRecalculationErrors((current) => {
      const next = { ...current };
      delete next[evaluation.annotationSetId];
      return next;
    });
    try {
      const metrics = await recalculateEvaluationMetrics(evaluation.annotationSetId, controller.signal);
      setEvaluations((current) => current.map((item) => (
        item.annotationSetId === evaluation.annotationSetId ? { ...item, metrics } : item
      )));
    } catch (reason) {
      if ((reason as { name?: string }).name !== "AbortError") {
        setRecalculationErrors((current) => ({
          ...current,
          [evaluation.annotationSetId]: reason instanceof Error ? reason.message : "No se pudo calcular el resumen.",
        }));
      }
    } finally {
      if (!controller.signal.aborted) setRecalculatingId(null);
    }
  };

  if (loading) {
    return <div className="rounded border p-4 text-sm" style={{ borderColor: "var(--ld-border)" }}>Cargando resultados descriptivos…</div>;
  }
  if (error) {
    return <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <main className="space-y-6" style={{ color: "var(--ld-text)" }}>
      <header>
        <h1 className="text-2xl font-semibold">Análisis</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ld-text-secondary)" }}>Cobertura observada de líquenes · Resultado descriptivo · Estimación provisional</p>
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">{SCIENTIFIC_NOTICE}</p>
      </header>

      <section className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <h2 className="font-semibold">Filtros</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm">Proyecto
            <select value={projectId} onChange={(event) => {
              setProjectId(event.target.value);
              setSiteId("");
              setSamplingEventId("");
              setTreeSampleId("");
            }} className="mt-1 w-full rounded border px-2 py-2" style={{ borderColor: "var(--ld-border)" }}>
              <option value="">Todos</option>
              {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="text-sm">Sitio
            <select value={siteId} onChange={(event) => {
              setSiteId(event.target.value);
              setSamplingEventId("");
              setTreeSampleId("");
            }} className="mt-1 w-full rounded border px-2 py-2" style={{ borderColor: "var(--ld-border)" }}>
              <option value="">Todos</option>
              {sites.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="text-sm">Jornada de muestreo
            <select value={samplingEventId} onChange={(event) => {
              setSamplingEventId(event.target.value);
              setTreeSampleId("");
            }} className="mt-1 w-full rounded border px-2 py-2" style={{ borderColor: "var(--ld-border)" }}>
              <option value="">Todas</option>
              {events.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="text-sm">Árbol o muestra
            <select value={treeSampleId} onChange={(event) => setTreeSampleId(event.target.value)} className="mt-1 w-full rounded border px-2 py-2" style={{ borderColor: "var(--ld-border)" }}>
              <option value="">Todos</option>
              {treeSamples.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">Desde
              <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} className="mt-1 w-full rounded border px-2 py-2" style={{ borderColor: "var(--ld-border)" }} />
            </label>
            <label className="text-sm">Hasta
              <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} className="mt-1 w-full rounded border px-2 py-2" style={{ borderColor: "var(--ld-border)" }} />
            </label>
          </div>
        </div>
      </section>

      {filtered.length === 0 ? (
        <section className="rounded-lg border p-6 text-center" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h2 className="font-semibold">Datos insuficientes</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ld-text-secondary)" }}>No hay evaluaciones completadas para los filtros seleccionados.</p>
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Metric label="Imágenes evaluadas" value={String(filtered.length)} />
            <Metric label="Árboles evaluados" value={String(uniqueTrees.size)} />
            <Metric label="Cobertura ponderada" value={formatPercent(weighted)} />
            <Metric label="Mediana de cobertura por imagen" value={formatPercent(coverageMedian)} />
            <Metric label="Morfotipos observados" value={String(morphotypeNames.size)} />
            <Metric label="Evaluaciones con alertas de calidad" value={String(alertCount)} />
          </section>

          <section className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
            <h2 className="text-lg font-semibold">Resumen cuantitativo</h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div><dt className="text-sm text-slate-500">Mediana</dt><dd className="font-semibold">{formatPercent(coverageMedian)}</dd></div>
              <div><dt className="text-sm text-slate-500">Mínimo</dt><dd className="font-semibold">{formatPercent(coverageValues.length ? Math.min(...coverageValues) : null)}</dd></div>
              <div><dt className="text-sm text-slate-500">Máximo</dt><dd className="font-semibold">{formatPercent(coverageValues.length ? Math.max(...coverageValues) : null)}</dd></div>
              <div><dt className="text-sm text-slate-500">Imágenes</dt><dd className="font-semibold">{filtered.length}</dd></div>
              <div><dt className="text-sm text-slate-500">Árboles</dt><dd className="font-semibold">{uniqueTrees.size}</dd></div>
            </dl>
          </section>

          <section className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
            <h2 className="text-lg font-semibold">Cobertura por imagen</h2>
            <div className="mt-4 space-y-4">
              {filtered.map((evaluation) => (
                <article key={evaluation.annotationSetId} className="grid items-center gap-2 border-b pb-4 md:grid-cols-[minmax(12rem,1fr)_minmax(10rem,1fr)_6rem_8rem]" style={{ borderColor: "var(--ld-border)" }}>
                  <div><p className="font-semibold">{evaluation.imageName}</p><p className="text-xs text-slate-500">{evaluation.treeCode}</p></div>
                  <CoverageBar value={evaluation.metrics?.coverage_percent ?? null} label={evaluation.imageName} />
                  <p className="font-semibold">{evaluation.metrics ? formatPercent(evaluation.metrics.coverage_percent) : "Resumen pendiente de cálculo"}</p>
                  <Link href={`/annotations?imageId=${encodeURIComponent(evaluation.imageId)}&tool=layers&from=analysis`} className="font-semibold text-emerald-800 underline">Ver evaluación</Link>
                  {!evaluation.metrics ? (
                    <button type="button" disabled={Boolean(recalculatingId)} onClick={() => void recalculate(evaluation)} className="rounded border px-3 py-2 text-sm font-semibold disabled:opacity-50 md:col-start-4" style={{ borderColor: "var(--ld-border)" }}>
                      {recalculatingId === evaluation.annotationSetId ? "Calculando…" : "Calcular resumen"}
                    </button>
                  ) : null}
                  {recalculationErrors[evaluation.annotationSetId] ? <p className="text-sm text-red-700 md:col-span-4">{recalculationErrors[evaluation.annotationSetId]}</p> : null}
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
              <h2 className="text-lg font-semibold">Cobertura por árbol</h2>
              <div className="mt-4 space-y-4">
                {treeGroups.map((group) => {
                  const value = weightedCoverage(group.evaluations);
                  return <article key={group.key}><div className="flex justify-between gap-3"><div><p className="font-semibold">{group.title}</p><p className="text-xs text-slate-500">{group.subtitle} · {group.evaluations.length} imágenes</p></div><p>{formatPercent(value)}</p></div><CoverageBar value={value} label={group.title} /></article>;
                })}
              </div>
            </div>
            <div className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
              <h2 className="text-lg font-semibold">Comparación por sitio</h2>
              <div className="mt-4 space-y-4">
                {siteGroups.map((group) => {
                  const value = weightedCoverage(group.evaluations);
                  const siteValues = group.evaluations.flatMap((item) => item.metrics?.coverage_percent == null ? [] : [item.metrics.coverage_percent]);
                  return <article key={group.key}><div className="flex justify-between gap-3"><div><p className="font-semibold">{group.title}</p><p className="text-xs text-slate-500">{group.subtitle} · {new Set(group.evaluations.map((item) => item.treeId)).size} árboles · {group.evaluations.length} imágenes · mediana {formatPercent(median(siteValues))}</p></div><p>{formatPercent(value)}</p></div><CoverageBar value={value} label={group.title} /></article>;
                })}
              </div>
            </div>
          </section>

          <section className="overflow-x-auto rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
            <h2 className="text-lg font-semibold">Morfotipos observados</h2>
            {morphotypeGroups.length === 0 ? <p className="mt-3 text-sm">Datos insuficientes</p> : (
              <table className="mt-3 w-full min-w-[36rem] text-left text-sm">
                <thead><tr className="border-b" style={{ borderColor: "var(--ld-border)" }}><th className="py-2">Nombre</th><th>Color</th><th>Forma de crecimiento</th><th>Regiones</th><th>Imágenes</th></tr></thead>
                <tbody>{morphotypeGroups.map((item) => <tr key={`${item.label}-${item.growthForm}-${item.colorHex}`} className="border-b" style={{ borderColor: "var(--ld-border)" }}><td className="py-2 font-semibold">{item.label}</td><td>{item.colorHex ? <span className="inline-flex items-center gap-2"><span className="h-4 w-4 rounded border" style={{ background: item.colorHex, borderColor: "var(--ld-border)" }} />{item.colorHex}</span> : "No registrado"}</td><td>{item.growthForm}</td><td>{item.regionCount}</td><td>{item.imageIds.size}</td></tr>)}</tbody>
              </table>
            )}
            <p className="mt-3 text-xs text-slate-500">El número de regiones no representa una composición exclusiva de área cuando existen solapamientos.</p>
          </section>

          <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <h2 className="text-lg font-semibold text-amber-950">Calidad de los datos</h2>
            {alertCount === 0 ? <p className="mt-2 text-sm text-amber-950">No se detectaron alertas con los criterios actuales.</p> : (
              <div className="mt-3 space-y-3">
                {filtered.filter((item) => flagsFor(item).length > 0).map((evaluation) => (
                  <article key={evaluation.annotationSetId} className="rounded border border-amber-300 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><p className="font-semibold">{evaluation.imageName}</p><p className="text-xs text-slate-500">{evaluation.siteName} · {evaluation.treeCode}</p></div>
                      <Link href={`/annotations?imageId=${encodeURIComponent(evaluation.imageId)}&tool=layers&from=analysis`} className="text-sm font-semibold text-emerald-800 underline">Ver evaluación</Link>
                    </div>
                    <ul className="mt-2 list-disc pl-5 text-sm">{flagsFor(evaluation).map((flag) => <li key={flag}>{QUALITY_LABELS[flag]}</li>)}</ul>
                    {!evaluation.metrics ? <button type="button" disabled={Boolean(recalculatingId)} onClick={() => void recalculate(evaluation)} className="mt-3 rounded border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--ld-border)" }}>Calcular resumen</button> : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

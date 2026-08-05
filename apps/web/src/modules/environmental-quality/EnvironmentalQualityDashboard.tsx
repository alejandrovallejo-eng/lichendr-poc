"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  createPollutantMeasurement,
  loadEnvironmentalDataset,
  saveSamplingContext,
  saveSiteContext,
  type EnvironmentalDataset,
  type PollutantCode,
  type QaQcStatus,
  type SampleContextRow,
  type SiteContextRow,
  type TreeSampleRow,
} from "./client";
import {
  aggregateCompatiblePollutants,
  buildDescriptiveProfile,
  buildReadinessChecklist,
  selectCompletedEvaluations,
  type ReadinessStatus,
} from "./science";

const SCIENTIFIC_NOTICE = "Los resultados actuales son descriptivos y todavía no constituyen una clasificación validada de calidad ambiental.";
const EMPTY_DATASET: EnvironmentalDataset = {
  projects: [],
  sites: [],
  samplingEvents: [],
  trees: [],
  treeSamples: [],
  siteContexts: [],
  sampleContexts: [],
  pollutants: [],
  evaluations: [],
};
const QUALITY_LABELS: Record<string, string> = {
  missing_trunk: "Tronco ausente",
  zero_trunk_area: "Área de tronco cero",
  mask_dimension_mismatch: "Máscaras con dimensiones incompatibles",
  lichen_outside_trunk: "Liquen fuera del tronco",
  high_lichen_overlap: "Solapamiento elevado entre regiones",
  no_lichen_regions: "Sin regiones de liquen",
  summary_pending: "Resumen pendiente",
  signed_mask_unavailable: "Máscara no disponible",
};
const ORIENTATIONS = ["unknown", "N", "NE", "E", "SE", "S", "SW", "W", "NW", "multiple"];
const POLLUTANTS: PollutantCode[] = ["PM2.5", "PM10", "NO2", "SO2", "NH3", "O3", "CO"];
const REFERENCES = [
  ["EN 16413:2014 — Ambient air: biomonitoring with lichens", "https://www.dinmedia.de/en/standard/din-en-16413/191132720"],
  ["Counoy et al. (2025) — New interpretative framework", "https://doi.org/10.1111/gcb.70632"],
  ["Díaz et al. (2021) — Epiphytic lichens in a tropical Andean city", "https://doi.org/10.3390/su132011218"],
  ["Sebald et al. (2022) — NO₂ and tree characteristics", "https://doi.org/10.1016/j.envpol.2022.119678"],
  ["Rautiainen et al. (2024) — Remote sensing and spectroscopy review", "https://doi.org/10.1002/ece3.11110"],
  ["Cuenca tropical-city study (2026)", "https://doi.org/10.1016/j.apr.2026.103030"],
] as const;

interface SamplingDraft {
  samplingHeightCm: string;
  orientation: string;
  sampledWidthCm: string;
  sampledHeightCm: string;
  dbhCm: string;
  barkPh: string;
  barkTexture: string;
  canopyCoverPercent: string;
  airTemperatureC: string;
  relativeHumidityPercent: string;
  landUseClassification: string;
  referenceCandidate: "" | "yes" | "no";
  measuredAt: string;
  provenance: string;
  notes: string;
}

interface PollutantDraft {
  siteId: string;
  samplingEventId: string;
  measuredAt: string;
  pollutantCode: PollutantCode;
  value: string;
  unit: string;
  averagingPeriod: string;
  instrumentMethod: string;
  dataSource: string;
  qaQcStatus: QaQcStatus;
  notes: string;
}

const EMPTY_SAMPLING_DRAFT: SamplingDraft = {
  samplingHeightCm: "",
  orientation: "unknown",
  sampledWidthCm: "",
  sampledHeightCm: "",
  dbhCm: "",
  barkPh: "",
  barkTexture: "",
  canopyCoverPercent: "",
  airTemperatureC: "",
  relativeHumidityPercent: "",
  landUseClassification: "",
  referenceCandidate: "",
  measuredAt: "",
  provenance: "",
  notes: "",
};
const EMPTY_POLLUTANT_DRAFT: PollutantDraft = {
  siteId: "",
  samplingEventId: "",
  measuredAt: "",
  pollutantCode: "PM2.5",
  value: "",
  unit: "µg/m³",
  averagingPeriod: "",
  instrumentMethod: "",
  dataSource: "",
  qaQcStatus: "not_assessed",
  notes: "",
};

function readDraft<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function nullableNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

function formatPercent(value: number | null): string {
  return value == null ? "Datos insuficientes" : `${value.toFixed(1)}%`;
}

function statusClass(status: ReadinessStatus): string {
  if (status === "Completo") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (status === "Parcial") return "border-amber-300 bg-amber-50 text-amber-950";
  if (status === "Faltante") return "border-red-200 bg-red-50 text-red-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-1 text-sm" style={{ color: "var(--ld-text-secondary)" }}>{label}</p>
    </article>
  );
}

function existingDraft(
  sample: TreeSampleRow,
  sampleContext: SampleContextRow | undefined,
  siteContext: SiteContextRow | undefined,
): SamplingDraft {
  return {
    samplingHeightCm: sample.sampling_height_m == null ? "" : String(sample.sampling_height_m * 100),
    orientation: sample.trunk_orientation,
    sampledWidthCm: sampleContext?.sampled_width_cm == null ? "" : String(sampleContext.sampled_width_cm),
    sampledHeightCm: sampleContext?.sampled_height_cm == null ? "" : String(sampleContext.sampled_height_cm),
    dbhCm: sampleContext?.dbh_cm == null ? "" : String(sampleContext.dbh_cm),
    barkPh: sampleContext?.bark_ph == null ? "" : String(sampleContext.bark_ph),
    barkTexture: sampleContext?.bark_texture ?? "",
    canopyCoverPercent: sampleContext?.canopy_cover_percent == null ? "" : String(sampleContext.canopy_cover_percent),
    airTemperatureC: sampleContext?.air_temperature_c == null ? "" : String(sampleContext.air_temperature_c),
    relativeHumidityPercent: sampleContext?.relative_humidity_percent == null ? "" : String(sampleContext.relative_humidity_percent),
    landUseClassification: siteContext?.land_use_classification ?? "",
    referenceCandidate: siteContext?.is_reference_candidate == null ? "" : siteContext.is_reference_candidate ? "yes" : "no",
    measuredAt: localDateTime(sampleContext?.measured_at ?? siteContext?.measured_at ?? null),
    provenance: sampleContext?.provenance ?? siteContext?.provenance ?? "",
    notes: sample.notes ?? "",
  };
}

export default function EnvironmentalQualityDashboard() {
  const searchParams = useSearchParams();
  const requestRef = useRef(0);
  const [dataset, setDataset] = useState(EMPTY_DATASET);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
  const [siteId, setSiteId] = useState(searchParams.get("siteId") ?? "");
  const [selectedSampleId, setSelectedSampleId] = useState("");
  const [samplingDrafts, setSamplingDrafts] = useState<Record<string, SamplingDraft>>(
    () => readDraft("lichendr.environmental.sampling-drafts", {}),
  );
  const [pollutantDraft, setPollutantDraft] = useState<PollutantDraft>(
    () => readDraft("lichendr.environmental.pollutant-draft", EMPTY_POLLUTANT_DRAFT),
  );
  const [samplingSaveState, setSamplingSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pollutantSaveState, setPollutantSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = async (signal?: AbortSignal) => {
    const requestId = ++requestRef.current;
    try {
      const result = await loadEnvironmentalDataset(signal);
      if (requestId !== requestRef.current) return;
      setDataset(result);
      setError(null);
      setProjectId((current) => current || result.projects[0]?.id || "");
    } catch (reason) {
      if ((reason as { name?: string }).name !== "AbortError" && requestId === requestRef.current) {
        setError("No se pudieron cargar los datos de preparación científica.");
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestRef.current;
    void loadEnvironmentalDataset(controller.signal)
      .then((result) => {
        if (requestId !== requestRef.current) return;
        setDataset(result);
        setError(null);
        setProjectId((current) => current || result.projects[0]?.id || "");
      })
      .catch((reason) => {
        if ((reason as { name?: string }).name !== "AbortError" && requestId === requestRef.current) {
          setError("No se pudieron cargar los datos de preparación científica.");
        }
      })
      .finally(() => {
        if (requestId === requestRef.current) setLoading(false);
      });
    return () => {
      controller.abort();
      requestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("lichendr.environmental.sampling-drafts", JSON.stringify(samplingDrafts));
  }, [samplingDrafts]);
  useEffect(() => {
    window.localStorage.setItem("lichendr.environmental.pollutant-draft", JSON.stringify(pollutantDraft));
  }, [pollutantDraft]);

  const sites = useMemo(() => dataset.sites.filter((site) => !projectId || site.project_id === projectId), [dataset.sites, projectId]);
  const selectedSiteIds = useMemo(() => new Set(siteId ? [siteId] : sites.map((site) => site.id)), [siteId, sites]);
  const samples = useMemo(() => dataset.treeSamples.filter((sample) => selectedSiteIds.has(sample.site_id)), [dataset.treeSamples, selectedSiteIds]);
  const evaluations = useMemo(() => dataset.evaluations.filter((item) => selectedSiteIds.has(item.siteId)), [dataset.evaluations, selectedSiteIds]);
  const pollutants = useMemo(() => dataset.pollutants.filter((item) => selectedSiteIds.has(item.site_id)), [dataset.pollutants, selectedSiteIds]);
  const completed = useMemo(() => selectCompletedEvaluations(evaluations), [evaluations]);
  const profile = useMemo(() => buildDescriptiveProfile(evaluations), [evaluations]);

  const sampleContextById = useMemo(() => new Map(dataset.sampleContexts.map((item) => [item.tree_sample_id, item])), [dataset.sampleContexts]);
  const siteContextById = useMemo(() => new Map(dataset.siteContexts.map((item) => [item.site_id, item])), [dataset.siteContexts]);
  const treeById = useMemo(() => new Map(dataset.trees.map((item) => [item.id, item])), [dataset.trees]);
  const eventById = useMemo(() => new Map(dataset.samplingEvents.map((item) => [item.id, item])), [dataset.samplingEvents]);
  const siteById = useMemo(() => new Map(dataset.sites.map((item) => [item.id, item])), [dataset.sites]);

  const readiness = useMemo(() => buildReadinessChecklist({
    completedAnnotations: completed.length,
    metricsAvailable: completed.filter((item) => item.metrics != null).length,
    confirmedTrunks: completed.filter((item) => (item.metrics?.trunk_area_pixels ?? 0) > 0).length,
    sampleCount: samples.length,
    samplingHeightRecorded: samples.filter((sample) => (sample.sampling_height_m ?? 0) > 0).length,
    orientationRecorded: samples.filter((sample) => sample.trunk_orientation !== "unknown").length,
    sampledAreaRecorded: samples.filter((sample) => {
      const context = sampleContextById.get(sample.id);
      return (context?.sampled_width_cm ?? 0) > 0 && (context?.sampled_height_cm ?? 0) > 0;
    }).length,
    hostMetadataAvailable: samples.filter((sample) => {
      const tree = treeById.get(sample.tree_id);
      const context = sampleContextById.get(sample.id);
      return Boolean(tree?.species_name && (context?.dbh_cm ?? 0) > 0);
    }).length,
    barkCharacteristicsAvailable: samples.filter((sample) => {
      const context = sampleContextById.get(sample.id);
      return context?.bark_ph != null && Boolean(context.bark_texture);
    }).length,
    microclimateAvailable: samples.filter((sample) => {
      const context = sampleContextById.get(sample.id);
      return context?.air_temperature_c != null && context.relative_humidity_percent != null;
    }).length,
    representedSites: sites.length,
    candidateReferenceSites: sites.filter((site) => siteContextById.get(site.id)?.is_reference_candidate === true).length,
    pollutantMeasurements: pollutants.length,
    representedTrees: new Set(samples.map((sample) => sample.tree_id)).size,
  }), [completed, pollutants.length, sampleContextById, samples, siteContextById, sites, treeById]);

  const missingMetadata = readiness.filter((item) => item.status !== "Completo" && item.status !== "No aplica");
  const effectiveSampleId = samples.some((sample) => sample.id === selectedSampleId) ? selectedSampleId : samples[0]?.id ?? "";
  const selectedSample = dataset.treeSamples.find((item) => item.id === effectiveSampleId);
  const selectedDraft = samplingDrafts[effectiveSampleId] ?? (
    selectedSample
      ? existingDraft(selectedSample, sampleContextById.get(selectedSample.id), siteContextById.get(selectedSample.site_id))
      : EMPTY_SAMPLING_DRAFT
  );
  const pollutantSiteId = sites.some((site) => site.id === pollutantDraft.siteId) ? pollutantDraft.siteId : sites[0]?.id ?? "";
  const pollutantEvents = dataset.samplingEvents.filter((item) => item.site_id === pollutantSiteId);
  const compatiblePollutants = aggregateCompatiblePollutants(pollutants.map((item) => ({
    pollutantCode: item.pollutant_code,
    unit: item.unit,
    averagingPeriod: item.averaging_period,
    value: item.value,
  })));

  const updateSamplingDraft = (field: keyof SamplingDraft, value: string) => {
    if (!effectiveSampleId) return;
    setSamplingDrafts((current) => ({
      ...current,
      [effectiveSampleId]: { ...selectedDraft, [field]: value },
    }));
    setSamplingSaveState("idle");
  };

  const submitSampling = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSample) return;
    setSamplingSaveState("saving");
    setSaveError(null);
    try {
      const measuredAt = selectedDraft.measuredAt ? new Date(selectedDraft.measuredAt).toISOString() : null;
      await saveSamplingContext({
        treeSampleId: selectedSample.id,
        samplingHeightCm: nullableNumber(selectedDraft.samplingHeightCm),
        trunkOrientation: selectedDraft.orientation,
        notes: selectedDraft.notes.trim() || null,
        sampledWidthCm: nullableNumber(selectedDraft.sampledWidthCm),
        sampledHeightCm: nullableNumber(selectedDraft.sampledHeightCm),
        dbhCm: nullableNumber(selectedDraft.dbhCm),
        barkPh: nullableNumber(selectedDraft.barkPh),
        barkTexture: selectedDraft.barkTexture.trim() || null,
        canopyCoverPercent: nullableNumber(selectedDraft.canopyCoverPercent),
        airTemperatureC: nullableNumber(selectedDraft.airTemperatureC),
        relativeHumidityPercent: nullableNumber(selectedDraft.relativeHumidityPercent),
        measuredAt,
        provenance: selectedDraft.provenance.trim() || null,
      });
      await saveSiteContext({
        siteId: selectedSample.site_id,
        landUseClassification: selectedDraft.landUseClassification.trim() || null,
        isReferenceCandidate: selectedDraft.referenceCandidate === "" ? null : selectedDraft.referenceCandidate === "yes",
        measuredAt,
        provenance: selectedDraft.provenance.trim() || null,
      });
      setSamplingSaveState("saved");
      await refresh();
      setSamplingDrafts((current) => {
        const next = { ...current };
        delete next[selectedSample.id];
        return next;
      });
    } catch (reason) {
      setSamplingSaveState("error");
      setSaveError(reason instanceof Error ? reason.message : "No se pudo guardar el contexto.");
    }
  };

  const submitPollutant = async (event: FormEvent) => {
    event.preventDefault();
    setPollutantSaveState("saving");
    setSaveError(null);
    try {
      await createPollutantMeasurement({
        siteId: pollutantSiteId,
        samplingEventId: pollutantDraft.samplingEventId || null,
        measuredAt: new Date(pollutantDraft.measuredAt).toISOString(),
        pollutantCode: pollutantDraft.pollutantCode,
        value: Number(pollutantDraft.value),
        unit: pollutantDraft.unit,
        averagingPeriod: pollutantDraft.averagingPeriod.trim() || null,
        instrumentMethod: pollutantDraft.instrumentMethod.trim() || null,
        dataSource: pollutantDraft.dataSource,
        qaQcStatus: pollutantDraft.qaQcStatus,
        notes: pollutantDraft.notes.trim() || null,
      });
      setPollutantSaveState("saved");
      await refresh();
    } catch (reason) {
      setPollutantSaveState("error");
      setSaveError(reason instanceof Error ? reason.message : "No se pudo guardar la medición.");
    }
  };

  if (loading) return <div className="rounded border p-4 text-sm" style={{ borderColor: "var(--ld-border)" }}>Cargando preparación científica…</div>;
  if (error) return <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Calidad ambiental</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ld-text-secondary)" }}>Preparación científica y base de calibración · Fase 1</p>
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">{SCIENTIFIC_NOTICE}</p>
      </header>

      <section className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <h2 className="font-semibold">Alcance de los resultados</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Proyecto
            <select className="mt-1 w-full rounded border px-3 py-2" value={projectId} onChange={(event) => { setProjectId(event.target.value); setSiteId(""); }} style={{ borderColor: "var(--ld-border)" }}>
              <option value="">Todos los proyectos</option>
              {dataset.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Sitio
            <select className="mt-1 w-full rounded border px-3 py-2" value={siteId} onChange={(event) => setSiteId(event.target.value)} style={{ borderColor: "var(--ld-border)" }}>
              <option value="">Todos los sitios</option>
              {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">A. Perfil liquénico descriptivo</h2>
          <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Solo incluye evaluaciones completadas. La unión de máscaras evita contar píxeles solapados dos veces.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Imágenes completadas" value={String(profile.completedImages)} />
          <Metric label="Árboles muestreados" value={String(profile.representedTrees)} />
          <Metric label="Sitios representados" value={String(profile.representedSites)} />
          <Metric label="Jornadas representadas" value={String(profile.representedSamplingEvents)} />
          <Metric label="Cobertura liquénica ponderada" value={formatPercent(profile.weightedCoverage)} />
          <Metric label="Regiones de liquen aceptadas" value={String(profile.acceptedLichenRegions)} />
          <Metric label="Riqueza de morfotipos visuales" value={String(profile.morphotypeRichness)} />
          <Metric label="Resúmenes faltantes o incompletos" value={String(profile.missingMetrics + profile.incompleteMetrics)} />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <article className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
            <h3 className="font-semibold">Distribución por árbol</h3>
            {profile.perTreeCoverage.length === 0 ? <p className="mt-2 text-sm">Sin evaluaciones completadas.</p> : (
              <ul className="mt-3 space-y-2 text-sm">{profile.perTreeCoverage.map((item) => {
                const tree = treeById.get(item.id);
                return <li key={item.id} className="flex justify-between gap-3"><span>{tree?.code ?? item.id} · {item.imageCount} imágenes</span><strong>{formatPercent(item.value)}</strong></li>;
              })}</ul>
            )}
          </article>
          <article className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
            <h3 className="font-semibold">Distribución por sitio</h3>
            {profile.perSiteCoverage.length === 0 ? <p className="mt-2 text-sm">Sin evaluaciones completadas.</p> : (
              <ul className="mt-3 space-y-2 text-sm">{profile.perSiteCoverage.map((item) => <li key={item.id} className="flex justify-between gap-3"><span>{siteById.get(item.id)?.name ?? item.id} · {item.imageCount} imágenes</span><strong>{formatPercent(item.value)}</strong></li>)}</ul>
            )}
          </article>
        </div>
        <article className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h3 className="font-semibold">Calidad y exclusiones</h3>
          <p className="mt-2 text-sm">{profile.excludedRecords} evaluaciones en borrador o sin fecha de finalización fueron excluidas.</p>
          <p className="mt-1 text-sm">{profile.missingMetrics} evaluaciones completadas no tienen `annotation_metrics`; {profile.incompleteMetrics} tienen cobertura no calculable.</p>
          <div className="mt-2 flex flex-wrap gap-2">{profile.qualityFlags.length === 0 ? <span className="text-sm">Sin alertas registradas.</span> : profile.qualityFlags.map((flag) => <span key={flag} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-950">{QUALITY_LABELS[flag] ?? flag}</span>)}</div>
        </article>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">B. Preparación científica</h2>
          <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Se muestran conteos reales y faltantes; no se calcula un puntaje ni se impone un tamaño mínimo universal.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {readiness.map((item) => (
            <article key={item.key} className="flex items-center justify-between gap-4 rounded-lg border p-3" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
              <div><h3 className="font-semibold">{item.label}</h3><p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>{item.detail}</p></div>
              <span className={`shrink-0 rounded border px-2 py-1 text-xs font-semibold ${statusClass(item.status)}`}>{item.status}</span>
            </article>
          ))}
        </div>
        <article className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h3 className="font-semibold">Preparación para comparación y calibración</h3>
          <p className="mt-2 text-sm">La comparación descriptiva es posible para los árboles y sitios representados, pero su comparabilidad científica depende del contexto de muestreo faltante indicado arriba.</p>
          <p className="mt-2 text-sm">Datos para una futura calibración instrumental: <strong>{pollutants.length > 0 ? `hay ${pollutants.length} mediciones co-localizadas registradas` : "no hay mediciones co-localizadas registradas"}</strong>. Su existencia no valida por sí sola una calibración.</p>
          {compatiblePollutants.length > 0 ? <p className="mt-2 text-xs text-slate-500">{compatiblePollutants.length} series compatibles por contaminante, unidad y período de promedio. Nunca se convierten ni mezclan ppm, ppb, µg/m³ y mg/m³ automáticamente.</p> : null}
        </article>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">C. Interpretación permitida</h2>
          <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Razones explícitas para no producir una clasificación ambiental.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="font-semibold text-emerald-950">Qué sí puede concluirse</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-950">
              <li>Comparación descriptiva de cobertura y morfotipos visuales.</li>
              <li>Diferencias relativas observadas entre árboles o sitios representados.</li>
              <li>Evaluación de completitud y alertas de calidad de los datos.</li>
            </ul>
          </article>
          <article className="rounded-lg border border-red-200 bg-red-50 p-4">
            <h3 className="font-semibold text-red-900">Qué no puede concluirse</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-900">
              <li>Categoría validada de contaminación o calidad ambiental.</li>
              <li>Atribución causal a un contaminante específico.</li>
              <li>Sensibilidad de especies; los morfotipos visuales no son especies.</li>
              <li>Categoría universal de calidad ambiental ni umbrales universales.</li>
            </ul>
          </article>
        </div>
        <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">No se produce una clasificación porque cobertura, color y morfotipos no controlan por sí solos rasgos del árbol hospedero, protocolo, microclima, sitios de referencia ni contaminantes instrumentales. {missingMetadata.length} criterios permanecen faltantes o parciales en el alcance seleccionado.</p>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Registrar contexto faltante</h2>
          <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Los borradores se conservan localmente por muestra. Los campos no medidos pueden quedar vacíos.</p>
        </div>
        <form onSubmit={submitSampling} className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Muestra de árbol
              <select required className="mt-1 w-full rounded border px-3 py-2" value={effectiveSampleId} onChange={(event) => setSelectedSampleId(event.target.value)} style={{ borderColor: "var(--ld-border)" }}>
                <option value="">Seleccione una muestra</option>
                {samples.map((sample) => <option key={sample.id} value={sample.id}>{treeById.get(sample.tree_id)?.code ?? sample.tree_id} · {eventById.get(sample.sampling_event_id)?.name ?? sample.sampling_event_id}</option>)}
              </select>
            </label>
            <label className="text-sm">Altura de muestreo (cm)
              <input type="number" min="0.000001" step="any" value={selectedDraft.samplingHeightCm} onChange={(event) => updateSamplingDraft("samplingHeightCm", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} />
            </label>
            <label className="text-sm">Orientación cardinal
              <select value={selectedDraft.orientation} onChange={(event) => updateSamplingDraft("orientation", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }}>
                {ORIENTATIONS.map((orientation) => <option key={orientation} value={orientation}>{orientation === "unknown" ? "No registrada" : orientation === "multiple" ? "Múltiple" : orientation}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Ancho real (cm)<input type="number" min="0.000001" step="any" value={selectedDraft.sampledWidthCm} onChange={(event) => updateSamplingDraft("sampledWidthCm", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
              <label className="text-sm">Alto real (cm)<input type="number" min="0.000001" step="any" value={selectedDraft.sampledHeightCm} onChange={(event) => updateSamplingDraft("sampledHeightCm", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
            </div>
          </div>
          <details className="mt-4 rounded border p-3" style={{ borderColor: "var(--ld-border)" }}>
            <summary className="cursor-pointer font-semibold">Datos científicos adicionales</summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-sm">DAP / DBH (cm)<input type="number" min="0.000001" step="any" value={selectedDraft.dbhCm} onChange={(event) => updateSamplingDraft("dbhCm", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
              <label className="text-sm">pH de corteza<input type="number" min="0" max="14" step="any" value={selectedDraft.barkPh} onChange={(event) => updateSamplingDraft("barkPh", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
              <label className="text-sm">Textura de corteza<input value={selectedDraft.barkTexture} onChange={(event) => updateSamplingDraft("barkTexture", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
              <label className="text-sm">Cobertura de dosel (%)<input type="number" min="0" max="100" step="any" value={selectedDraft.canopyCoverPercent} onChange={(event) => updateSamplingDraft("canopyCoverPercent", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
              <label className="text-sm">Temperatura del aire (°C)<input type="number" min="-10" max="50" step="any" value={selectedDraft.airTemperatureC} onChange={(event) => updateSamplingDraft("airTemperatureC", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
              <label className="text-sm">Humedad relativa (%)<input type="number" min="0" max="100" step="any" value={selectedDraft.relativeHumidityPercent} onChange={(event) => updateSamplingDraft("relativeHumidityPercent", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
              <label className="text-sm">Uso de suelo / contexto<input value={selectedDraft.landUseClassification} onChange={(event) => updateSamplingDraft("landUseClassification", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
              <label className="text-sm">¿Candidato a referencia/control?
                <select value={selectedDraft.referenceCandidate} onChange={(event) => updateSamplingDraft("referenceCandidate", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }}><option value="">No evaluado</option><option value="yes">Sí, candidato</option><option value="no">No</option></select>
              </label>
              <label className="text-sm">Fecha y hora de medición<input type="datetime-local" value={selectedDraft.measuredAt} onChange={(event) => updateSamplingDraft("measuredAt", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
              <label className="text-sm">Procedencia / método<input value={selectedDraft.provenance} onChange={(event) => updateSamplingDraft("provenance", event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
              <label className="text-sm sm:col-span-2">Notas de campo<textarea value={selectedDraft.notes} onChange={(event) => updateSamplingDraft("notes", event.target.value)} className="mt-1 min-h-20 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
            </div>
          </details>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={!selectedSample || samplingSaveState === "saving"} className="rounded bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{samplingSaveState === "saving" ? "Guardando…" : "Guardar contexto"}</button>
            <span role="status" className={`text-sm ${samplingSaveState === "error" ? "text-red-700" : "text-emerald-800"}`}>{samplingSaveState === "saved" ? "Guardado." : samplingSaveState === "error" ? "Error al guardar; el borrador se conserva." : "Borrador conservado en este dispositivo."}</span>
          </div>
        </form>

        <form onSubmit={submitPollutant} className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h3 className="font-semibold">Medición instrumental opcional</h3>
          <p className="mt-1 text-xs text-slate-500">Registre el valor y su unidad original. No se realizan conversiones automáticas entre gases o unidades.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">Sitio<select required value={pollutantSiteId} onChange={(event) => setPollutantDraft((current) => ({ ...current, siteId: event.target.value, samplingEventId: "" }))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }}><option value="">Seleccione</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
            <label className="text-sm">Jornada (opcional)<select value={pollutantDraft.samplingEventId} onChange={(event) => setPollutantDraft((current) => ({ ...current, samplingEventId: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }}><option value="">Sin jornada asociada</option>{pollutantEvents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="text-sm">Fecha y hora<input required type="datetime-local" value={pollutantDraft.measuredAt} onChange={(event) => setPollutantDraft((current) => ({ ...current, measuredAt: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
            <label className="text-sm">Contaminante<select value={pollutantDraft.pollutantCode} onChange={(event) => setPollutantDraft((current) => ({ ...current, pollutantCode: event.target.value as PollutantCode }))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }}>{POLLUTANTS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="text-sm">Valor<input required type="number" step="any" value={pollutantDraft.value} onChange={(event) => setPollutantDraft((current) => ({ ...current, value: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
            <label className="text-sm">Unidad<input required value={pollutantDraft.unit} onChange={(event) => setPollutantDraft((current) => ({ ...current, unit: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
            <label className="text-sm">Período de promedio<input value={pollutantDraft.averagingPeriod} onChange={(event) => setPollutantDraft((current) => ({ ...current, averagingPeriod: event.target.value }))} placeholder="p. ej., 1 h" className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
            <label className="text-sm">Fuente de datos<input required value={pollutantDraft.dataSource} onChange={(event) => setPollutantDraft((current) => ({ ...current, dataSource: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
          </div>
          <details className="mt-4 rounded border p-3" style={{ borderColor: "var(--ld-border)" }}>
            <summary className="cursor-pointer font-semibold">Datos científicos adicionales</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Instrumento o método analítico<input value={pollutantDraft.instrumentMethod} onChange={(event) => setPollutantDraft((current) => ({ ...current, instrumentMethod: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
              <label className="text-sm">Estado QA/QC<select value={pollutantDraft.qaQcStatus} onChange={(event) => setPollutantDraft((current) => ({ ...current, qaQcStatus: event.target.value as QaQcStatus }))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }}><option value="not_assessed">No evaluado</option><option value="provisional">Provisional</option><option value="validated">Validado</option><option value="rejected">Rechazado</option></select></label>
              <label className="text-sm sm:col-span-2">Notas QA/QC<textarea value={pollutantDraft.notes} onChange={(event) => setPollutantDraft((current) => ({ ...current, notes: event.target.value }))} className="mt-1 min-h-20 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
            </div>
          </details>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pollutantSaveState === "saving"} className="rounded bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pollutantSaveState === "saving" ? "Guardando…" : "Guardar medición"}</button>
            <span role="status" className={`text-sm ${pollutantSaveState === "error" ? "text-red-700" : "text-emerald-800"}`}>{pollutantSaveState === "saved" ? "Medición guardada." : pollutantSaveState === "error" ? "Error al guardar; el borrador se conserva." : "Borrador conservado en este dispositivo."}</span>
          </div>
        </form>
        {saveError ? <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveError}</p> : null}
      </section>

      <section className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <h2 className="text-xl font-semibold">Trazabilidad científica</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-slate-500">Árboles</dt><dd className="font-semibold">{profile.representedTrees}</dd></div>
          <div><dt className="text-xs text-slate-500">Imágenes completadas</dt><dd className="font-semibold">{profile.completedImages}</dd></div>
          <div><dt className="text-xs text-slate-500">Jornadas</dt><dd className="font-semibold">{profile.representedSamplingEvents}</dd></div>
          <div><dt className="text-xs text-slate-500">Mediciones para calibración instrumental</dt><dd className="font-semibold">{pollutants.length > 0 ? "Existen" : "No existen"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Método / versión</dt><dd className="font-semibold">{profile.calculationMethods.join(", ") || "No calculado"}</dd></div>
          <div><dt className="text-xs text-slate-500">Último cálculo</dt><dd className="font-semibold">{profile.lastCalculatedAt ? new Date(profile.lastCalculatedAt).toLocaleString("es-DO") : "No calculado"}</dd></div>
          <div><dt className="text-xs text-slate-500">Metadatos faltantes</dt><dd className="font-semibold">{missingMetadata.length} criterios</dd></div>
        </dl>
        <p className="mt-3 text-sm"><strong>Alertas:</strong> {profile.qualityFlags.map((flag) => QUALITY_LABELS[flag] ?? flag).join(", ") || "ninguna registrada"}.</p>
        <p className="mt-2 rounded bg-slate-50 p-3 font-mono text-xs">Cobertura por imagen (%) = píxeles de la unión de liquen dentro del tronco / píxeles del tronco × 100</p>
        <p className="mt-2 rounded bg-slate-50 p-3 font-mono text-xs">Cobertura ponderada (%) = Σ píxeles de la unión de liquen dentro del tronco / Σ píxeles del tronco × 100</p>
      </section>

      <details className="rounded-lg border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <summary className="cursor-pointer text-xl font-semibold">Metodología y referencias</summary>
        <div className="mt-4 space-y-3 text-sm">
          <p>La cobertura usa la unión de regiones de liquen aceptadas intersectada con el tronco confirmado; por ello una superposición no se cuenta dos veces. Solo se incluyen `annotation_sets` completados con fecha de finalización.</p>
          <p>La cobertura y los morfotipos visuales son mediciones descriptivas. La interpretación ambiental requiere estandarización de muestreo, rasgos del hospedero, microclima, referencias comparables y calibración con contaminantes.</p>
          <ul className="list-disc space-y-1 pl-5">{REFERENCES.map(([label, href]) => <li key={href}><a href={href} target="_blank" rel="noreferrer" className="font-semibold text-emerald-800 underline">{label}</a></li>)}</ul>
        </div>
      </details>
    </main>
  );
}

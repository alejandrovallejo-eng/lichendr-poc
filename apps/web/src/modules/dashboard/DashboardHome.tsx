"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ContextTrail from "@/components/ContextTrail";
import { buildDashboardFocusSnapshot, loadDashboardFocusEcology, loadDashboardHomeData, type DashboardHomeSnapshot } from "./home-data";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("es-DO", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-DO", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function DashboardMetric({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--ld-border)" }}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>{label}</p>
    </div>
  );
}

function ProgressRow({ label, status, detail, href }: {
  label: string;
  status: string;
  detail: string;
  href?: string;
}) {
  return (
    <li className="flex flex-col gap-1 rounded-xl border bg-white px-4 py-3 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: "var(--ld-border)" }}>
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-sm"><strong>{status}</strong> · {detail}</p>
      </div>
      {href ? <Link href={href} className="text-sm font-medium underline">Abrir</Link> : null}
    </li>
  );
}

export default function DashboardHome() {
  const [snapshot, setSnapshot] = useState<DashboardHomeSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [selectedOpenJourney, setSelectedOpenJourney] = useState("");
  const [ecology, setEcology] = useState<{
    eventId: string | null;
    data: ReturnType<typeof buildDashboardFocusSnapshot>["diversidad"] | null;
    error: string;
  }>({ eventId: null, data: null, error: "" });

  useEffect(() => {
    const controller = new AbortController();
    void loadDashboardHomeData(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setSnapshot(value);
        setError("");
        setLoading(false);
        setSelectedOpenJourney((current) => current && value.openJourneys.some((journey) => journey.event.id === current)
          ? current
          : value.openJourneys[0]?.event.id ?? "");
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setSnapshot(null);
          setLoading(false);
          setError(reason instanceof Error ? reason.message : "No se pudo abrir tu panel inicial.");
        }
      });
    return () => controller.abort();
  }, [attempt]);

  const selectedJourney = useMemo(
    () => snapshot?.openJourneys.find((journey) => journey.event.id === selectedOpenJourney) ?? snapshot?.openJourneys[0] ?? null,
    [selectedOpenJourney, snapshot],
  );

  useEffect(() => {
    if (!selectedJourney) return;
    const controller = new AbortController();
    void loadDashboardFocusEcology(selectedJourney.event.id, controller.signal)
      .then((summary) => {
        if (!controller.signal.aborted) {
          setEcology({ eventId: selectedJourney.event.id, data: buildDashboardFocusSnapshot(selectedJourney, summary).diversidad, error: "" });
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setEcology({
            eventId: selectedJourney.event.id,
            data: null,
            error: reason instanceof Error ? reason.message : "No se pudo leer la diversidad guardada.",
          });
        }
      });
    return () => controller.abort();
  }, [selectedJourney]);

  if (error) {
    return (
      <section className="rounded-2xl border bg-white p-6" style={{ borderColor: "var(--ld-border)" }}>
        <h1 className="text-3xl font-semibold">Tu trabajo de campo</h1>
        <p role="alert" className="mt-3">{error}</p>
        <p className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>No mostraremos un fallo de lectura como si fueran cero registros.</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setError("");
            setAttempt((value) => value + 1);
          }}
          className="mt-4 rounded-lg px-4 py-2 font-semibold text-white"
          style={{ background: "var(--ld-sidebar)" }}
        >
          Reintentar
        </button>
      </section>
    );
  }

  if (loading) {
    return <p role="status">Cargando tu trabajo guardado…</p>;
  }

  if (!snapshot) return null;

  if (!snapshot.recentJourneys.length) {
    return (
      <section className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Tu trabajo de campo</h1>
          <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Conserva juntos proyecto, sitio y jornada para relacionar los árboles de una misma zona.</p>
        </header>
        <div className="rounded-2xl border bg-white p-6" style={{ borderColor: "var(--ld-border)" }}>
          <h2 className="text-xl font-semibold">Prepara tu primera jornada</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>Cuando guardes una jornada, aquí verás cómo continuarla y dónde consultar sus resultados.</p>
          <Link href="/preparar-jornada" className="mt-4 inline-flex rounded-lg px-4 py-2 font-semibold text-white" style={{ background: "var(--ld-sidebar)" }}>
            Nueva jornada
          </Link>
        </div>
      </section>
    );
  }

  const focus = selectedJourney ? buildDashboardFocusSnapshot(selectedJourney) : null;
  const ecologyStatus = selectedJourney && ecology.eventId === selectedJourney.event.id ? ecology : { eventId: selectedJourney?.event.id ?? null, data: null, error: "" };

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Tu trabajo de campo</h1>
        <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Retoma una jornada abierta, consulta qué quedó guardado y ve directamente a sus resultados.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardMetric value={snapshot.openJourneys.length} label="Jornadas abiertas" />
        <DashboardMetric value={snapshot.journeys} label="Jornadas accesibles" />
        <DashboardMetric value={snapshot.uniqueTrees} label="Árboles únicos" />
        <DashboardMetric value={snapshot.sites} label="Sitios accesibles" />
      </div>

      <section className="rounded-2xl border bg-white p-6" style={{ borderColor: "var(--ld-border)" }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--ld-text-secondary)" }}>Siguiente acción</p>
              <h2 className="text-2xl font-semibold">{selectedJourney ? "Continuar jornada" : "Nueva jornada"}</h2>
            </div>
            {selectedJourney ? (
              <>
                <ContextTrail entries={[
                  { label: "Proyecto", value: selectedJourney.project.name },
                  { label: "Sitio", value: selectedJourney.site.name },
                  { label: "Jornada", value: selectedJourney.event.name },
                  { label: "Árbol", value: selectedJourney.suggestedTreeLabel },
                ]} />
                <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                  Muestreo: {formatDate(selectedJourney.event.sampled_at)}
                  {selectedJourney.lastSavedAt ? ` · Último guardado: ${formatDateTime(selectedJourney.lastSavedAt)}` : " · Sin guardados recientes"}
                </p>
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>No hay jornadas abiertas. Empieza una nueva sin perder la relación entre proyecto, sitio y árboles.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {selectedJourney ? (
              <Link href={selectedJourney.workHref} className="inline-flex rounded-lg px-4 py-2 font-semibold text-white" style={{ background: "var(--ld-sidebar)" }}>
                {selectedJourney.workLabel}
              </Link>
            ) : null}
            <Link href="/preparar-jornada" className="inline-flex rounded-lg border px-4 py-2 font-semibold" style={{ borderColor: "var(--ld-border)" }}>
              Nueva jornada
            </Link>
          </div>
        </div>

        {snapshot.openJourneys.length > 1 ? (
          <div className="mt-5">
            <p className="mb-2 text-sm font-semibold">También tienes abiertas</p>
            <div className="flex flex-wrap gap-2">
              {snapshot.openJourneys.map((journey) => (
                <button
                  key={journey.event.id}
                  type="button"
                  onClick={() => setSelectedOpenJourney(journey.event.id)}
                  aria-pressed={selectedJourney?.event.id === journey.event.id}
                  className={`rounded-full border px-3 py-2 text-sm ${selectedJourney?.event.id === journey.event.id ? "text-white" : ""}`}
                  style={{
                    borderColor: selectedJourney?.event.id === journey.event.id ? "var(--ld-sidebar)" : "var(--ld-border)",
                    background: selectedJourney?.event.id === journey.event.id ? "var(--ld-sidebar)" : "#fff",
                  }}
                >
                  {journey.event.name} · {journey.site.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {focus ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Resumen del progreso</h2>
          <ul className="space-y-3">
            <ProgressRow label="Guardado" status={focus.guardado.status} detail={focus.guardado.detail} href={focus.journey.resultsHref ?? focus.journey.workHref} />
            <ProgressRow label="Captura y revisión" status={focus.captura.status} detail={focus.captura.detail} href={focus.journey.workHref} />
            <ProgressRow
              label="Diversidad"
              status={ecologyStatus.error ? "Requiere revisión" : ecologyStatus.data?.status ?? "Cargando"}
              detail={ecologyStatus.error || ecologyStatus.data?.detail || "Leyendo cuadrantes y celdas guardadas…"}
              href={`/analysis?mode=ecology&eventId=${encodeURIComponent(focus.journey.event.id)}`}
            />
            <ProgressRow label="Jornada" status={focus.jornada.status} detail={focus.jornada.detail} href={focus.journey.event.status === "completed" ? (focus.journey.resultsHref ?? focus.journey.workHref) : `/jornada/${encodeURIComponent(focus.journey.event.id)}`} />
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Jornadas recientes</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href="/analysis" className="underline">Resumen de jornadas</Link>
            <Link href="/environmental-quality" className="underline">Indicador biológico relativo</Link>
          </div>
        </div>
        <div className="space-y-3">
          {snapshot.recentJourneys.map((journey) => (
            <article key={journey.event.id} className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--ld-border)" }}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">{journey.event.name}</h3>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold">
                      {journey.event.status === "completed" ? "Cerrada" : "Abierta"}
                    </span>
                  </div>
                  <ContextTrail entries={[
                    { label: "Proyecto", value: journey.project.name },
                    { label: "Sitio", value: journey.site.name },
                    { label: "Jornada", value: journey.event.name },
                  ]} />
                  <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                    Muestreo: {formatDate(journey.event.sampled_at)}
                    {journey.latestActivityAt ? ` · Última actividad: ${formatDateTime(journey.latestActivityAt)}` : " · Sin actividad guardada"}
                  </p>
                  <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                    {journey.uniqueTreeCount} árbol(es) · {journey.rows.length} evaluación(es) · {journey.savedViews} vista(s) guardadas
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link href={journey.workHref} className="inline-flex rounded-lg px-4 py-2 font-semibold text-white" style={{ background: "var(--ld-sidebar)" }}>
                    {journey.workLabel}
                  </Link>
                  {journey.event.status !== "completed" && journey.resultsHref
                    ? <Link href={journey.resultsHref} className="inline-flex rounded-lg border px-4 py-2 font-semibold" style={{ borderColor: "var(--ld-border)" }}>Ver resultados</Link>
                    : null}
                  <Link href={journey.indicatorHref} className="inline-flex rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>
                    Indicador biológico
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

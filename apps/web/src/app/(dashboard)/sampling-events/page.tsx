"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { fetchProjects } from "@/modules/projects/client";
import { fetchSitesByProject } from "@/modules/sites/client";
import { fetchSamplingEventsBySite, createSamplingEvent } from "@/modules/sampling-events/client";
import type { Project, Site, SamplingEvent } from "@/types/domain";

export const dynamic = "force-dynamic";

const statusOptions = [
  { value: "draft", label: "Borrador" },
  { value: "completed", label: "Completada" },
];

function formatLocalDateTime(value: string) {
  try {
    return new Date(value).toLocaleString("es-DO", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function getLocalDatetimeLocalValue(date: Date) {
  const tzOffset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - tzOffset * 60000);
  return localDate.toISOString().slice(0, 16);
}

export default function SamplingEventsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [samplingEvents, setSamplingEvents] = useState<SamplingEvent[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(undefined);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [eventName, setEventName] = useState("");
  const [sampledAt, setSampledAt] = useState(getLocalDatetimeLocalValue(new Date()));
  const [observerNames, setObserverNames] = useState("");
  const [weatherNotes, setWeatherNotes] = useState("");
  const [status, setStatus] = useState<"draft" | "completed">("draft");
  const [notes, setNotes] = useState("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId) ?? null,
    [sites, selectedSiteId]
  );

  useEffect(() => {
    async function loadProjects() {
      setLoadingProjects(true);
      setError(null);

      const { projects: loadedProjects, error: projectsError } = await fetchProjects();

      if (projectsError) {
        setError(projectsError);
        setProjects([]);
        setLoadingProjects(false);
        return;
      }

      setProjects(loadedProjects);

      const searchParams = new URLSearchParams(window.location.search);
      const projectId = searchParams.get("projectId") ?? undefined;
      const siteId = searchParams.get("siteId") ?? undefined;
      const projectIsValid = projectId && loadedProjects.some((project) => project.id === projectId);

      setSelectedProjectId(projectIsValid ? projectId : loadedProjects[0]?.id);
      setSelectedSiteId(siteId);
      setLoadingProjects(false);
    }

    loadProjects();
  }, []);

  useEffect(() => {
    async function syncSites() {
      if (!selectedProjectId) {
        setSites([]);
        setSelectedSiteId(undefined);
        return;
      }

      setLoadingSites(true);
      setError(null);

      const { sites: loadedSites, error: sitesError } = await fetchSitesByProject(selectedProjectId);

      if (sitesError) {
        setError(sitesError);
        setSites([]);
        setSelectedSiteId(undefined);
        setLoadingSites(false);
        return;
      }

      setSites(loadedSites);

      const searchParams = new URLSearchParams(window.location.search);
      const siteId = searchParams.get("siteId") ?? undefined;
      const siteIsValid = siteId && loadedSites.some((site) => site.id === siteId);

      setSelectedSiteId(siteIsValid ? siteId : loadedSites[0]?.id);
      setLoadingSites(false);
    }

    syncSites();
  }, [selectedProjectId]);

  useEffect(() => {
    async function syncEvents() {
      if (!selectedSiteId) {
        setSamplingEvents([]);
        return;
      }

      setLoadingEvents(true);
      setError(null);

      const { samplingEvents: loadedEvents, error: eventsError } = await fetchSamplingEventsBySite(selectedSiteId);

      if (eventsError) {
        setError(eventsError);
        setSamplingEvents([]);
        setLoadingEvents(false);
        return;
      }

      setSamplingEvents(loadedEvents);
      setLoadingEvents(false);
    }

    syncEvents();
  }, [selectedSiteId]);

  const validateForm = () => {
    if (!selectedProjectId) {
      return "Selecciona un proyecto.";
    }

    if (!selectedSiteId) {
      return "Selecciona un sitio.";
    }

    if (!eventName.trim()) {
      return "El nombre de la jornada es obligatorio.";
    }

    if (eventName.trim().length > 120) {
      return "El nombre no puede tener más de 120 caracteres.";
    }

    if (!sampledAt) {
      return "La fecha y hora del muestreo son obligatorias.";
    }

    const dateValue = new Date(sampledAt);
    if (Number.isNaN(dateValue.getTime())) {
      return "La fecha y hora del muestreo no es válida.";
    }

    if (!["draft", "completed"].includes(status)) {
      return "El estado de la jornada no es válido.";
    }

    return null;
  };

  const localSampledAtToISO = (localValue: string) => {
    const localDate = new Date(localValue);
    const timezoneOffsetMs = localDate.getTimezoneOffset() * 60000;
    return new Date(localDate.getTime() - timezoneOffsetMs).toISOString();
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!selectedSiteId) {
      setError("Selecciona un sitio.");
      return;
    }

    setSubmitting(true);

    const sampledAtIso = localSampledAtToISO(sampledAt);

    const { samplingEvent, error: createError } = await createSamplingEvent({
      siteId: selectedSiteId,
      name: eventName.trim(),
      sampledAt: sampledAtIso,
      observerNames: observerNames.trim() || undefined,
      weatherNotes: weatherNotes.trim() || undefined,
      protocolVersion: "poc-v1",
      status,
      notes: notes.trim() || undefined,
    });

    if (createError) {
      if (createError.toLowerCase().includes("unique") || createError.toLowerCase().includes("duplicate")) {
        setError("Ya existe una jornada con ese nombre en este sitio.");
      } else {
        setError("No se pudo crear la jornada. Intenta de nuevo.");
      }
      setSubmitting(false);
      return;
    }

    if (samplingEvent) {
      setSamplingEvents((current) => [samplingEvent, ...current]);
      setEventName("");
      setSampledAt(getLocalDatetimeLocalValue(new Date()));
      setObserverNames("");
      setWeatherNotes("");
      setStatus("draft");
      setNotes("");
      setSuccessMessage("Jornada guardada correctamente.");
    }

    setSubmitting(false);
  };

  return (
    <div>
      <PageHeader title="Jornadas de muestreo" subtitle="Administra jornadas de muestreo dentro de tus sitios y proyectos." />

      <section className="mb-6" style={{ color: "var(--ld-text-secondary)" }}>
        <p className="text-sm">La jerarquía es Proyecto → Sitio → Jornada. Selecciona un proyecto y un sitio para crear jornadas de muestreo.</p>
      </section>

      {loadingProjects ? (
        <div className="mb-6 rounded px-4 py-3" style={{ background: "var(--ld-card)", border: "1px solid var(--ld-border)" }}>
          Cargando proyectos...
        </div>
      ) : projects.length === 0 ? (
        <div className="mb-6 rounded px-4 py-3" style={{ background: "var(--ld-card)", border: "1px solid var(--ld-border)" }}>
          <p>Primero debes crear un proyecto.</p>
          <a href="/projects" className="text-sm font-medium" style={{ color: "var(--ld-primary)" }}>
            Ir a proyectos
          </a>
        </div>
      ) : (
        <section className="mb-6 p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="project-select">
                Proyecto
              </label>
              <select
                id="project-select"
                value={selectedProjectId ?? ""}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              >
                <option value="">Selecciona un proyecto</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="site-select">
                Sitio
              </label>
              <select
                id="site-select"
                value={selectedSiteId ?? ""}
                onChange={(event) => setSelectedSiteId(event.target.value)}
                disabled={sites.length === 0}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              >
                <option value="">Selecciona un sitio</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>{site.name}</option>
                ))}
              </select>
            </div>
          </div>
        </section>
      )}

      {selectedProjectId && sites.length === 0 && !loadingSites ? (
        <div className="mb-6 rounded px-4 py-3" style={{ background: "var(--ld-card)", border: "1px solid var(--ld-border)" }}>
          <p>Este proyecto todavía no tiene sitios.</p>
          <a href={`/sites?projectId=${selectedProjectId}`} className="text-sm font-medium" style={{ color: "var(--ld-primary)" }}>
            Gestionar sitios
          </a>
        </div>
      ) : null}

      {selectedProjectId && sites.length > 0 ? (
        <section className="mb-6 p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h2 className="font-semibold mb-3" style={{ color: "var(--ld-text)" }}>Nueva jornada</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="event-name">
                Nombre de la jornada
              </label>
              <input
                id="event-name"
                type="text"
                value={eventName}
                onChange={(event) => setEventName(event.target.value)}
                maxLength={120}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="sampled-at">
                Fecha y hora del muestreo
              </label>
              <input
                id="sampled-at"
                type="datetime-local"
                value={sampledAt}
                onChange={(event) => setSampledAt(event.target.value)}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="observer-names">
                Observadores (opcional)
              </label>
              <input
                id="observer-names"
                type="text"
                value={observerNames}
                onChange={(event) => setObserverNames(event.target.value)}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="weather-notes">
                Condiciones meteorológicas (opcional)
              </label>
              <textarea
                id="weather-notes"
                value={weatherNotes}
                onChange={(event) => setWeatherNotes(event.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="status">
                Estado
              </label>
              <select
                id="status"
                value={status}
                onChange={(event) => setStatus(event.target.value as "draft" | "completed")}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="protocol-version">
                Versión del protocolo
              </label>
              <div className="px-3 py-2 rounded border" style={{ borderColor: "var(--ld-border)", background: "#f8f9fa", color: "var(--ld-text)" }}>
                poc-v1
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="notes">
                Notas (opcional)
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded border"
              style={{ background: "var(--ld-sand)", color: "var(--ld-text)", borderColor: "var(--ld-border)" }}
            >
              {submitting ? "Guardando jornada..." : "Guardar jornada"}
            </button>
          </form>

          {error ? (
            <div className="mt-4 rounded px-4 py-3" style={{ background: "#F9DAD6", color: "#842029", border: "1px solid #F5C2C7" }}>
              {error}
            </div>
          ) : null}

          {successMessage ? (
            <div className="mt-4 rounded px-4 py-3" style={{ background: "#D1E7DD", color: "#0F5132", border: "1px solid #BADBCC" }}>
              {successMessage}
            </div>
          ) : null}
        </section>
      ) : null}

      {selectedProjectId && selectedSiteId ? (
        <section className="p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h2 className="font-semibold mb-3" style={{ color: "var(--ld-text)" }}>Jornadas de muestreo</h2>
          {loadingEvents ? (
            <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Cargando jornadas...</p>
          ) : samplingEvents.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>No hay jornadas registradas para este sitio.</p>
          ) : (
            <div className="space-y-4">
              {samplingEvents.map((event) => (
                <article key={event.id} className="p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
                  <div className="flex flex-col md:flex-row md:justify-between gap-3">
                    <div>
                      <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>{event.name}</h3>
                      <p className="text-sm mt-1" style={{ color: "var(--ld-text-secondary)" }}>
                        {selectedProject?.name} / {selectedSite?.name}
                      </p>
                    </div>
                    <span className="text-xs uppercase" style={{ color: "var(--ld-text-secondary)" }}>
                      {formatLocalDateTime(event.sampledAt)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {event.observerNames ? (
                      <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}><strong>Observadores:</strong> {event.observerNames}</p>
                    ) : null}
                    {event.weatherNotes ? (
                      <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}><strong>Condiciones:</strong> {event.weatherNotes}</p>
                    ) : null}
                    <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}><strong>Estado:</strong> {event.status === "draft" ? "Borrador" : "Completada"}</p>
                    <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}><strong>Protocolo:</strong> {event.protocolVersion}</p>
                    {event.notes ? (
                      <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}><strong>Notas:</strong> {event.notes}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-3">
                      <a
                        href={`/jornada/${event.id}`}
                        className="text-sm font-medium"
                        style={{ color: "var(--ld-primary)" }}
                      >
                        Árboles de esta jornada
                      </a>
                      <a
                        href={`/trees?projectId=${selectedProjectId}&siteId=${selectedSiteId}&eventId=${event.id}`}
                        className="text-sm font-medium"
                        style={{ color: "var(--ld-primary)" }}
                      >
                        Vista clásica
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

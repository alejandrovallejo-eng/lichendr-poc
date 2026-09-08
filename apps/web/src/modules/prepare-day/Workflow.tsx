"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import type { Project, SamplingEvent, Site } from "@/types/domain";
import { fetchProjects } from "@/modules/projects/client";
import { fetchSitesByProject } from "@/modules/sites/client";
import { fetchSamplingEventsBySite } from "@/modules/sampling-events/client";
import { preparaJornada, type PrepareDayResult } from "./client";
import {
  formatLocalDate,
  mergeDraftWithSelection,
  resetIncompatibleSelections,
  suggestSamplingEventName,
} from "./logic";

type Mode = "existing" | "new";

const DRAFT_STORAGE_KEY = "lichendr:prepare-day:draft";

function getLocalDatetimeLocalValue(date: Date) {
  const tzOffset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - tzOffset * 60000);
  return localDate.toISOString().slice(0, 16);
}

function localDatetimeLocalToISO(localValue: string) {
  const localDate = new Date(localValue);
  const timezoneOffsetMs = localDate.getTimezoneOffset() * 60000;
  return new Date(localDate.getTime() - timezoneOffsetMs).toISOString();
}

interface DraftState {
  projectId?: string;
  siteId?: string;
  eventId?: string;
}

function readDraft(): DraftState | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as DraftState;
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : undefined,
      siteId: typeof parsed.siteId === "string" ? parsed.siteId : undefined,
      eventId: typeof parsed.eventId === "string" ? parsed.eventId : undefined,
    };
  } catch {
    return null;
  }
}

function writeDraft(next: DraftState | null) {
  if (typeof window === "undefined") return;
  try {
    if (!next) {
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // sessionStorage may be unavailable (private mode, quota). We degrade
    // gracefully — the flow still works, only partial-failure recovery is lost.
  }
}

export default function PrepareDayWorkflow() {
  const router = useRouter();

  // Data loaded from the server.
  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [events, setEvents] = useState<SamplingEvent[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Section modes.
  const [projectMode, setProjectMode] = useState<Mode>("new");
  const [siteMode, setSiteMode] = useState<Mode>("new");
  const [eventMode, setEventMode] = useState<Mode>("new");

  // Selected existing ids.
  const [existingProjectId, setExistingProjectId] = useState<string | undefined>(undefined);
  const [existingSiteId, setExistingSiteId] = useState<string | undefined>(undefined);
  const [existingEventId, setExistingEventId] = useState<string | undefined>(undefined);

  // New project fields.
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");

  // New site fields.
  const [siteName, setSiteName] = useState("");
  const [siteDescription, setSiteDescription] = useState("");
  const [siteProvince, setSiteProvince] = useState("");
  const [siteMunicipality, setSiteMunicipality] = useState("");
  const [siteLatitude, setSiteLatitude] = useState("");
  const [siteLongitude, setSiteLongitude] = useState("");
  const [siteGpsAccuracyM, setSiteGpsAccuracyM] = useState("");
  const [siteNotes, setSiteNotes] = useState("");
  const [siteRadiusM, setSiteRadiusM] = useState(100);
  const [siteLocationSource, setSiteLocationSource] = useState<"manual" | "gps" | "unknown">("manual");
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);

  // New event fields.
  const [eventSampledAt, setEventSampledAt] = useState<string>(() => getLocalDatetimeLocalValue(new Date()));
  const [eventNameOverride, setEventNameOverride] = useState<string | null>(null);
  const [eventObservers, setEventObservers] = useState("");
  const [eventNotes, setEventNotes] = useState("");

  // Collapsible sections.
  const [siteExtraOpen, setSiteExtraOpen] = useState(false);
  const [eventExtraOpen, setEventExtraOpen] = useState(false);

  // Flow state.
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Load projects at mount. Also apply the draft persisted from a previous
  // partial failure so the user can pick up where they left off.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingProjects(true);
      const draft = readDraft();
      const { projects: rows, error: err } = await fetchProjects();
      if (!active) return;
      if (err) setError(err);
      setProjects(rows);
      if (draft?.projectId && rows.some((row) => row.id === draft.projectId)) {
        setProjectMode("existing");
        setExistingProjectId(draft.projectId);
      }
      if (draft?.siteId) {
        setSiteMode("existing");
        setExistingSiteId(draft.siteId);
      }
      if (draft?.eventId) {
        setEventMode("existing");
        setExistingEventId(draft.eventId);
      }
      if (draft && (draft.projectId || draft.siteId || draft.eventId)) {
        setNotice(
          "Retomamos tu selección anterior. Puedes continuar sin recrear proyecto, sitio ni jornada.",
        );
      }
      setLoadingProjects(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load sites whenever the project changes.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!existingProjectId) {
        setSites([]);
        return;
      }
      setLoadingSites(true);
      const { sites: rows, error: err } = await fetchSitesByProject(existingProjectId);
      if (!active) return;
      if (err) setError(err);
      setSites(rows);
      setLoadingSites(false);
    })();
    return () => {
      active = false;
    };
  }, [existingProjectId]);

  // Load events whenever the site changes.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!existingSiteId) {
        setEvents([]);
        return;
      }
      setLoadingEvents(true);
      const { samplingEvents: rows, error: err } = await fetchSamplingEventsBySite(existingSiteId);
      if (!active) return;
      if (err) setError(err);
      setEvents(rows);
      setLoadingEvents(false);
    })();
    return () => {
      active = false;
    };
  }, [existingSiteId]);

  // Automatically suggest a jornada name derived from the date, respecting
  // existing names on the site so we do not collide. The user can still edit —
  // once they type, the override wins; clearing the input via delete gives
  // them back the suggestion on the next keystroke.
  const suggestedEventName = useMemo(() => {
    try {
      const date = new Date(eventSampledAt);
      if (Number.isNaN(date.getTime())) return "";
      return suggestSamplingEventName(date, events);
    } catch {
      return "";
    }
  }, [events, eventSampledAt]);

  const effectiveEventName = eventNameOverride ?? suggestedEventName;

  const requestDeviceGps = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setGpsMessage(
        "Este dispositivo no expone geolocalización. Introduce las coordenadas manualmente si las conoces.",
      );
      return;
    }
    setGpsBusy(true);
    setGpsMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setSiteLatitude(position.coords.latitude.toFixed(6));
        setSiteLongitude(position.coords.longitude.toFixed(6));
        if (Number.isFinite(position.coords.accuracy)) {
          setSiteGpsAccuracyM(position.coords.accuracy.toFixed(1));
        }
        setSiteLocationSource("gps");
        setGpsMessage("Coordenadas obtenidas desde el dispositivo. Revísalas antes de guardar.");
        setGpsBusy(false);
      },
      (positionError) => {
        setGpsBusy(false);
        setGpsMessage(
          positionError.code === positionError.PERMISSION_DENIED
            ? "Permiso de ubicación denegado. Puedes introducir las coordenadas manualmente."
            : "No se pudo leer la ubicación del dispositivo.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }, []);

  const handleProjectMode = (mode: Mode) => {
    setProjectMode(mode);
    setError(null);
    if (mode === "new") {
      // Clear existing selection so the flow does not accidentally reuse it.
      setExistingProjectId(undefined);
      setSites([]);
      setEvents([]);
      setSiteMode("new");
      setEventMode("new");
      setExistingSiteId(undefined);
      setExistingEventId(undefined);
    }
  };

  const handleSelectExistingProject = (id: string | undefined) => {
    // Changing the project invalidates existing site and event selections.
    const next = resetIncompatibleSelections(
      { projectId: existingProjectId, siteId: existingSiteId, eventId: existingEventId },
      "project",
      id,
    );
    setExistingProjectId(next.projectId);
    setExistingSiteId(next.siteId);
    setExistingEventId(next.eventId);
    if (next.projectId) {
      // Default to "existing" mode for downstream sections; the user can
      // switch to "new" once the site list finishes loading.
      setSiteMode("existing");
      setEventMode("existing");
    }
  };

  const handleSelectExistingSite = (id: string | undefined) => {
    const next = resetIncompatibleSelections(
      { projectId: existingProjectId, siteId: existingSiteId, eventId: existingEventId },
      "site",
      id,
    );
    setExistingSiteId(next.siteId);
    setExistingEventId(next.eventId);
  };

  const validate = (): string | null => {
    if (projectMode === "existing" && !existingProjectId) {
      return "Selecciona un proyecto existente o cambia a crear uno.";
    }
    if (projectMode === "new" && !projectName.trim()) {
      return "El nombre del proyecto es obligatorio.";
    }
    if (siteMode === "existing" && !existingSiteId) {
      return "Selecciona un sitio existente o cambia a crear uno.";
    }
    if (siteMode === "new" && !siteName.trim()) {
      return "El nombre del sitio es obligatorio.";
    }
    if (siteMode === "new") {
      const hasLat = siteLatitude.trim() !== "";
      const hasLon = siteLongitude.trim() !== "";
      if (hasLat !== hasLon) {
        return "Latitud y longitud deben ingresarse juntas.";
      }
      if (hasLat) {
        const lat = Number(siteLatitude);
        const lon = Number(siteLongitude);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
          return "La latitud debe estar entre -90 y 90.";
        }
        if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
          return "La longitud debe estar entre -180 y 180.";
        }
      }
      if (siteGpsAccuracyM.trim() !== "") {
        const acc = Number(siteGpsAccuracyM);
        if (!Number.isFinite(acc) || acc < 0) {
          return "La precisión GPS debe ser un número mayor o igual a cero.";
        }
      }
    }
    if (eventMode === "existing" && !existingEventId) {
      return "Selecciona una jornada existente o cambia a crear una.";
    }
    if (eventMode === "new") {
      if (!effectiveEventName.trim()) {
        return "El nombre de la jornada es obligatorio.";
      }
      if (!eventSampledAt) {
        return "La fecha de la jornada es obligatoria.";
      }
      const date = new Date(eventSampledAt);
      if (Number.isNaN(date.getTime())) {
        return "La fecha de la jornada no es válida.";
      }
    }
    return null;
  };

  const handleSubmit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    setError(null);
    setNotice(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    // Guard against duplicate submissions caused by double click or slow network.
    if (submitting) return;
    setSubmitting(true);

    const draft = mergeDraftWithSelection(readDraft(), {
      projectId: projectMode === "existing" ? existingProjectId : undefined,
      siteId: siteMode === "existing" ? existingSiteId : undefined,
      eventId: eventMode === "existing" ? existingEventId : undefined,
    });

    const result: PrepareDayResult = await preparaJornada({
      project:
        projectMode === "existing"
          ? { mode: "existing", id: existingProjectId! }
          : {
              mode: "new",
              name: projectName.trim(),
              description: projectDescription.trim() || undefined,
            },
      site:
        siteMode === "existing"
          ? { mode: "existing", id: existingSiteId! }
          : {
              mode: "new",
              name: siteName.trim(),
              description: siteDescription.trim() || undefined,
              province: siteProvince.trim() || undefined,
              municipality: siteMunicipality.trim() || undefined,
              latitude: siteLatitude.trim() !== "" ? Number(siteLatitude) : undefined,
              longitude: siteLongitude.trim() !== "" ? Number(siteLongitude) : undefined,
              gpsAccuracyM: siteGpsAccuracyM.trim() !== "" ? Number(siteGpsAccuracyM) : undefined,
              locationSource: siteLatitude.trim() !== "" ? siteLocationSource : "unknown",
              radiusM: siteRadiusM,
              notes: siteNotes.trim() || undefined,
            },
      event:
        eventMode === "existing"
          ? { mode: "existing", id: existingEventId! }
          : {
              mode: "new",
              name: effectiveEventName.trim(),
              sampledAt: localDatetimeLocalToISO(eventSampledAt),
              observerNames: eventObservers.trim() || undefined,
              notes: eventNotes.trim() || undefined,
            },
      draft,
    });

    if (!result.ok) {
      // Persist whatever we did create so the retry does not duplicate rows.
      writeDraft({
        projectId: result.failure.persisted.projectId,
        siteId: result.failure.persisted.siteId,
        eventId: result.failure.persisted.eventId,
      });
      const contextMsg =
        result.failure.step === "project"
          ? "No pudimos guardar el proyecto."
          : result.failure.step === "site"
            ? "El proyecto quedó guardado, pero no se pudo crear el sitio."
            : "Proyecto y sitio quedaron guardados, pero no se pudo crear la jornada.";
      setError(`${contextMsg} ${result.failure.message} Puedes reintentar sin duplicar registros.`);
      setSubmitting(false);
      return;
    }

    // Success — clear the draft and navigate to the jornada.
    writeDraft(null);
    router.push(`/jornada/${result.eventId}`);
  };

  return (
    <div>
      <PageHeader
        title="Preparar jornada"
        subtitle="Proyecto, sitio y jornada en una sola pantalla. Los datos existentes se preservan."
      />

      {loadingProjects ? (
        <div
          className="mb-6 rounded px-4 py-3 text-sm"
          style={{ background: "var(--ld-card)", border: "1px solid var(--ld-border)" }}
        >
          Cargando datos…
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="mb-6 rounded px-4 py-3 text-sm"
          style={{ background: "#FFF7E1", border: "1px solid #E9C46A", color: "#664D03" }}
        >
          {notice}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ---------- Section 1: Project ---------- */}
        <fieldset
          className="p-4 rounded border"
          style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}
        >
          <legend className="px-2 font-semibold" style={{ color: "var(--ld-text)" }}>
            1. Proyecto
          </legend>

          <div className="flex flex-wrap gap-4 mb-4" role="radiogroup" aria-label="Modo de proyecto">
            <label className="text-sm flex items-center gap-2">
              <input
                type="radio"
                name="project-mode"
                value="existing"
                checked={projectMode === "existing"}
                onChange={() => handleProjectMode("existing")}
                disabled={projects.length === 0}
              />
              Usar existente
            </label>
            <label className="text-sm flex items-center gap-2">
              <input
                type="radio"
                name="project-mode"
                value="new"
                checked={projectMode === "new"}
                onChange={() => handleProjectMode("new")}
              />
              Crear uno nuevo
            </label>
          </div>

          {projectMode === "existing" ? (
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="prep-project-select">
                Proyecto
              </label>
              <select
                id="prep-project-select"
                value={existingProjectId ?? ""}
                onChange={(e) => handleSelectExistingProject(e.target.value || undefined)}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              >
                <option value="">Selecciona un proyecto</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="prep-project-name">
                  Nombre del proyecto
                </label>
                <input
                  id="prep-project-name"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  required={projectMode === "new"}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="prep-project-description">
                  Objetivo o descripción (opcional)
                </label>
                <textarea
                  id="prep-project-description"
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                />
              </div>
            </div>
          )}
        </fieldset>

        {/* ---------- Section 2: Site ---------- */}
        <fieldset
          className="p-4 rounded border"
          style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}
          disabled={projectMode === "existing" && !existingProjectId}
        >
          <legend className="px-2 font-semibold" style={{ color: "var(--ld-text)" }}>
            2. Sitio o área
          </legend>

          <div className="flex flex-wrap gap-4 mb-4" role="radiogroup" aria-label="Modo de sitio">
            <label className="text-sm flex items-center gap-2">
              <input
                type="radio"
                name="site-mode"
                value="existing"
                checked={siteMode === "existing"}
                onChange={() => setSiteMode("existing")}
                disabled={sites.length === 0}
              />
              Usar existente
            </label>
            <label className="text-sm flex items-center gap-2">
              <input
                type="radio"
                name="site-mode"
                value="new"
                checked={siteMode === "new"}
                onChange={() => setSiteMode("new")}
              />
              Crear uno nuevo
            </label>
          </div>

          {siteMode === "existing" ? (
            loadingSites ? (
              <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                Cargando sitios…
              </p>
            ) : sites.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                Este proyecto todavía no tiene sitios. Cambia a &quot;Crear uno nuevo&quot;.
              </p>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="prep-site-select">
                  Sitio
                </label>
                <select
                  id="prep-site-select"
                  value={existingSiteId ?? ""}
                  onChange={(e) => handleSelectExistingSite(e.target.value || undefined)}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                >
                  <option value="">Selecciona un sitio</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="prep-site-name">
                  Nombre del sitio
                </label>
                <input
                  id="prep-site-name"
                  type="text"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  required={siteMode === "new"}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-1" htmlFor="prep-site-latitude">
                    Latitud (opcional)
                  </label>
                  <input
                    id="prep-site-latitude"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={siteLatitude}
                    onChange={(e) => {
                      setSiteLatitude(e.target.value);
                      setSiteLocationSource("manual");
                    }}
                    className="w-full px-3 py-2 rounded border"
                    style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" htmlFor="prep-site-longitude">
                    Longitud (opcional)
                  </label>
                  <input
                    id="prep-site-longitude"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={siteLongitude}
                    onChange={(e) => {
                      setSiteLongitude(e.target.value);
                      setSiteLocationSource("manual");
                    }}
                    className="w-full px-3 py-2 rounded border"
                    style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={requestDeviceGps}
                  disabled={gpsBusy}
                  className="px-3 py-2 rounded border text-sm"
                  style={{ background: "#fff", borderColor: "var(--ld-border)", color: "var(--ld-text)" }}
                >
                  {gpsBusy ? "Solicitando permiso…" : "Obtener ubicación del dispositivo"}
                </button>
                <span className="text-xs" style={{ color: "var(--ld-text-secondary)" }}>
                  El GPS del dispositivo solo se lee cuando pulsas este botón. Revisa y corrige antes
                  de guardar; el sitio de muestreo no siempre coincide con el sitio de carga.
                </span>
              </div>
              {gpsMessage ? (
                <p className="text-xs" style={{ color: "var(--ld-text-secondary)" }}>
                  {gpsMessage}
                </p>
              ) : null}

              <details
                open={siteExtraOpen}
                onToggle={(event) => setSiteExtraOpen((event.target as HTMLDetailsElement).open)}
                className="rounded border"
                style={{ borderColor: "var(--ld-border)" }}
              >
                <summary className="cursor-pointer px-3 py-2 text-sm">Más detalles del sitio</summary>
                <div className="space-y-3 p-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium mb-1" htmlFor="prep-site-province">
                        Provincia (opcional)
                      </label>
                      <input
                        id="prep-site-province"
                        type="text"
                        value={siteProvince}
                        onChange={(e) => setSiteProvince(e.target.value)}
                        className="w-full px-3 py-2 rounded border"
                        style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1" htmlFor="prep-site-municipality">
                        Municipio (opcional)
                      </label>
                      <input
                        id="prep-site-municipality"
                        type="text"
                        value={siteMunicipality}
                        onChange={(e) => setSiteMunicipality(e.target.value)}
                        className="w-full px-3 py-2 rounded border"
                        style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium mb-1" htmlFor="prep-site-gps-accuracy">
                        Precisión GPS (m) opcional
                      </label>
                      <input
                        id="prep-site-gps-accuracy"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.1"
                        value={siteGpsAccuracyM}
                        onChange={(e) => setSiteGpsAccuracyM(e.target.value)}
                        className="w-full px-3 py-2 rounded border"
                        style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1" htmlFor="prep-site-radius">
                        Radio de análisis
                      </label>
                      <select
                        id="prep-site-radius"
                        value={siteRadiusM}
                        onChange={(e) => setSiteRadiusM(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded border"
                        style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                      >
                        <option value={50}>50 m</option>
                        <option value={100}>100 m</option>
                        <option value={250}>250 m</option>
                        <option value={500}>500 m</option>
                        <option value={1000}>1 km</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" htmlFor="prep-site-description">
                      Descripción (opcional)
                    </label>
                    <textarea
                      id="prep-site-description"
                      value={siteDescription}
                      onChange={(e) => setSiteDescription(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 rounded border"
                      style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" htmlFor="prep-site-notes">
                      Notas (opcional)
                    </label>
                    <textarea
                      id="prep-site-notes"
                      value={siteNotes}
                      onChange={(e) => setSiteNotes(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 rounded border"
                      style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                    />
                  </div>
                </div>
              </details>
            </div>
          )}
        </fieldset>

        {/* ---------- Section 3: Sampling event ---------- */}
        <fieldset
          className="p-4 rounded border"
          style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}
          disabled={siteMode === "existing" && !existingSiteId}
        >
          <legend className="px-2 font-semibold" style={{ color: "var(--ld-text)" }}>
            3. Jornada
          </legend>

          <div className="flex flex-wrap gap-4 mb-4" role="radiogroup" aria-label="Modo de jornada">
            <label className="text-sm flex items-center gap-2">
              <input
                type="radio"
                name="event-mode"
                value="existing"
                checked={eventMode === "existing"}
                onChange={() => setEventMode("existing")}
                disabled={events.length === 0}
              />
              Usar existente
            </label>
            <label className="text-sm flex items-center gap-2">
              <input
                type="radio"
                name="event-mode"
                value="new"
                checked={eventMode === "new"}
                onChange={() => setEventMode("new")}
              />
              Crear una nueva
            </label>
          </div>

          {eventMode === "existing" ? (
            loadingEvents ? (
              <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                Cargando jornadas…
              </p>
            ) : events.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                Este sitio todavía no tiene jornadas. Cambia a &quot;Crear una nueva&quot;.
              </p>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="prep-event-select">
                  Jornada
                </label>
                <select
                  id="prep-event-select"
                  value={existingEventId ?? ""}
                  onChange={(e) => setExistingEventId(e.target.value || undefined)}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                >
                  <option value="">Selecciona una jornada</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name} ({formatLocalDate(new Date(ev.sampledAt))})
                    </option>
                  ))}
                </select>
              </div>
            )
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="prep-event-sampled-at">
                  Fecha de la jornada
                </label>
                <input
                  id="prep-event-sampled-at"
                  type="datetime-local"
                  value={eventSampledAt}
                  onChange={(e) => setEventSampledAt(e.target.value)}
                  required={eventMode === "new"}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="prep-event-name">
                  Nombre de la jornada
                </label>
                <input
                  id="prep-event-name"
                  type="text"
                  value={effectiveEventName}
                  onChange={(e) => setEventNameOverride(e.target.value)}
                  required={eventMode === "new"}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                />
                <p className="text-xs mt-1" style={{ color: "var(--ld-text-secondary)" }}>
                  Sugerencia automática con base en la fecha. Puedes editarla.
                </p>
              </div>

              <details
                open={eventExtraOpen}
                onToggle={(event) => setEventExtraOpen((event.target as HTMLDetailsElement).open)}
                className="rounded border"
                style={{ borderColor: "var(--ld-border)" }}
              >
                <summary className="cursor-pointer px-3 py-2 text-sm">
                  Más detalles de la jornada
                </summary>
                <div className="space-y-3 p-3">
                  <div>
                    <label className="block text-sm font-medium mb-1" htmlFor="prep-event-observers">
                      Responsable o observadores (opcional)
                    </label>
                    <input
                      id="prep-event-observers"
                      type="text"
                      value={eventObservers}
                      onChange={(e) => setEventObservers(e.target.value)}
                      className="w-full px-3 py-2 rounded border"
                      style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" htmlFor="prep-event-notes">
                      Notas (opcional)
                    </label>
                    <textarea
                      id="prep-event-notes"
                      value={eventNotes}
                      onChange={(e) => setEventNotes(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 rounded border"
                      style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                    />
                  </div>
                </div>
              </details>
            </div>
          )}
        </fieldset>

        {error ? (
          <div
            role="alert"
            className="rounded px-4 py-3 text-sm"
            style={{ background: "#F9DAD6", color: "#842029", border: "1px solid #F5C2C7" }}
          >
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submitting || loadingProjects}
            className="px-5 py-3 rounded border font-medium"
            style={{
              background: "var(--ld-sand)",
              color: "var(--ld-text)",
              borderColor: "var(--ld-border)",
            }}
          >
            {submitting ? "Guardando…" : "Guardar y comenzar con los árboles"}
          </button>
          <Link href="/" className="text-sm underline" style={{ color: "var(--ld-primary)" }}>
            Volver al panel
          </Link>
        </div>
      </form>
    </div>
  );
}

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
  datetimeLocalToIsoString,
  formatLocalDate,
  formatLocalDatetimeInputValue,
  mergeDraftWithSelection,
  narrowDraftScope,
  resetIncompatibleSelections,
  suggestSamplingEventName,
} from "./logic";

type Mode = "existing" | "new";

// Session storage key for the whole draft. It groups two independent things:
//   - "persisted": identifiers that WERE actually created in a previous
//     partial-failure attempt (used to prevent duplicate rows on retry).
//   - "form": the current form field values so the user does not lose their
//     typing if they refresh, navigate away, or hit "back". These are cleared
//     on successful submit and via an explicit "Descartar borrador" action.
const DRAFT_STORAGE_KEY = "lichendr:prepare-day:draft";

interface PersistedIds {
  projectId?: string;
  siteId?: string;
  eventId?: string;
}

interface FormDraft {
  projectMode?: Mode;
  siteMode?: Mode;
  eventMode?: Mode;
  existingProjectId?: string;
  existingSiteId?: string;
  existingEventId?: string;
  projectName?: string;
  projectDescription?: string;
  siteName?: string;
  siteDescription?: string;
  siteProvince?: string;
  siteMunicipality?: string;
  siteLatitude?: string;
  siteLongitude?: string;
  siteGpsAccuracyM?: string;
  siteNotes?: string;
  siteRadiusM?: number;
  siteLocationSource?: "manual" | "gps" | "unknown";
  eventSampledAt?: string;
  eventNameOverride?: string | null;
  eventObservers?: string;
  eventNotes?: string;
}

interface StoredDraft {
  persisted?: PersistedIds;
  form?: FormDraft;
}

function readDraft(): StoredDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as StoredDraft;
    if (typeof parsed !== "object" || parsed === null) return null;
    // Also tolerate legacy shape where the entire object was the persisted ids.
    if ("persisted" in parsed || "form" in parsed) {
      return parsed;
    }
    return { persisted: parsed as PersistedIds };
  } catch {
    return null;
  }
}

function writeDraft(next: StoredDraft | null) {
  if (typeof window === "undefined") return;
  try {
    if (!next || (!next.persisted && !next.form)) {
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // sessionStorage may be unavailable (private mode, quota). We degrade
    // gracefully — the flow still works, only partial-failure recovery is lost.
  }
}

// Merge the current draft with a mutation of the persisted ids or the form.
function mutateDraft(mutation: (prev: StoredDraft) => StoredDraft) {
  const prev = readDraft() ?? {};
  writeDraft(mutation(prev));
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
  const [eventSampledAt, setEventSampledAt] = useState<string>(() => formatLocalDatetimeInputValue(new Date()));
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
  // True once mount hydration has finished; used to gate the form-field auto
  // save effect so we do not overwrite a persisted draft with the initial
  // (empty) state before the mount effect had a chance to restore it.
  const [hydrated, setHydrated] = useState(false);
  // Whether we started this session from a stored draft (persisted ids OR
  // form fields). Only used to reveal the "Descartar borrador" affordance
  // before the user has typed anything themselves. After the user has typed
  // ANY input (a non-default value below), the button also becomes visible
  // via the memo, so this state does not need to react to typing.
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);

  // Load projects at mount. Restore the persisted draft (both partial-failure
  // identifiers and the in-progress form fields the user was typing).
  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingProjects(true);
      const draft = readDraft();
      const persisted = draft?.persisted ?? {};
      const form = draft?.form ?? {};
      const { projects: rows, error: err } = await fetchProjects();
      if (!active) return;
      if (err) setError(err);
      setProjects(rows);

      // Restore persisted (partial-failure) identifiers first so downstream
      // effects see the right values on their first run.
      if (persisted.projectId && rows.some((row) => row.id === persisted.projectId)) {
        setProjectMode("existing");
        setExistingProjectId(persisted.projectId);
      }
      if (persisted.siteId) {
        setSiteMode("existing");
        setExistingSiteId(persisted.siteId);
      }
      if (persisted.eventId) {
        setEventMode("existing");
        setExistingEventId(persisted.eventId);
      }

      // Then restore any form fields the user had typed but not yet saved.
      // Persisted identifiers take precedence over form values.
      if (form.projectMode && !persisted.projectId) setProjectMode(form.projectMode);
      if (form.siteMode && !persisted.siteId) setSiteMode(form.siteMode);
      if (form.eventMode && !persisted.eventId) setEventMode(form.eventMode);
      if (form.existingProjectId && !persisted.projectId
          && rows.some((row) => row.id === form.existingProjectId)) {
        setExistingProjectId(form.existingProjectId);
      }
      if (form.existingSiteId && !persisted.siteId) setExistingSiteId(form.existingSiteId);
      if (form.existingEventId && !persisted.eventId) setExistingEventId(form.existingEventId);
      if (typeof form.projectName === "string") setProjectName(form.projectName);
      if (typeof form.projectDescription === "string") setProjectDescription(form.projectDescription);
      if (typeof form.siteName === "string") setSiteName(form.siteName);
      if (typeof form.siteDescription === "string") setSiteDescription(form.siteDescription);
      if (typeof form.siteProvince === "string") setSiteProvince(form.siteProvince);
      if (typeof form.siteMunicipality === "string") setSiteMunicipality(form.siteMunicipality);
      if (typeof form.siteLatitude === "string") setSiteLatitude(form.siteLatitude);
      if (typeof form.siteLongitude === "string") setSiteLongitude(form.siteLongitude);
      if (typeof form.siteGpsAccuracyM === "string") setSiteGpsAccuracyM(form.siteGpsAccuracyM);
      if (typeof form.siteNotes === "string") setSiteNotes(form.siteNotes);
      if (typeof form.siteRadiusM === "number") setSiteRadiusM(form.siteRadiusM);
      if (form.siteLocationSource === "manual" || form.siteLocationSource === "gps"
          || form.siteLocationSource === "unknown") {
        setSiteLocationSource(form.siteLocationSource);
      }
      if (typeof form.eventSampledAt === "string") setEventSampledAt(form.eventSampledAt);
      if (form.eventNameOverride === null || typeof form.eventNameOverride === "string") {
        setEventNameOverride(form.eventNameOverride);
      }
      if (typeof form.eventObservers === "string") setEventObservers(form.eventObservers);
      if (typeof form.eventNotes === "string") setEventNotes(form.eventNotes);

      const hasPersisted = !!(persisted.projectId || persisted.siteId || persisted.eventId);
      const hasFormData = !!(
        form.projectName || form.siteName || form.eventObservers || form.eventNotes
        || form.siteNotes || form.siteDescription
      );
      setRestoredFromDraft(hasPersisted || hasFormData);
      if (hasPersisted) {
        setNotice(
          "Retomamos tu selección anterior. Puedes continuar sin recrear proyecto, sitio ni jornada.",
        );
      } else if (hasFormData) {
        setNotice(
          "Recuperamos los campos que habías escrito. Puedes seguir editando o descartar el borrador.",
        );
      }
      setLoadingProjects(false);
      setHydrated(true);
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

  // Auto-save form fields to sessionStorage as the user types. This keeps
  // partially-typed data across page refreshes, "back" navigation, and browser
  // crashes — which was one of the QA feedback items ("hoy se pierden").
  useEffect(() => {
    if (!hydrated) return;
    mutateDraft((prev) => ({
      persisted: prev.persisted,
      form: {
        projectMode,
        siteMode,
        eventMode,
        existingProjectId,
        existingSiteId,
        existingEventId,
        projectName,
        projectDescription,
        siteName,
        siteDescription,
        siteProvince,
        siteMunicipality,
        siteLatitude,
        siteLongitude,
        siteGpsAccuracyM,
        siteNotes,
        siteRadiusM,
        siteLocationSource,
        eventSampledAt,
        eventNameOverride,
        eventObservers,
        eventNotes,
      },
    }));
  }, [
    hydrated,
    projectMode,
    siteMode,
    eventMode,
    existingProjectId,
    existingSiteId,
    existingEventId,
    projectName,
    projectDescription,
    siteName,
    siteDescription,
    siteProvince,
    siteMunicipality,
    siteLatitude,
    siteLongitude,
    siteGpsAccuracyM,
    siteNotes,
    siteRadiusM,
    siteLocationSource,
    eventSampledAt,
    eventNameOverride,
    eventObservers,
    eventNotes,
  ]);

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
      // Any previously-persisted identifiers (project + descendants) belonged
      // to a different intent. Discard them so preparaJornada does not reuse
      // them silently — the user asked for a fresh project.
      mutateDraft((prev) => ({
        persisted: prev.persisted
          ? (narrowDraftScope(prev.persisted, "drop_all") ?? undefined)
          : undefined,
        form: prev.form,
      }));
      setExistingProjectId(undefined);
      setSites([]);
      setEvents([]);
      setSiteMode("new");
      setEventMode("new");
      setExistingSiteId(undefined);
      setExistingEventId(undefined);
    }
  };

  const handleSiteMode = (mode: Mode) => {
    setSiteMode(mode);
    setError(null);
    if (mode === "new") {
      // Site + event persisted identifiers belong to the previous site, so we
      // drop them but keep the project part of the draft.
      mutateDraft((prev) => ({
        persisted: prev.persisted
          ? (narrowDraftScope(prev.persisted, "drop_below_project") ?? undefined)
          : undefined,
        form: prev.form,
      }));
      setExistingSiteId(undefined);
      setEvents([]);
      setEventMode("new");
      setExistingEventId(undefined);
    }
  };

  const handleEventMode = (mode: Mode) => {
    setEventMode(mode);
    setError(null);
    if (mode === "new") {
      mutateDraft((prev) => ({
        persisted: prev.persisted
          ? (narrowDraftScope(prev.persisted, "drop_below_site") ?? undefined)
          : undefined,
        form: prev.form,
      }));
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
    // If the user picks a project different from the persisted one, drop the
    // persisted site + event — they belong to the previous project and would
    // reappear via mergeDraftWithSelection otherwise.
    mutateDraft((prev) => {
      const persisted = prev.persisted;
      if (!persisted?.projectId || persisted.projectId === id) return prev;
      const narrowed = narrowDraftScope({ ...persisted, projectId: id }, "drop_below_project");
      return { persisted: narrowed ?? undefined, form: prev.form };
    });
  };

  const handleSelectExistingSite = (id: string | undefined) => {
    const next = resetIncompatibleSelections(
      { projectId: existingProjectId, siteId: existingSiteId, eventId: existingEventId },
      "site",
      id,
    );
    setExistingSiteId(next.siteId);
    setExistingEventId(next.eventId);
    // Drop persisted event if the site the user chose differs from the persisted one.
    mutateDraft((prev) => {
      const persisted = prev.persisted;
      if (!persisted?.siteId || persisted.siteId === id) return prev;
      const narrowed = narrowDraftScope(
        { ...persisted, siteId: id },
        "drop_below_site",
      );
      return { persisted: narrowed ?? undefined, form: prev.form };
    });
  };

  // Explicit "Descartar borrador" affordance. Clears both persisted ids and
  // the form fields so the user can start over without leftover state.
  const handleDiscardDraft = () => {
    writeDraft(null);
    setProjectMode("new");
    setSiteMode("new");
    setEventMode("new");
    setExistingProjectId(undefined);
    setExistingSiteId(undefined);
    setExistingEventId(undefined);
    setProjectName("");
    setProjectDescription("");
    setSiteName("");
    setSiteDescription("");
    setSiteProvince("");
    setSiteMunicipality("");
    setSiteLatitude("");
    setSiteLongitude("");
    setSiteGpsAccuracyM("");
    setSiteNotes("");
    setSiteRadiusM(100);
    setSiteLocationSource("manual");
    setSites([]);
    setEvents([]);
    setEventSampledAt(formatLocalDatetimeInputValue(new Date()));
    setEventNameOverride(null);
    setEventObservers("");
    setEventNotes("");
    setError(null);
    setNotice(null);
    setRestoredFromDraft(false);
  };

  // Reveal the "Descartar borrador" button whenever there is anything the
  // user might want to explicitly discard: a persisted-from-partial-failure
  // draft, or ANY typed content. Computing this from state (instead of a
  // useEffect+setState) avoids the react-hooks/set-state-in-effect lint.
  const hasDraft = useMemo(() => {
    if (restoredFromDraft) return true;
    if (existingProjectId || existingSiteId || existingEventId) return true;
    if (
      projectName.trim() ||
      projectDescription.trim() ||
      siteName.trim() ||
      siteDescription.trim() ||
      siteProvince.trim() ||
      siteMunicipality.trim() ||
      siteLatitude.trim() ||
      siteLongitude.trim() ||
      siteGpsAccuracyM.trim() ||
      siteNotes.trim() ||
      eventObservers.trim() ||
      eventNotes.trim() ||
      eventNameOverride !== null
    ) {
      return true;
    }
    return false;
  }, [
    restoredFromDraft,
    existingProjectId,
    existingSiteId,
    existingEventId,
    projectName,
    projectDescription,
    siteName,
    siteDescription,
    siteProvince,
    siteMunicipality,
    siteLatitude,
    siteLongitude,
    siteGpsAccuracyM,
    siteNotes,
    eventObservers,
    eventNotes,
    eventNameOverride,
  ]);

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

    const currentSelection = {
      projectId: projectMode === "existing" ? existingProjectId : undefined,
      siteId: siteMode === "existing" ? existingSiteId : undefined,
      eventId: eventMode === "existing" ? existingEventId : undefined,
    };
    const storedDraft = readDraft();
    const draft = mergeDraftWithSelection(storedDraft?.persisted ?? null, currentSelection);

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
              sampledAt: datetimeLocalToIsoString(eventSampledAt),
              observerNames: eventObservers.trim() || undefined,
              notes: eventNotes.trim() || undefined,
            },
      draft,
    });

    if (!result.ok) {
      // Persist whatever we did create so the retry does not duplicate rows.
      // Keep the form fields around so the user can edit and retry.
      const previousForm = readDraft()?.form;
      writeDraft({
        persisted: {
          projectId: result.failure.persisted.projectId,
          siteId: result.failure.persisted.siteId,
          eventId: result.failure.persisted.eventId,
        },
        form: previousForm,
      });
      setRestoredFromDraft(true);
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
    setRestoredFromDraft(false);
    router.push(`/jornada/${result.eventId}`);
  };

  return (
    <div>
      <PageHeader
        title="Preparar jornada"
        subtitle="Elige o crea el proyecto, define el sitio y prepara la jornada. Después podrás registrar los árboles."
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
                onChange={() => handleSiteMode("existing")}
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
                onChange={() => handleSiteMode("new")}
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
                onChange={() => handleEventMode("existing")}
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
                onChange={() => handleEventMode("new")}
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
          {hasDraft ? (
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="px-3 py-2 rounded border text-sm"
              style={{
                background: "var(--ld-card)",
                color: "var(--ld-text)",
                borderColor: "var(--ld-border)",
              }}
              aria-label="Descartar borrador y empezar en blanco"
            >
              Descartar borrador
            </button>
          ) : null}
          <Link href="/" className="text-sm underline" style={{ color: "var(--ld-primary)" }}>
            Volver al panel
          </Link>
        </div>
      </form>
    </div>
  );
}

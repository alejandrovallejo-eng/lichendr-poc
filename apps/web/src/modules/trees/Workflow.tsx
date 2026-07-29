"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import type { Project, Site, SamplingEvent, Tree, TreeSample } from "@/types/domain";
import { fetchProjects } from "@/modules/projects/client";
import { fetchSitesByProject } from "@/modules/sites/client";
import { fetchSamplingEventsBySite } from "@/modules/sampling-events/client";
import {
  fetchTreesBySite,
  createTree,
  fetchTreeSamplesByEvent,
  createTreeSample,
  enrichTreeSamplesWithTree,
} from "@/modules/trees/client";

const speciesConfidenceOptions = [
  { value: "unknown", label: "Desconocida" },
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
] as const;

const substrateOptions = [
  { value: "tree_bark", label: "Corteza de árbol" },
  { value: "dead_wood", label: "Madera muerta" },
  { value: "rock", label: "Roca" },
  { value: "soil", label: "Suelo" },
  { value: "concrete", label: "Concreto" },
  { value: "other", label: "Otro" },
  { value: "unknown", label: "Desconocido" },
] as const;

const orientationOptions = [
  { value: "N", label: "N" },
  { value: "NE", label: "NE" },
  { value: "E", label: "E" },
  { value: "SE", label: "SE" },
  { value: "S", label: "S" },
  { value: "SW", label: "SW" },
  { value: "W", label: "W" },
  { value: "NW", label: "NW" },
  { value: "multiple", label: "Múltiples" },
  { value: "unknown", label: "Desconocida" },
] as const;

const shadeOptions = [
  { value: "unknown", label: "Desconocido" },
  { value: "low", label: "Bajo" },
  { value: "medium", label: "Medio" },
  { value: "high", label: "Alto" },
] as const;

const confidenceOptions = [
  { value: "unknown", label: "Desconocida" },
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
] as const;

const treeModeOptions = [
  { value: "new", label: "Registrar un árbol nuevo" },
  { value: "existing", label: "Seleccionar un árbol existente" },
] as const;

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

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function TreeWorkflow() {
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("projectId") ?? undefined;
  const querySiteId = searchParams.get("siteId") ?? undefined;
  const queryEventId = searchParams.get("eventId") ?? undefined;

  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [samplingEvents, setSamplingEvents] = useState<SamplingEvent[]>([]);
  const [trees, setTrees] = useState<Tree[]>([]);
  const [treeSamples, setTreeSamples] = useState<TreeSample[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(undefined);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(undefined);

  const [mode, setMode] = useState<"new" | "existing">("new");
  const [selectedExistingTreeId, setSelectedExistingTreeId] = useState<string | undefined>(undefined);
  const [code, setCode] = useState("");
  const [speciesName, setSpeciesName] = useState("");
  const [speciesConfidence, setSpeciesConfidence] = useState<(typeof speciesConfidenceOptions)[number]["value"]>("unknown");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [gpsAccuracyM, setGpsAccuracyM] = useState("");
  const [treeNotes, setTreeNotes] = useState("");
  const [substrateType, setSubstrateType] = useState<(typeof substrateOptions)[number]["value"]>("tree_bark");
  const [trunkOrientation, setTrunkOrientation] = useState<(typeof orientationOptions)[number]["value"]>("unknown");
  const [samplingHeightM, setSamplingHeightM] = useState("");
  const [shadeLevel, setShadeLevel] = useState<(typeof shadeOptions)[number]["value"]>("unknown");
  const [confidenceLevel, setConfidenceLevel] = useState<(typeof confidenceOptions)[number]["value"]>("unknown");
  const [sampleNotes, setSampleNotes] = useState("");

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const sampledTreeIds = useMemo(() => new Set(treeSamples.map((sample) => sample.treeId)), [treeSamples]);

  const availableExistingTrees = useMemo(
    () => trees.filter((tree) => !sampledTreeIds.has(tree.id)),
    [trees, sampledTreeIds]
  );

  const alreadySampledTrees = useMemo(
    () => trees.filter((tree) => sampledTreeIds.has(tree.id)),
    [trees, sampledTreeIds]
  );

  const sampledTreeDetails = useMemo(() => enrichTreeSamplesWithTree(treeSamples, trees), [treeSamples, trees]);

  useEffect(() => {
    let active = true;

    async function loadProjects() {
      setLoadingProjects(true);
      setError(null);

      const { projects: loadedProjects, error: projectsError } = await fetchProjects();
      if (!active) {
        return;
      }

      if (projectsError) {
        setError(projectsError);
        setProjects([]);
        setSelectedProjectId(undefined);
        setLoadingProjects(false);
        return;
      }

      setProjects(loadedProjects);
      const nextProjectId =
        queryProjectId && loadedProjects.some((project) => project.id === queryProjectId)
          ? queryProjectId
          : loadedProjects[0]?.id;

      setSelectedProjectId(nextProjectId);
      setLoadingProjects(false);
    }

    loadProjects();

    return () => {
      active = false;
    };
  }, [queryProjectId]);

  useEffect(() => {
    let active = true;

    async function loadSites() {
      if (!selectedProjectId) {
        setSites([]);
        setSelectedSiteId(undefined);
        return;
      }

      setLoadingSites(true);
      setError(null);

      const { sites: loadedSites, error: sitesError } = await fetchSitesByProject(selectedProjectId);
      if (!active) {
        return;
      }

      if (sitesError) {
        setError(sitesError);
        setSites([]);
        setSelectedSiteId(undefined);
        setLoadingSites(false);
        return;
      }

      setSites(loadedSites);
      const nextSiteId =
        querySiteId && loadedSites.some((site) => site.id === querySiteId)
          ? querySiteId
          : loadedSites[0]?.id;

      setSelectedSiteId(nextSiteId);
      setLoadingSites(false);
    }

    loadSites();

    return () => {
      active = false;
    };
  }, [querySiteId, selectedProjectId]);

  useEffect(() => {
    let active = true;

    async function loadEventRelatedData() {
      if (!selectedSiteId) {
        setSamplingEvents([]);
        setTrees([]);
        setSelectedEventId(undefined);
        setTreeSamples([]);
        return;
      }

      setLoadingEvents(true);
      setLoadingSamples(true);
      setError(null);

      const [eventsResult, treesResult] = await Promise.all([
        fetchSamplingEventsBySite(selectedSiteId),
        fetchTreesBySite(selectedSiteId),
      ]);

      if (!active) {
        return;
      }

      if (eventsResult.error) {
        setError(eventsResult.error);
        setSamplingEvents([]);
      } else {
        setSamplingEvents(eventsResult.samplingEvents);
      }

      if (treesResult.error) {
        setError(treesResult.error);
        setTrees([]);
      } else {
        setTrees(treesResult.trees);
      }

      const nextEventId =
        queryEventId && eventsResult.samplingEvents.some((event) => event.id === queryEventId)
          ? queryEventId
          : eventsResult.samplingEvents[0]?.id;

      setSelectedEventId(nextEventId);
      setLoadingEvents(false);
      setLoadingSamples(false);
    }

    loadEventRelatedData();

    return () => {
      active = false;
    };
  }, [queryEventId, selectedSiteId]);

  useEffect(() => {
    let active = true;

    async function loadTreeSamples() {
      if (!selectedEventId) {
        setTreeSamples([]);
        return;
      }

      setLoadingSamples(true);
      setError(null);

      const { treeSamples: loadedSamples, error: samplesError } = await fetchTreeSamplesByEvent(selectedEventId);
      if (!active) {
        return;
      }

      if (samplesError) {
        setError(samplesError);
        setTreeSamples([]);
      } else {
        setTreeSamples(loadedSamples);
      }
      setLoadingSamples(false);
    }

    loadTreeSamples();

    return () => {
      active = false;
    };
  }, [selectedEventId]);

  const validateTreeForm = () => {
    if (!selectedProjectId) {
      return "Selecciona un proyecto.";
    }

    if (!selectedSiteId) {
      return "Selecciona un sitio.";
    }

    if (!selectedEventId) {
      return "Selecciona una jornada.";
    }

    if (mode === "new") {
      if (!code.trim()) {
        return "El código del árbol es obligatorio.";
      }

      if (code.trim().length > 80) {
        return "El código no puede tener más de 80 caracteres.";
      }

      const hasLatitude = latitude.trim() !== "";
      const hasLongitude = longitude.trim() !== "";
      if (hasLatitude !== hasLongitude) {
        return "Latitud y longitud deben ingresarse juntas.";
      }

      const parsedLatitude = parseNumber(latitude);
      const parsedLongitude = parseNumber(longitude);
      const parsedGpsAccuracy = parseNumber(gpsAccuracyM);

      if (hasLatitude && parsedLatitude == null) {
        return "La latitud debe ser un número válido.";
      }
      if (hasLongitude && parsedLongitude == null) {
        return "La longitud debe ser un número válido.";
      }
      if (parsedLatitude != null && (parsedLatitude < -90 || parsedLatitude > 90)) {
        return "La latitud debe estar entre -90 y 90.";
      }
      if (parsedLongitude != null && (parsedLongitude < -180 || parsedLongitude > 180)) {
        return "La longitud debe estar entre -180 y 180.";
      }
      if (parsedGpsAccuracy != null && parsedGpsAccuracy < 0) {
        return "La precisión GPS debe ser mayor o igual a cero.";
      }
    }

    if (mode === "existing" && !selectedExistingTreeId) {
      return "Selecciona un árbol existente.";
    }

    const parsedSamplingHeight = parseNumber(samplingHeightM);
    if (samplingHeightM !== "" && parsedSamplingHeight != null && parsedSamplingHeight < 0) {
      return "La altura de muestreo no puede ser negativa.";
    }

    return null;
  };

  const resetTreeForm = () => {
    setSelectedExistingTreeId(undefined);
    setCode("");
    setSpeciesName("");
    setSpeciesConfidence("unknown");
    setLatitude("");
    setLongitude("");
    setGpsAccuracyM("");
    setTreeNotes("");
    setSubstrateType("tree_bark");
    setTrunkOrientation("unknown");
    setSamplingHeightM("");
    setShadeLevel("unknown");
    setConfidenceLevel("unknown");
    setSampleNotes("");
  };

  const refreshTreeSamples = async (eventId: string) => {
    const { treeSamples: refreshedSamples } = await fetchTreeSamplesByEvent(eventId);
    setTreeSamples(refreshedSamples);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatusMessage(null);

    const validationError = validateTreeForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!selectedSiteId || !selectedEventId) {
      setError("Proyecto, sitio y jornada son obligatorios.");
      return;
    }

    setSaving(true);

    let treeId: string | null = null;

    if (mode === "existing") {
      treeId = selectedExistingTreeId ?? null;
    } else {
      const parsedLatitude = parseNumber(latitude);
      const parsedLongitude = parseNumber(longitude);
      const parsedGpsAccuracy = parseNumber(gpsAccuracyM);
      const locationSource = parsedLatitude != null && parsedLongitude != null ? "manual" : "unknown";

      const { tree, error: createTreeError } = await createTree({
        siteId: selectedSiteId,
        code: code.trim(),
        speciesName: speciesName.trim() || undefined,
        speciesConfidence,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        gpsAccuracyM: parsedGpsAccuracy,
        locationSource,
        notes: treeNotes.trim() || undefined,
      });

      if (createTreeError || !tree) {
        setSaving(false);
        const message = createTreeError?.toLowerCase() ?? "";
        if (message.includes("unique") || message.includes("duplicate")) {
          setError("Ya existe un árbol con ese código en este sitio.");
        } else {
          setError("No se pudo registrar el árbol. Intenta de nuevo.");
        }
        return;
      }

      treeId = tree.id;
      setTrees((current) => [tree, ...current]);
    }

    if (!treeId) {
      setSaving(false);
      setError("No se pudo identificar el árbol seleccionado.");
      return;
    }

    const { treeSample, error: sampleError } = await createTreeSample({
      siteId: selectedSiteId,
      samplingEventId: selectedEventId,
      treeId,
      substrateType,
      trunkOrientation,
      samplingHeightM: parseNumber(samplingHeightM),
      shadeLevel,
      confidenceLevel,
      notes: sampleNotes.trim() || undefined,
    });

    if (sampleError || !treeSample) {
      const message = (sampleError ?? "").toLowerCase();
      if (mode === "new") {
        setMode("existing");
        setSelectedExistingTreeId(treeId);
        if (message.includes("unique") || message.includes("duplicate")) {
          setError("Este árbol ya está registrado en la jornada seleccionada.");
        } else {
          setError("El árbol fue registrado, pero no pudo añadirse a la jornada. Puedes volver a intentarlo con el mismo árbol.");
        }
      } else if (message.includes("unique") || message.includes("duplicate")) {
        setError("Este árbol ya está registrado en la jornada seleccionada.");
      } else {
        setError("No se pudo guardar el muestreo del árbol. Intenta de nuevo.");
      }

      setSaving(false);
      if (mode === "new") {
        const { trees: refreshedTrees } = await fetchTreesBySite(selectedSiteId);
        setTrees(refreshedTrees);
      }
      return;
    }

    await refreshTreeSamples(selectedEventId);
    resetTreeForm();
    setStatusMessage("Árbol guardado en la jornada correctamente.");
    setSaving(false);
  };

  return (
    <div>
      <PageHeader title="Árboles" subtitle="Registra árboles y añade muestreos dentro de una jornada." />

      <section className="mb-6" style={{ color: "var(--ld-text-secondary)" }}>
        <p className="text-sm">Selecciona proyecto, sitio y jornada para registrar o vincular un árbol a la jornada.</p>
      </section>

      <section className="mb-6 p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="project-select">
              Proyecto
            </label>
            <select
              id="project-select"
              value={selectedProjectId ?? ""}
              onChange={(event) => {
                setSelectedProjectId(event.target.value || undefined);
                setSelectedSiteId(undefined);
                setSelectedEventId(undefined);
              }}
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
              onChange={(event) => {
                setSelectedSiteId(event.target.value || undefined);
                setSelectedEventId(undefined);
              }}
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

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="event-select">
              Jornada de muestreo
            </label>
            <select
              id="event-select"
              value={selectedEventId ?? ""}
              onChange={(event) => setSelectedEventId(event.target.value || undefined)}
              disabled={samplingEvents.length === 0}
              className="w-full px-3 py-2 rounded border"
              style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
            >
              <option value="">Selecciona una jornada</option>
              {samplingEvents.map((event) => (
                <option key={event.id} value={event.id}>{event.name}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {loadingProjects || loadingSites || loadingEvents || loadingSamples ? (
        <div className="mb-6 rounded px-4 py-3" style={{ background: "var(--ld-card)", border: "1px solid var(--ld-border)", color: "var(--ld-text-secondary)" }}>
          Cargando datos...
        </div>
      ) : null}

      {!loadingProjects && projects.length === 0 ? (
        <div className="mb-6 rounded px-4 py-3" style={{ background: "var(--ld-card)", border: "1px solid var(--ld-border)" }}>
          <p>Primero debes crear un proyecto.</p>
          <a href="/projects" className="text-sm font-medium" style={{ color: "var(--ld-primary)" }}>
            Ir a proyectos
          </a>
        </div>
      ) : null}

      {!loadingSites && selectedProjectId && sites.length === 0 ? (
        <div className="mb-6 rounded px-4 py-3" style={{ background: "var(--ld-card)", border: "1px solid var(--ld-border)" }}>
          <p>Este proyecto todavía no tiene sitios.</p>
          <a href="/sites" className="text-sm font-medium" style={{ color: "var(--ld-primary)" }}>
            Ir a sitios
          </a>
        </div>
      ) : null}

      {!loadingEvents && selectedSiteId && samplingEvents.length === 0 ? (
        <div className="mb-6 rounded px-4 py-3" style={{ background: "var(--ld-card)", border: "1px solid var(--ld-border)" }}>
          <p>Este sitio todavía no tiene jornadas de muestreo.</p>
          <a href="/sampling-events" className="text-sm font-medium" style={{ color: "var(--ld-primary)" }}>
            Ir a jornadas
          </a>
        </div>
      ) : null}

      {selectedProjectId && selectedSiteId && selectedEventId ? (
        <section className="mb-6 p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h2 className="font-semibold mb-4" style={{ color: "var(--ld-text)" }}>Registrar árbol en la jornada</h2>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="tree-mode">
                Tipo de registro
              </label>
              <select
                id="tree-mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as "new" | "existing")}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              >
                {treeModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {mode === "existing" ? (
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="existing-tree">
                  Árbol existente
                </label>
                <select
                  id="existing-tree"
                  value={selectedExistingTreeId ?? ""}
                  onChange={(event) => setSelectedExistingTreeId(event.target.value || undefined)}
                  disabled={availableExistingTrees.length === 0}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                >
                  <option value="">Selecciona un árbol</option>
                  {availableExistingTrees.map((tree) => (
                    <option key={tree.id} value={tree.id}>
                      {tree.code} {tree.speciesName ? `· ${tree.speciesName}` : "· No identificada"}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          {alreadySampledTrees.length > 0 ? (
            <div className="mt-4 rounded border p-4" style={{ background: "#f8f9fa", borderColor: "var(--ld-border)" }}>
              <h3 className="font-semibold mb-2" style={{ color: "var(--ld-text)" }}>Árboles ya incluidos en esta jornada</h3>
              <ul className="space-y-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                {alreadySampledTrees.map((tree) => (
                  <li key={tree.id}>
                    <strong>{tree.code}</strong> · {tree.speciesName ?? "No identificada"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <form onSubmit={handleSave} className="space-y-4 mt-4">
            {mode === "new" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="tree-code">
                    Código del árbol
                  </label>
                  <input
                    id="tree-code"
                    type="text"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    maxLength={80}
                    className="w-full px-3 py-2 rounded border"
                    style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="tree-species">
                    Especie (opcional)
                  </label>
                  <input
                    id="tree-species"
                    type="text"
                    value={speciesName}
                    onChange={(event) => setSpeciesName(event.target.value)}
                    className="w-full px-3 py-2 rounded border"
                    style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="species-confidence">
                    Confianza en la identificación
                  </label>
                  <select
                    id="species-confidence"
                    value={speciesConfidence}
                    onChange={(event) => setSpeciesConfidence(event.target.value as (typeof speciesConfidenceOptions)[number]["value"])}
                    className="w-full px-3 py-2 rounded border"
                    style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                  >
                    {speciesConfidenceOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="tree-gps-accuracy">
                    Precisión GPS (m) opcional
                  </label>
                  <input
                    id="tree-gps-accuracy"
                    type="number"
                    step="0.1"
                    min="0"
                    value={gpsAccuracyM}
                    onChange={(event) => setGpsAccuracyM(event.target.value)}
                    className="w-full px-3 py-2 rounded border"
                    style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="tree-latitude">
                      Latitud opcional
                    </label>
                    <input
                      id="tree-latitude"
                      type="number"
                      step="any"
                      value={latitude}
                      onChange={(event) => setLatitude(event.target.value)}
                      className="w-full px-3 py-2 rounded border"
                      style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="tree-longitude">
                      Longitud opcional
                    </label>
                    <input
                      id="tree-longitude"
                      type="number"
                      step="any"
                      value={longitude}
                      onChange={(event) => setLongitude(event.target.value)}
                      className="w-full px-3 py-2 rounded border"
                      style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                    />
                  </div>
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="tree-notes">
                    Notas del árbol (opcional)
                  </label>
                  <textarea
                    id="tree-notes"
                    rows={3}
                    value={treeNotes}
                    onChange={(event) => setTreeNotes(event.target.value)}
                    className="w-full px-3 py-2 rounded border"
                    style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                  />
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="substrate-type">
                  Tipo de sustrato
                </label>
                <select
                  id="substrate-type"
                  value={substrateType}
                  onChange={(event) => setSubstrateType(event.target.value as (typeof substrateOptions)[number]["value"])}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                >
                  {substrateOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="trunk-orientation">
                  Orientación
                </label>
                <select
                  id="trunk-orientation"
                  value={trunkOrientation}
                  onChange={(event) => setTrunkOrientation(event.target.value as (typeof orientationOptions)[number]["value"])}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                >
                  {orientationOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="sampling-height">
                  Altura de muestreo (m) opcional
                </label>
                <input
                  id="sampling-height"
                  type="number"
                  step="0.1"
                  min="0"
                  value={samplingHeightM}
                  onChange={(event) => setSamplingHeightM(event.target.value)}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="shade-level">
                  Nivel de sombra
                </label>
                <select
                  id="shade-level"
                  value={shadeLevel}
                  onChange={(event) => setShadeLevel(event.target.value as (typeof shadeOptions)[number]["value"])}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                >
                  {shadeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="confidence-level">
                  Confianza del registro
                </label>
                <select
                  id="confidence-level"
                  value={confidenceLevel}
                  onChange={(event) => setConfidenceLevel(event.target.value as (typeof confidenceOptions)[number]["value"])}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                >
                  {confidenceOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="sample-notes">
                Notas del muestreo (opcional)
              </label>
              <textarea
                id="sample-notes"
                rows={3}
                value={sampleNotes}
                onChange={(event) => setSampleNotes(event.target.value)}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded border"
              style={{ background: "var(--ld-sand)", color: "var(--ld-text)", borderColor: "var(--ld-border)" }}
            >
              {saving ? "Guardando árbol..." : "Guardar árbol en la jornada"}
            </button>
          </form>

          {error ? (
            <div className="mt-4 rounded px-4 py-3" style={{ background: "#F9DAD6", color: "#842029", border: "1px solid #F5C2C7" }}>
              {error}
            </div>
          ) : null}

          {statusMessage ? (
            <div className="mt-4 rounded px-4 py-3" style={{ background: "#D1E7DD", color: "#0F5132", border: "1px solid #BADBCC" }}>
              {statusMessage}
            </div>
          ) : null}
        </section>
      ) : null}

      {selectedEventId && sampledTreeDetails.length > 0 ? (
        <section className="mb-6 p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h2 className="font-semibold mb-4" style={{ color: "var(--ld-text)" }}>Árboles de la jornada</h2>
          <div className="mb-4 text-sm" style={{ color: "var(--ld-text-secondary)" }}>
            Total de árboles muestreados: <strong>{sampledTreeDetails.length}</strong>
          </div>
          <div className="space-y-4">
            {sampledTreeDetails.map((sampleWithTree) => (
              <article key={sampleWithTree.id} className="rounded border p-4" style={{ background: "#fff", borderColor: "var(--ld-border)" }}>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                  <div>
                    <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>{sampleWithTree.tree ? sampleWithTree.tree.code : "Árbol"}</h3>
                    <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                      {sampleWithTree.tree?.speciesName ?? "No identificada"} · {sampleWithTree.tree?.speciesConfidence ?? "unknown"}
                    </p>
                  </div>
                  <span className="text-xs uppercase" style={{ color: "var(--ld-text-secondary)" }}>
                    {formatLocalDateTime(sampleWithTree.createdAt)}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}><strong>Sustrato:</strong> {substrateOptions.find((option) => option.value === sampleWithTree.substrateType)?.label ?? sampleWithTree.substrateType}</p>
                  <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}><strong>Orientación:</strong> {orientationOptions.find((option) => option.value === sampleWithTree.trunkOrientation)?.label ?? sampleWithTree.trunkOrientation}</p>
                  <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}><strong>Altura:</strong> {sampleWithTree.samplingHeightM != null ? `${sampleWithTree.samplingHeightM} m` : "No indicada"}</p>
                  <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}><strong>Sombra:</strong> {shadeOptions.find((option) => option.value === sampleWithTree.shadeLevel)?.label ?? sampleWithTree.shadeLevel}</p>
                  <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}><strong>Confianza:</strong> {confidenceOptions.find((option) => option.value === sampleWithTree.confidenceLevel)?.label ?? sampleWithTree.confidenceLevel}</p>
                  {sampleWithTree.tree?.latitude != null && sampleWithTree.tree?.longitude != null ? (
                    <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}><strong>Coordenadas:</strong> {sampleWithTree.tree.latitude}, {sampleWithTree.tree.longitude}</p>
                  ) : null}
                  {sampleWithTree.notes ? (
                    <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}><strong>Notas:</strong> {sampleWithTree.notes}</p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

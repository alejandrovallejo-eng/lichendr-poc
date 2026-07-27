"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { fetchProjects } from "@/modules/projects/client";
import { fetchSitesByProject, createSite } from "@/modules/sites/client";
import type { Project, Site } from "@/types/domain";

export const dynamic = "force-dynamic";

const radiusOptions = [
  { value: 50, label: "50 m" },
  { value: 100, label: "100 m" },
  { value: 250, label: "250 m" },
  { value: 500, label: "500 m" },
  { value: 1000, label: "1 km" },
];

export default function SitesPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [sites, setSites] = useState<Site[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [province, setProvince] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [gpsAccuracyM, setGpsAccuracyM] = useState("");
  const [radiusM, setRadiusM] = useState(100);
  const [notes, setNotes] = useState("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  useEffect(() => {
    async function loadProjects() {
      setLoadingProjects(true);
      setError(null);

      const { projects: loadedProjects, error: projectsError } = await fetchProjects();

      if (projectsError) {
        setError(projectsError);
        setProjects([]);
      } else {
        setProjects(loadedProjects);

        const projectId = new URLSearchParams(window.location.search).get("projectId") ?? undefined;
        if (projectId && loadedProjects.some((project) => project.id === projectId)) {
          setSelectedProjectId(projectId);
        } else if (!selectedProjectId && loadedProjects.length > 0) {
          setSelectedProjectId(loadedProjects[0].id);
        }
      }

      setLoadingProjects(false);
    }

    loadProjects();
  }, [selectedProjectId, setSelectedProjectId]);

  useEffect(() => {
    const projectId = selectedProjectId;
    if (!projectId) {
      return;
    }

    async function loadSites(projectId: string) {
      setLoadingSites(true);
      setError(null);

      const { sites: loadedSites, error: sitesError } = await fetchSitesByProject(projectId);

      if (sitesError) {
        setError(sitesError);
        setSites([]);
      } else {
        setSites(loadedSites);
      }

      setLoadingSites(false);
    }

    loadSites(projectId);
  }, [selectedProjectId]);

  const validateSiteForm = () => {
    if (!selectedProjectId) {
      return "Selecciona un proyecto.";
    }

    if (!name.trim()) {
      return "El nombre del sitio es obligatorio.";
    }

    if (name.trim().length > 120) {
      return "El nombre no puede tener más de 120 caracteres.";
    }

    const latitudeValue = latitude.trim();
    const longitudeValue = longitude.trim();

    if ((latitudeValue && !longitudeValue) || (!latitudeValue && longitudeValue)) {
      return "Latitud y longitud deben ingresarse juntas.";
    }

    if (latitudeValue) {
      const parsedLatitude = Number(latitudeValue);
      if (Number.isNaN(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90) {
        return "La latitud debe estar entre -90 y 90.";
      }
    }

    if (longitudeValue) {
      const parsedLongitude = Number(longitudeValue);
      if (Number.isNaN(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180) {
        return "La longitud debe estar entre -180 y 180.";
      }
    }

    if (gpsAccuracyM.trim()) {
      const parsedAccuracy = Number(gpsAccuracyM);
      if (Number.isNaN(parsedAccuracy) || parsedAccuracy < 0) {
        return "La precisión GPS debe ser mayor o igual a 0.";
      }
    }

    return null;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const validationError = validateSiteForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!selectedProjectId) {
      setError("Selecciona un proyecto.");
      return;
    }

    setSubmitting(true);

    const latitudeNumber = latitude.trim() ? Number(latitude.trim()) : undefined;
    const longitudeNumber = longitude.trim() ? Number(longitude.trim()) : undefined;
    const gpsAccuracyNumber = gpsAccuracyM.trim() ? Number(gpsAccuracyM.trim()) : undefined;

    const { site, error: createError } = await createSite({
      projectId: selectedProjectId,
      name: name.trim(),
      description: description.trim() || undefined,
      province: province.trim() || undefined,
      municipality: municipality.trim() || undefined,
      latitude: latitudeNumber,
      longitude: longitudeNumber,
      gpsAccuracyM: gpsAccuracyNumber,
      radiusM,
      notes: notes.trim() || undefined,
    });

    if (createError) {
      if (createError.toLowerCase().includes("unique") || createError.toLowerCase().includes("duplicate")) {
        setError("Ya existe un sitio con ese nombre en este proyecto.");
      } else {
        setError("No se pudo crear el sitio. Intenta de nuevo.");
      }
      setSubmitting(false);
      return;
    }

    if (site) {
      setSites((current) => [site, ...current]);
      setName("");
      setDescription("");
      setProvince("");
      setMunicipality("");
      setLatitude("");
      setLongitude("");
      setGpsAccuracyM("");
      setRadiusM(100);
      setNotes("");
      setSuccessMessage("Sitio guardado correctamente.");
    }

    setSubmitting(false);
  };

  return (
    <div>
      <PageHeader title="Sitios" subtitle="Administra los sitios asociados a tus proyectos." />

      <section className="mb-6" style={{ color: "var(--ld-text-secondary)" }}>
        <p className="text-sm">Cada proyecto puede tener múltiples sitios. Crea y administra sitios para tus muestreos ambientales.</p>
      </section>

      {loadingProjects ? (
        <div className="mb-6 rounded px-4 py-3" style={{ background: "var(--ld-card)", border: "1px solid var(--ld-border)" }}>
          Cargando proyectos...
        </div>
      ) : projects.length === 0 ? (
        <div className="mb-6 rounded px-4 py-3" style={{ background: "var(--ld-card)", border: "1px solid var(--ld-border)" }}>
          <p>No hay proyectos aún.</p>
          <a href="/projects" className="text-sm font-medium" style={{ color: "var(--ld-primary)" }}>
            Primero debes crear un proyecto.
          </a>
        </div>
      ) : (
        <section className="mb-6 p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h2 className="font-semibold mb-3" style={{ color: "var(--ld-text)" }}>Seleccionar proyecto</h2>
          <label className="block mb-3 text-sm font-medium" style={{ color: "var(--ld-text)" }} htmlFor="project-select">
            Proyecto
          </label>
          <select
            id="project-select"
            value={selectedProjectId || ""}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            className="w-full px-3 py-2 rounded border"
            style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
          >
            <option value="">Selecciona un proyecto</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </section>
      )}

      {projects.length > 0 && selectedProject ? (
        <section className="mb-6 p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h2 className="font-semibold mb-3" style={{ color: "var(--ld-text)" }}>Nuevo sitio</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="site-name">
                Nombre del sitio
              </label>
              <input
                id="site-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="site-description">
                Descripción (opcional)
              </label>
              <textarea
                id="site-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="site-province">
                  Provincia (opcional)
                </label>
                <input
                  id="site-province"
                  type="text"
                  value={province}
                  onChange={(event) => setProvince(event.target.value)}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="site-municipality">
                  Municipio (opcional)
                </label>
                <input
                  id="site-municipality"
                  type="text"
                  value={municipality}
                  onChange={(event) => setMunicipality(event.target.value)}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                />
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="site-latitude">
                  Latitud (opcional)
                </label>
                <input
                  id="site-latitude"
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(event) => setLatitude(event.target.value)}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="site-longitude">
                  Longitud (opcional)
                </label>
                <input
                  id="site-longitude"
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(event) => setLongitude(event.target.value)}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="site-gps-accuracy">
                  Precisión GPS (m)
                </label>
                <input
                  id="site-gps-accuracy"
                  type="number"
                  min={0}
                  step="any"
                  value={gpsAccuracyM}
                  onChange={(event) => setGpsAccuracyM(event.target.value)}
                  className="w-full px-3 py-2 rounded border"
                  style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="site-radius">
                Radio de análisis
              </label>
              <select
                id="site-radius"
                value={radiusM}
                onChange={(event) => setRadiusM(Number(event.target.value))}
                className="w-full px-3 py-2 rounded border"
                style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
              >
                {radiusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="site-notes">
                Notas (opcional)
              </label>
              <textarea
                id="site-notes"
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
              {submitting ? "Guardando sitio..." : "Guardar sitio"}
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

      {selectedProject ? (
        <section className="p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h2 className="font-semibold mb-3" style={{ color: "var(--ld-text)" }}>Sitios del proyecto</h2>
          {loadingSites ? (
            <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Cargando sitios...</p>
          ) : sites.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
              Aún no hay sitios para este proyecto. Crea uno para comenzar.
            </p>
          ) : (
            <div className="space-y-4">
              {sites.map((site) => (
                <article key={site.id} className="p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
                  <div className="flex flex-col md:flex-row md:justify-between gap-3">
                    <div>
                      <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>{site.name}</h3>
                      <p className="text-sm mt-1" style={{ color: "var(--ld-text-secondary)" }}>
                        {selectedProject.name}
                      </p>
                    </div>
                    <span className="text-xs uppercase" style={{ color: "var(--ld-text-secondary)" }}>
                      {new Date(site.createdAt).toLocaleDateString("es-DO", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {site.province || site.municipality ? (
                      <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                        {site.province ? `Provincia: ${site.province}` : ""}
                        {site.province && site.municipality ? ", " : ""}
                        {site.municipality ? `Municipio: ${site.municipality}` : ""}
                      </p>
                    ) : null}
                    {site.latitude != null && site.longitude != null ? (
                      <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                        Coordenadas: {site.latitude.toFixed(6)}, {site.longitude.toFixed(6)}
                      </p>
                    ) : null}
                    <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                      Origen: {site.locationSource}
                    </p>
                    <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                      Radio: {site.radiusM} m
                    </p>
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

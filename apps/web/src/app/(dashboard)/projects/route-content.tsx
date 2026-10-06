"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import { fetchProjects, createProject } from "@/modules/projects/client";
import { Project } from "@/types/domain";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);

    const { projects: loadedProjects, error: fetchError } = await fetchProjects();

    if (fetchError) {
      setError(fetchError);
      setProjects([]);
    } else {
      setProjects(loadedProjects);
    }

    setLoading(false);
  };

  useEffect(() => {
    async function initialize() {
      await loadProjects();
    }

    initialize();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!name.trim()) {
      setError("El nombre del proyecto es obligatorio.");
      return;
    }

    setLoading(true);
    const { project, error: createError } = await createProject(name, description);

    if (createError) {
      setError(createError);
    } else if (project) {
      setProjects((current) => [project, ...current]);
      setName("");
      setDescription("");
      setSuccessMessage("Proyecto creado correctamente.");
    }

    setLoading(false);
  };

  return (
    <div>
      <PageHeader title="Proyectos" subtitle="Crea y administra tus proyectos de monitoreo de líquenes." />

      <section className="mb-6" style={{ color: "var(--ld-text-secondary)" }}>
        <p className="text-sm">Crea un proyecto para comenzar con el flujo de sitios, jornadas y árboles.</p>
      </section>

      <div className="ld-form-grid">
      <section className="mb-6 p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <h2 className="font-semibold mb-3" style={{ color: "var(--ld-text)" }}>Nuevo proyecto</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="project-name">
              Nombre
            </label>
            <input
              id="project-name"
              name="project-name"
              autoComplete="off"
              required
              maxLength={120}
              placeholder="Ej. Líquenes del bosque urbano…"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full px-3 py-2 rounded border"
              style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--ld-text)" }} htmlFor="project-description">
              Descripción (opcional)
            </label>
            <textarea
              id="project-description"
              name="project-description"
              placeholder="Objetivo y alcance del muestreo…"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded border"
              style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="px-4 py-2 rounded border"
            style={{ background: "var(--ld-sand)", color: "var(--ld-text)", borderColor: "var(--ld-border)" }}
          >
            {loading ? "Guardando…" : "Crear proyecto"}
          </button>
        </form>
      </section>

      <div>
      {error ? (
        <div role="alert" className="mb-6 rounded px-4 py-3" style={{ background: "#F9DAD6", color: "#842029", border: "1px solid #F5C2C7" }}>
          {error}
        </div>
      ) : null}

      {successMessage ? (
        <div role="status" className="mb-6 rounded px-4 py-3" style={{ background: "#D1E7DD", color: "#0F5132", border: "1px solid #BADBCC" }}>
          {successMessage}
        </div>
      ) : null}

      <section>
        <h2 className="font-semibold mb-3" style={{ color: "var(--ld-text)" }}>Proyectos existentes</h2>
        {loading && projects.length === 0 ? (
          <p role="status" className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Cargando proyectos…</p>
        ) : projects.length === 0 ? (
          <EmptyState title={error ? "No se pudieron cargar los proyectos" : "Tu primer proyecto empieza aquí"}><p>{error ? "Revisa el mensaje anterior e intenta cargar la lista de nuevo." : "Define el nombre y el objetivo del muestreo en el formulario. Después podrás añadir sitios y jornadas."}</p>{error ? <button type="button" onClick={() => void loadProjects()} className="ld-button ld-button-outline">Reintentar carga</button> : null}</EmptyState>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <article key={project.id} className="p-4 rounded border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>{project.name}</h3>
                    {project.description ? (
                      <p className="text-sm mt-1" style={{ color: "var(--ld-text-secondary)" }}>{project.description}</p>
                    ) : null}
                    <Link
                      href={`/sites?projectId=${project.id}`}
                      className="inline-block mt-3 text-sm font-medium"
                      style={{ color: "var(--ld-primary)" }}
                    >
                      Gestionar sitios
                    </Link>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: "var(--ld-text-secondary)" }}>
                    {new Date(project.createdAt).toLocaleDateString("es-DO", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      </div>
      </div>
    </div>
  );
}
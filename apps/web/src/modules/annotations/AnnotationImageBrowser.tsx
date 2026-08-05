"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSignedImageUrl,
  type AnnotationImageListItem,
  type ImageEvaluationStatus,
} from "@/modules/annotations/client";

interface AnnotationImageBrowserProps {
  images: AnnotationImageListItem[];
  initialTab: "pending" | "evaluated";
  initialTool: "manual" | "ai" | "layers";
}

const STATUS_LABELS: Record<ImageEvaluationStatus, string> = {
  not_started: "Sin iniciar",
  draft: "Borrador",
  completed: "Evaluada",
};

export default function AnnotationImageBrowser({ images, initialTab, initialTool }: AnnotationImageBrowserProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "evaluated">(initialTab);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [projectId, setProjectId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [eventId, setEventId] = useState("");
  const [treeSampleId, setTreeSampleId] = useState("");
  const [status, setStatus] = useState<ImageEvaluationStatus | "">("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all(images.map(async (image) => {
      try {
        return [image.id, await getSignedImageUrl(image.storage_path)] as const;
      } catch {
        return [image.id, null] as const;
      }
    })).then((entries) => {
      if (!cancelled) {
        setThumbnailUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [images]);

  const projects = useMemo(
    () => [...new Map(images.map((image) => [image.context.projectId, image.context.projectName])).entries()],
    [images],
  );
  const sites = useMemo(
    () => [...new Map(images
      .filter((image) => !projectId || image.context.projectId === projectId)
      .map((image) => [image.context.siteId, image.context.siteName])).entries()],
    [images, projectId],
  );
  const events = useMemo(
    () => [...new Map(images
      .filter((image) => (!projectId || image.context.projectId === projectId) && (!siteId || image.context.siteId === siteId))
      .map((image) => [image.context.samplingEventId, image.context.samplingEventName])).entries()],
    [images, projectId, siteId],
  );
  const samples = useMemo(
    () => [...new Map(images
      .filter((image) => (
        (!projectId || image.context.projectId === projectId)
        && (!siteId || image.context.siteId === siteId)
        && (!eventId || image.context.samplingEventId === eventId)
      ))
      .map((image) => [image.context.treeSampleId, image.context.treeCode])).entries()],
    [eventId, images, projectId, siteId],
  );

  const filteredImages = useMemo(() => images.filter((image) => {
    const belongsToTab = tab === "evaluated"
      ? image.annotationStatus === "completed"
      : image.annotationStatus !== "completed";
    return belongsToTab
      && (!projectId || image.context.projectId === projectId)
      && (!siteId || image.context.siteId === siteId)
      && (!eventId || image.context.samplingEventId === eventId)
      && (!treeSampleId || image.context.treeSampleId === treeSampleId)
      && (!status || image.annotationStatus === status);
  }), [eventId, images, projectId, siteId, status, tab, treeSampleId]);

  const openImage = (image: AnnotationImageListItem) => {
    router.push(`/annotations?imageId=${encodeURIComponent(image.id)}&tool=${initialTool}`);
  };

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Anotaciones</h1>
        <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Continúa borradores o consulta evaluaciones finalizadas.</p>
      </header>

      <div className="mb-4 flex gap-2 border-b" role="tablist" aria-label="Estado de las imágenes" style={{ borderColor: "var(--ld-border)" }}>
        <button type="button" role="tab" aria-selected={tab === "pending"} onClick={() => { setTab("pending"); setStatus(""); }} className="border-b-2 px-4 py-2 text-sm font-semibold" style={{ borderColor: tab === "pending" ? "var(--ld-text)" : "transparent" }}>
          Pendientes
        </button>
        <button type="button" role="tab" aria-selected={tab === "evaluated"} onClick={() => { setTab("evaluated"); setStatus(""); }} className="border-b-2 px-4 py-2 text-sm font-semibold" style={{ borderColor: tab === "evaluated" ? "var(--ld-text)" : "transparent" }}>
          Evaluadas
        </button>
      </div>

      <section className="mb-4 grid gap-3 rounded border bg-white p-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Filtros" style={{ borderColor: "var(--ld-border)" }}>
        <label className="text-sm">Proyecto
          <select value={projectId} onChange={(event) => { setProjectId(event.target.value); setSiteId(""); setEventId(""); setTreeSampleId(""); }} className="mt-1 w-full rounded border px-2 py-2" style={{ borderColor: "var(--ld-border)" }}>
            <option value="">Todos</option>
            {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="text-sm">Sitio
          <select value={siteId} onChange={(event) => { setSiteId(event.target.value); setEventId(""); setTreeSampleId(""); }} className="mt-1 w-full rounded border px-2 py-2" style={{ borderColor: "var(--ld-border)" }}>
            <option value="">Todos</option>
            {sites.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="text-sm">Jornada
          <select value={eventId} onChange={(event) => { setEventId(event.target.value); setTreeSampleId(""); }} className="mt-1 w-full rounded border px-2 py-2" style={{ borderColor: "var(--ld-border)" }}>
            <option value="">Todas</option>
            {events.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="text-sm">Árbol o muestra
          <select value={treeSampleId} onChange={(event) => setTreeSampleId(event.target.value)} className="mt-1 w-full rounded border px-2 py-2" style={{ borderColor: "var(--ld-border)" }}>
            <option value="">Todos</option>
            {samples.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="text-sm">Estado
          <select value={status} onChange={(event) => setStatus(event.target.value as ImageEvaluationStatus | "")} className="mt-1 w-full rounded border px-2 py-2" style={{ borderColor: "var(--ld-border)" }}>
            <option value="">Todos</option>
            {tab === "pending" ? (
              <>
                <option value="not_started">Sin iniciar</option>
                <option value="draft">Borrador</option>
              </>
            ) : <option value="completed">Evaluada</option>}
          </select>
        </label>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredImages.map((image) => (
          <article key={image.id} className="overflow-hidden rounded border bg-white" style={{ borderColor: "var(--ld-border)" }}>
            <div className="relative aspect-video bg-slate-100">
              {thumbnailUrls[image.id] ? (
                <Image src={thumbnailUrls[image.id]} alt="" fill sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" unoptimized className="object-cover" />
              ) : <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--ld-text-secondary)" }}>Miniatura no disponible</div>}
            </div>
            <div className="space-y-1 p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{image.original_filename}</h2>
                <span className="shrink-0 rounded-full border px-2 py-1 text-xs font-medium" style={{ borderColor: "var(--ld-border)" }}>{STATUS_LABELS[image.annotationStatus]}</span>
              </div>
              <p><strong>Proyecto:</strong> {image.context.projectName}</p>
              <p><strong>Sitio:</strong> {image.context.siteName}</p>
              <p><strong>Jornada:</strong> {image.context.samplingEventName}</p>
              <p><strong>Árbol o muestra:</strong> {image.context.treeCode}</p>
              <p><strong>{image.annotationStatus === "completed" ? "Fecha de evaluación" : "Fecha"}:</strong> {new Date(image.completedAt ?? image.created_at).toLocaleString()}</p>
              {image.annotationStatus === "completed" ? (
                <div className="pt-2" style={{ color: "var(--ld-text-secondary)" }}>
                  <p>Capas/regiones: {image.regionCount}</p>
                  <p>Regiones de liquen: {image.lichenRegionCount}</p>
                  <p>Morfotipos: {image.morphotypeLabels.join(", ") || "Ninguno"}</p>
                  <p>Cobertura provisional: {!image.hasMetrics ? "Resumen pendiente de cálculo" : image.provisionalCoveragePercent == null ? "Datos insuficientes" : `${image.provisionalCoveragePercent.toFixed(1)}%`}</p>
                </div>
              ) : null}
              <button type="button" onClick={() => openImage(image)} className="studio-primary mt-3 w-full rounded border px-3 py-2 font-semibold">
                {image.annotationStatus === "completed" ? "Ver evaluación" : image.annotationStatus === "draft" ? "Continuar evaluación" : "Comenzar evaluación"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {filteredImages.length === 0 ? (
        <p className="rounded border p-4 text-sm" style={{ borderColor: "var(--ld-border)" }}>
          {tab === "evaluated" ? "No hay imágenes evaluadas con estos filtros." : "No hay imágenes pendientes con estos filtros."}
        </p>
      ) : null}
    </div>
  );
}

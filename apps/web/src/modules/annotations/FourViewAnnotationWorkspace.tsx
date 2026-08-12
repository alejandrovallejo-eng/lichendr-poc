"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import {
  loadCaptureAnnotationSequence,
  refreshSeriesMetrics,
  type CaptureAnnotationTarget,
} from "@/modules/four-view/client";
import { DIRECTION_LABELS } from "@/modules/four-view/types";
import { nextFourViewDestination } from "@/modules/four-view/navigation";
import AnnotationStudioWorkflow from "./AnnotationStudioWorkflow";

export default function FourViewAnnotationWorkspace({ seriesId }: { seriesId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedIndex = Number(searchParams.get("view") ?? "0");
  const [targets, setTargets] = useState<CaptureAnnotationTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const index = Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < 4 ? requestedIndex : 0;
  const current = targets[index] ?? null;

  useEffect(() => {
    void loadCaptureAnnotationSequence(seriesId)
      .then((items) => {
        if (items.length !== 4) throw new Error("La serie no contiene cuatro targets rectificados.");
        setTargets(items);
      })
      .catch(() => setError("No se pudo abrir la serie calibrada para anotación."));
  }, [seriesId]);

  const navigate = async (nextIndex: number) => {
    try {
      await refreshSeriesMetrics(seriesId);
      const refreshedTargets = await loadCaptureAnnotationSequence(seriesId);
      setTargets(refreshedTargets);
      if (nextIndex > index && refreshedTargets[index]?.status !== "annotation_completed") {
        setError("Finaliza y guarda la anotación de esta vista antes de continuar.");
        return;
      }
      if (nextIndex < index) {
        router.push(`/annotations?captureSeriesId=${encodeURIComponent(seriesId)}&view=${nextIndex}&tool=ai`);
      } else if (nextIndex < 4) {
        router.push(nextFourViewDestination(seriesId, index));
      } else {
        router.push(nextFourViewDestination(seriesId, 3));
      }
    } catch {
      setError("La vista se guardó, pero no se pudo actualizar el progreso. Recarga para continuar.");
    }
  };

  if (error) return <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>;
  if (!current) return <div className="rounded border p-4 text-sm">Cargando serie rectificada…</div>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Anotación IA de cuatro vistas"
        subtitle={`Vista ${index + 1} de 4 · ${DIRECTION_LABELS[current.direction]} · abertura rectificada de 10 × 50 cm`}
      />
      <section className="rounded border p-4 text-sm" style={{ borderColor: "var(--ld-border)", background: "var(--ld-card)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <strong>Progreso: Vista {index + 1} de 4</strong>
          <span>Norte → Este → Sur → Oeste</span>
        </div>
        <p className="mt-2">
          Clasifica las propuestas visuales como líquen, corteza, musgo, alga, pintura, daño, sombra,
          brillo o desconocido. Los grupos de color, textura y forma son morfotipos provisionales, no especies.
        </p>
      </section>
      <AnnotationStudioWorkflow
        initialImageId={current.imageId}
        initialTool="ai"
        captureSeriesId={seriesId}
        captureViewIndex={index}
      />
      <div className="flex flex-wrap justify-between gap-3 rounded border p-4" style={{ borderColor: "var(--ld-border)" }}>
        {index > 0 ? (
          <button type="button" className="rounded border px-4 py-2" onClick={() => void navigate(index - 1)}>
            Volver a la vista anterior
          </button>
        ) : <Link href="/images" className="rounded border px-4 py-2">Volver a captura</Link>}
        <button
          type="button"
          className="rounded bg-emerald-800 px-5 py-3 font-semibold text-white"
          onClick={() => void navigate(index + 1)}
        >
          {index === 3 ? "Revisar resultados del árbol" : "Guardar y siguiente vista"}
        </button>
      </div>
    </div>
  );
}

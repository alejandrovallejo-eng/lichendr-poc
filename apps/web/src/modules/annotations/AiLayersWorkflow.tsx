"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  ANNOTATION_REGION_CLASSES,
  assertAnnotationSetForImage,
  createTemporaryUrl,
  deleteRegionWithStorage,
  getAccessibleStoredImage,
  loadAiAnnotationState,
  updateRegionClassification,
  type AnnotationRegionClassification,
  type AnnotationRegionRow,
  type MorphotypeRow,
} from "@/modules/annotations/regions";

interface AiLayersWorkflowProps {
  imageId: string;
  annotationSetId: string;
}

const CLASS_LABELS: Record<AnnotationRegionClassification, string> = {
  lichen: "Liquen",
  bark: "Corteza",
  moss: "Musgo",
  algae: "Alga",
  shadow: "Sombra",
  glare: "Reflejo",
  unknown: "Desconocido",
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default function AiLayersWorkflow({ imageId, annotationSetId }: AiLayersWorkflowProps) {
  const [image, setImage] = useState<{ original_filename: string } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [regions, setRegions] = useState<AnnotationRegionRow[]>([]);
  const [morphotypes, setMorphotypes] = useState<MorphotypeRow[]>([]);
  const [maskUrls, setMaskUrls] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [opacity, setOpacity] = useState<Record<string, number>>({});
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [classification, setClassification] = useState<AnnotationRegionClassification>("unknown");
  const [morphotypeId, setMorphotypeId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  const selectedRegion = regions.find((region) => region.id === selectedRegionId) ?? null;
  const totals = useMemo(() => regions.reduce<Record<AnnotationRegionClassification, number>>((accumulator, region) => {
    accumulator[region.classification] += 1;
    return accumulator;
  }, { lichen: 0, bark: 0, moss: 0, algae: 0, shadow: 0, glare: 0, unknown: 0 }), [regions]);

  const selectRegion = useCallback((region: AnnotationRegionRow) => {
    setSelectedRegionId(region.id);
    setClassification(region.classification);
    setMorphotypeId(region.morphotype_id);
  }, []);

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!isUuid(imageId) || !isUuid(annotationSetId)) {
      setStatus("La imagen o el conjunto de capas no es válido.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const storedImage = await getAccessibleStoredImage(imageId);
      if (!storedImage) throw new Error("La imagen no existe o no está disponible.");
      const [{ regions: nextRegions, morphotypes: nextMorphotypes }, signedImageUrl] = await Promise.all([
        loadAiAnnotationState(annotationSetId),
        createTemporaryUrl(storedImage.storage_path),
        assertAnnotationSetForImage(annotationSetId, imageId),
      ]);
      const signedMasks = await Promise.all(nextRegions.map(async (region) => [region.id, await createTemporaryUrl(region.mask_path)] as const));
      if (requestId !== requestIdRef.current) return;
      setImage({ original_filename: storedImage.original_filename });
      setImageUrl(signedImageUrl);
      setRegions(nextRegions);
      setMorphotypes(nextMorphotypes);
      setMaskUrls(Object.fromEntries(signedMasks));
      setVisible(Object.fromEntries(nextRegions.map((region) => [region.id, true])));
      setOpacity(Object.fromEntries(nextRegions.map((region) => [region.id, 0.45])));
      if (nextRegions[0]) selectRegion(nextRegions[0]);
    } catch {
      if (requestId === requestIdRef.current) setStatus("No se pudieron cargar las capas IA de esta imagen.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [annotationSetId, imageId, selectRegion]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      requestIdRef.current += 1;
    };
  }, [load]);

  const saveClassification = async () => {
    if (!selectedRegion) return;
    if (classification === "lichen" && !morphotypeId) {
      setStatus("Selecciona un morfotipo para la capa de líquen.");
      return;
    }
    try {
      const updated = await updateRegionClassification(selectedRegion.id, annotationSetId, classification, classification === "lichen" ? morphotypeId : null);
      setRegions((current) => current.map((region) => region.id === updated.id ? updated : region));
      selectRegion(updated);
      setStatus("Clasificación actualizada.");
    } catch {
      setStatus("No se pudo actualizar la clasificación de la capa.");
    }
  };

  const removeRegion = async (region: AnnotationRegionRow) => {
    try {
      await deleteRegionWithStorage(region);
      setRegions((current) => current.filter((item) => item.id !== region.id));
      setSelectedRegionId((current) => current === region.id ? null : current);
      setStatus("Capa eliminada.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo eliminar la capa.");
    }
  };

  return (
    <div>
      <PageHeader title="Capas IA" subtitle="Máscaras aceptadas con MobileSAM para una imagen guardada." />
      {status ? <p className="mb-4 rounded border p-3 text-sm" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }}>{status}</p> : null}
      {loading ? <p className="text-sm">Cargando capas IA…</p> : null}
      {!loading && image && imageUrl ? (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_0.9fr]">
          <section className="rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">{image.original_filename}</h2>
            </div>
            <div className="relative mt-4 overflow-hidden rounded border" style={{ borderColor: "var(--ld-border)" }}>
              <Image src={imageUrl} alt={image.original_filename} width={1200} height={800} className="block w-full object-contain" unoptimized />
              {regions.filter((region) => visible[region.id] && maskUrls[region.id]).map((region) => (
                <Image
                  key={region.id}
                  src={maskUrls[region.id]}
                  alt=""
                  fill
                  sizes="100vw"
                  unoptimized
                  className="pointer-events-none object-fill mix-blend-multiply"
                  style={{ opacity: opacity[region.id] ?? 0.45 }}
                />
              ))}
            </div>
            {regions.length === 0 ? <p className="mt-4 text-sm" style={{ color: "var(--ld-text-secondary)" }}>No hay capas IA aceptadas. Abre la pestaña Asistencia IA para crear una.</p> : null}
          </section>
          <section className="space-y-4">
            <div className="rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
              <h3 className="font-semibold">Capas IA</h3>
              <div className="mt-3 space-y-2">
                {regions.map((region) => (
                  <div key={region.id} className="rounded border p-3 text-sm" style={{ borderColor: selectedRegionId === region.id ? "var(--ld-text)" : "var(--ld-border)" }}>
                    <button type="button" onClick={() => selectRegion(region)} className="w-full text-left">
                      <strong>{CLASS_LABELS[region.classification]}</strong>
                      <p>{morphotypes.find((morphotype) => morphotype.id === region.morphotype_id)?.label ?? "Sin morfotipo"}</p>
                      <p>Score: {region.score == null ? "—" : region.score.toFixed(3)} · Área: {region.area_pixels} px</p>
                    </button>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setVisible((current) => ({ ...current, [region.id]: !current[region.id] }))} className="rounded border px-2 py-1" style={{ borderColor: "var(--ld-border)" }}>{visible[region.id] ? "Ocultar" : "Mostrar"}</button>
                      <label>Opacidad <input type="range" min="0.1" max="0.9" step="0.05" value={opacity[region.id] ?? 0.45} onChange={(event) => setOpacity((current) => ({ ...current, [region.id]: Number(event.target.value) }))} /></label>
                      <button type="button" onClick={() => void removeRegion(region)} className="rounded border px-2 py-1 text-red-700" style={{ borderColor: "var(--ld-border)" }}>Eliminar</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {selectedRegion ? (
              <div className="rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
                <h3 className="font-semibold">Editar capa</h3>
                <select value={classification} onChange={(event) => setClassification(event.target.value as AnnotationRegionClassification)} className="mt-3 w-full rounded border p-2" style={{ borderColor: "var(--ld-border)" }}>
                  {ANNOTATION_REGION_CLASSES.map((item) => <option key={item} value={item}>{CLASS_LABELS[item]}</option>)}
                </select>
                {classification === "lichen" ? (
                  <select value={morphotypeId ?? ""} onChange={(event) => setMorphotypeId(event.target.value || null)} className="mt-2 w-full rounded border p-2" style={{ borderColor: "var(--ld-border)" }}>
                    <option value="">Selecciona morfotipo</option>
                    {morphotypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                ) : null}
                <button type="button" onClick={() => void saveClassification()} className="mt-3 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Guardar clasificación</button>
              </div>
            ) : null}
            <div className="rounded border p-4 text-sm" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
              <h3 className="font-semibold">Resumen provisional</h3>
              {ANNOTATION_REGION_CLASSES.map((item) => totals[item] > 0 ? <p key={item}>{CLASS_LABELS[item]}: {totals[item]} capas</p> : null)}
              <p className="mt-2">El área de cada capa se muestra en píxeles. Sumar áreas puede duplicar zonas solapadas; no representa una cobertura científica final.</p>
              <p className="mt-2">La cobertura correcta requerirá la unión de máscaras de liquen dentro del área de corteza en una fase posterior.</p>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

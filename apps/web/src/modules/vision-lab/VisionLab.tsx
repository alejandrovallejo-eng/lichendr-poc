"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  ANNOTATION_REGION_CLASSES,
  createMorphotypeForAnnotationSet,
  createTemporaryUrl,
  deleteRegionWithStorage,
  getAccessibleStoredImage,
  loadAiAnnotationState,
  saveAcceptedRegion,
  type AnnotationRegionClassification,
  type AnnotationRegionRow,
  type MorphotypeRow,
  type NormalizedPoint,
  type RegionPersistenceError,
} from "@/modules/annotations/regions";
import { ensureAnnotationSetForImage } from "@/modules/annotations/client";
import PageHeader from "@/components/PageHeader";

const MAX_ANALYSIS_DIMENSION = 1024;
const DEBOUNCE_MS = 250;

interface PointPrompt extends NormalizedPoint {
  label: 0 | 1;
}

interface Candidate {
  id: string;
  score: number;
  maskDataUrl: string;
  width: number;
  height: number;
  areaPixels: number;
  modelName: string;
  modelVersion: string | null;
}

interface Layer {
  id: string;
  region: AnnotationRegionRow | null;
  classification: AnnotationRegionClassification;
  morphotypeId: string | null;
  score: number;
  areaPixels: number;
  maskUrl: string;
  visible: boolean;
  opacity: number;
  status: "memory" | "saving" | "saved" | "cleanup-pending";
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

function sanitize(message: string): string {
  return message.replace(/[\r\n\t]/g, " ").slice(0, 240);
}

async function scaleImageBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_ANALYSIS_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("No se pudo preparar la imagen.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("No se pudo preparar la imagen.")), "image/jpeg", 0.92));
}

async function pngDataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (blob.type !== "image/png") throw new Error("La máscara generada no es un PNG válido.");
  return blob;
}

interface VisionLabProps {
  imageId?: string | null;
  embedded?: boolean;
  annotationSetId?: string | null;
  morphotypes?: MorphotypeRow[];
  onMorphotypesChange?: (morphotypes: MorphotypeRow[]) => void;
}

export default function VisionLab({
  imageId: imageIdProp = null,
  embedded = false,
  annotationSetId: annotationSetIdProp = null,
  morphotypes: morphotypesProp,
  onMorphotypesChange,
}: VisionLabProps) {
  const searchParams = useSearchParams();
  const imageId = imageIdProp ?? searchParams.get("imageId");
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [storedImageId, setStoredImageId] = useState<string | null>(null);
  const [localAnnotationSetId, setLocalAnnotationSetId] = useState<string | null>(null);
  const [localMorphotypes, setLocalMorphotypes] = useState<MorphotypeRow[]>([]);
  const [points, setPoints] = useState<PointPrompt[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [classification, setClassification] = useState<AnnotationRegionClassification | "">("");
  const [morphotypeId, setMorphotypeId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [promptMode, setPromptMode] = useState<"positive" | "negative">("positive");
  const [status, setStatus] = useState("Conectando con el servicio de visión…");
  const [error, setError] = useState<string | null>(null);
  const [serviceReady, setServiceReady] = useState(false);
  const [busy, setBusy] = useState<"prepare" | "segment" | "save" | null>(null);
  const [newMorphotype, setNewMorphotype] = useState({ label: "", growthForm: "unknown" as MorphotypeRow["growth_form"], colorHex: "", notes: "" });
  const [draggingPoint, setDraggingPoint] = useState<number | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayUrlRef = useRef<string | null>(null);
  const controlledMorphotypesRef = useRef(morphotypesProp);

  const annotationSetId = annotationSetIdProp ?? localAnnotationSetId;
  const morphotypes = morphotypesProp ?? localMorphotypes;
  const activeCandidate = candidates[candidateIndex] ?? null;
  const isStoredImage = storedImageId !== null && annotationSetId !== null;
  const summary = useMemo(() => layers.reduce<Record<AnnotationRegionClassification, number>>((accumulator, layer) => {
    accumulator[layer.classification] += 1;
    return accumulator;
  }, { lichen: 0, bark: 0, moss: 0, algae: 0, shadow: 0, glare: 0, unknown: 0 }), [layers]);

  const syncMorphotypes = useCallback((value: MorphotypeRow[] | ((current: MorphotypeRow[]) => MorphotypeRow[])) => {
    const controlledMorphotypes = controlledMorphotypesRef.current;
    if (controlledMorphotypes !== undefined) {
      const next = typeof value === "function" ? value(controlledMorphotypes) : value;
      controlledMorphotypesRef.current = next;
      onMorphotypesChange?.(next);
      return;
    }
    setLocalMorphotypes((current) => {
      const next = typeof value === "function" ? value(current) : value;
      onMorphotypesChange?.(next);
      return next;
    });
  }, [onMorphotypesChange]);

  useEffect(() => {
    controlledMorphotypesRef.current = morphotypesProp;
  }, [morphotypesProp]);

  const clearVisionSession = useCallback(() => {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) void fetch(`/api/vision/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }, []);

  const cancelActiveRequest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const resetImageState = useCallback(() => {
    requestIdRef.current += 1;
    cancelActiveRequest();
    clearVisionSession();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (displayUrlRef.current?.startsWith("blob:")) URL.revokeObjectURL(displayUrlRef.current);
    displayUrlRef.current = null;
    setDisplayUrl(null);
    setImageSize(null);
    setSourceFile(null);
    setStoredImageId(null);
    setLocalAnnotationSetId(null);
    setLocalMorphotypes([]);
    setPoints([]);
    setCandidates([]);
    setLayers([]);
    setSelectedLayerId(null);
    setClassification("");
    setMorphotypeId(null);
    setNotes("");
  }, [cancelActiveRequest, clearVisionSession]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/vision/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        setServiceReady(true);
        setStatus("Servicio listo. Selecciona una imagen o abre una imagen guardada.");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("El servicio de visión no está disponible.");
          setStatus("No se pudo conectar con el servicio de visión.");
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => () => {
    cancelActiveRequest();
    clearVisionSession();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (displayUrlRef.current?.startsWith("blob:")) URL.revokeObjectURL(displayUrlRef.current);
  }, [cancelActiveRequest, clearVisionSession]);

  const prepare = useCallback(async (file: File, sourceUrl: string) => {
    cancelActiveRequest();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("prepare");
    setError(null);
    setStatus("Preparando imagen en MobileSAM…");
    try {
      const scaled = await scaleImageBlob(file);
      const formData = new FormData();
      formData.append("image", scaled, "analysis.jpg");
      const response = await fetch("/api/vision/prepare", { method: "POST", body: formData, signal: controller.signal });
      const result = await response.json() as { sessionId?: string; error?: string; width?: number; height?: number };
      if (!response.ok || !result.sessionId || !result.width || !result.height) throw new Error(result.error ?? "No se pudo preparar la imagen.");
      if (requestId !== requestIdRef.current) return;
      clearVisionSession();
      sessionIdRef.current = result.sessionId;
      setDisplayUrl(sourceUrl);
      displayUrlRef.current = sourceUrl;
      setImageSize({ width: result.width, height: result.height });
      setSourceFile(file);
      setPoints([]);
      setCandidates([]);
      setCandidateIndex(0);
      setStatus("Imagen lista. Añade puntos positivos o negativos.");
    } catch (reason) {
      if ((reason as { name?: string }).name !== "AbortError") {
        setError("No se pudo preparar la imagen para MobileSAM.");
        setStatus("Error al preparar la imagen.");
      }
    } finally {
      if (requestId === requestIdRef.current) setBusy(null);
    }
  }, [cancelActiveRequest, clearVisionSession]);

  const segment = useCallback(async (nextPoints: PointPrompt[]) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || nextPoints.length === 0) return;
    cancelActiveRequest();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("segment");
    setError(null);
    setStatus("Generando máscaras…");
    try {
      const response = await fetch("/api/vision/segment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, points: nextPoints }),
        signal: controller.signal,
      });
      const result = await response.json() as { candidates?: Candidate[]; recommendedIndex?: number; error?: string };
      if (!response.ok || !result.candidates || result.recommendedIndex == null) throw new Error(result.error ?? "No se pudo segmentar.");
      if (requestId !== requestIdRef.current) return;
      setCandidates(result.candidates);
      setCandidateIndex(result.recommendedIndex);
      setStatus("Máscara lista. Clasifícala antes de aceptarla.");
    } catch (reason) {
      if ((reason as { name?: string }).name !== "AbortError") {
        setError("No se pudo generar la máscara.");
        setStatus("Error al segmentar.");
      }
    } finally {
      if (requestId === requestIdRef.current) setBusy(null);
    }
  }, [cancelActiveRequest]);

  const scheduleSegment = useCallback((nextPoints: PointPrompt[]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (nextPoints.length === 0) return;
    debounceRef.current = setTimeout(() => void segment(nextPoints), DEBOUNCE_MS);
  }, [segment]);

  useEffect(() => {
    const loadStoredImage = async () => {
      if (!imageId) return;
      if (embedded && !annotationSetIdProp) {
        resetImageState();
        setStatus("Preparando el conjunto de anotación…");
        return;
      }
      resetImageState();
      const loadRequestId = requestIdRef.current;
      if (!isUuid(imageId)) {
        setError("El identificador de imagen no es válido.");
        setStatus("No se pudo abrir la imagen guardada.");
        return;
      }
      setBusy("prepare");
      setStatus("Cargando imagen guardada…");
      try {
        const storedImage = await getAccessibleStoredImage(imageId);
        if (!storedImage) throw new Error("La imagen no existe o no está disponible.");
        const resolvedAnnotationSetId = annotationSetIdProp ?? (await ensureAnnotationSetForImage(imageId, {
          method: "manual_free_points",
          status: "draft",
          gridRows: 10,
          gridColumns: 10,
          roiX: 0,
          roiY: 0,
          roiWidth: 1,
          roiHeight: 1,
        })).id;
        const [signedUrl, state] = await Promise.all([
          createTemporaryUrl(storedImage.storage_path),
          loadAiAnnotationState(resolvedAnnotationSetId),
        ]);
        if (loadRequestId !== requestIdRef.current) return;
        const response = await fetch(signedUrl);
        if (!response.ok) throw new Error("No se pudo descargar la imagen.");
        const file = new File([await response.blob()], storedImage.original_filename, { type: storedImage.mime_type });
        if (loadRequestId !== requestIdRef.current) return;
        const existingLayers = await Promise.all(state.regions.map(async (region): Promise<Layer> => ({
          id: region.id,
          region,
          classification: region.classification,
          morphotypeId: region.morphotype_id,
          score: region.score ?? 0,
          areaPixels: region.area_pixels,
          maskUrl: await createTemporaryUrl(region.mask_path),
          visible: true,
          opacity: 0.45,
          status: "saved",
        })));
        if (loadRequestId !== requestIdRef.current) return;
        const objectUrl = URL.createObjectURL(file);
        setStoredImageId(imageId);
        setLocalAnnotationSetId(resolvedAnnotationSetId);
        syncMorphotypes(state.morphotypes);
        setLayers(existingLayers);
        await prepare(file, objectUrl);
      } catch {
        setError("La imagen guardada no está disponible o no tienes acceso.");
        setStatus("No se pudo cargar la imagen guardada.");
        setBusy(null);
      }
    };
    void loadStoredImage();
  }, [annotationSetIdProp, embedded, imageId, prepare, resetImageState, syncMorphotypes]);

  const selectLocalFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type)) {
      setError("Selecciona un archivo JPEG, PNG, WebP, HEIC o HEIF.");
      return;
    }
    resetImageState();
    const objectUrl = URL.createObjectURL(file);
    await prepare(file, objectUrl);
  };

  const onCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!imageSize || busy || draggingPoint !== null || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextPoint: PointPrompt = {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      label: promptMode === "positive" ? 1 : 0,
    };
    setPoints((current) => {
      const next = [...current, nextPoint];
      scheduleSegment(next);
      return next;
    });
  };

  const onCanvasPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (draggingPoint === null) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    setPoints((current) => current.map((point, index) => index === draggingPoint ? { ...point, x, y } : point));
  };

  const onCanvasPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (draggingPoint === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setPoints((current) => {
      scheduleSegment(current);
      return current;
    });
    setDraggingPoint(null);
  };

  const createMorphotype = async () => {
    if (!annotationSetId) {
      if (embedded) {
        setError("Espera a que el conjunto de anotación esté listo para crear morfotipos.");
        return;
      }
      const label = newMorphotype.label.trim();
      if (!label || morphotypes.some((item) => item.label.toLocaleLowerCase() === label.toLocaleLowerCase()) || (newMorphotype.colorHex && !/^#[0-9A-Fa-f]{6}$/.test(newMorphotype.colorHex))) {
        setError("Introduce un morfotipo local válido y no duplicado.");
        return;
      }
      const localMorphotype: MorphotypeRow = {
        id: crypto.randomUUID(),
        annotation_set_id: "local",
        label,
        growth_form: newMorphotype.growthForm,
        color_hex: newMorphotype.colorHex || null,
        notes: newMorphotype.notes.trim() || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      syncMorphotypes((current) => [...current, localMorphotype]);
      setMorphotypeId(localMorphotype.id);
      setNewMorphotype({ label: "", growthForm: "unknown", colorHex: "", notes: "" });
      return;
    }
    try {
      const created = await createMorphotypeForAnnotationSet(annotationSetId, newMorphotype.label, newMorphotype.growthForm, newMorphotype.colorHex || null, newMorphotype.notes.trim() || null);
      syncMorphotypes((current) => [...current, created]);
      setMorphotypeId(created.id);
      setNewMorphotype({ label: "", growthForm: "unknown", colorHex: "", notes: "" });
      setStatus("Morfotipo creado.");
    } catch (reason) {
      setError(sanitize(reason instanceof Error ? reason.message : "No se pudo crear el morfotipo."));
    }
  };

  const acceptCandidate = async () => {
    if (!activeCandidate || !classification) return;
    if (classification === "lichen" && !morphotypeId) {
      setError("Selecciona un morfotipo para una capa de líquen.");
      return;
    }
    const localLayer: Layer = {
      id: crypto.randomUUID(),
      region: null,
      classification,
      morphotypeId: classification === "lichen" ? morphotypeId : null,
      score: activeCandidate.score,
      areaPixels: activeCandidate.areaPixels,
      maskUrl: activeCandidate.maskDataUrl,
      visible: true,
      opacity: 0.45,
      status: "memory",
    };
    if (!isStoredImage || !annotationSetId) {
      if (embedded) {
        setError("Espera a que el conjunto de anotación esté listo antes de guardar capas IA.");
        return;
      }
      setLayers((current) => [...current, localLayer]);
      setSelectedLayerId(localLayer.id);
      setStatus("Capa aceptada en memoria. Usa una imagen guardada para persistirla.");
      return;
    }
    setBusy("save");
    setError(null);
    setLayers((current) => [...current, { ...localLayer, status: "saving" }]);
    try {
      const id = crypto.randomUUID();
      const region = await saveAcceptedRegion({
        id,
        annotationSetId,
        classification,
        morphotypeId: classification === "lichen" ? morphotypeId : null,
        mask: await pngDataUrlToBlob(activeCandidate.maskDataUrl),
        width: activeCandidate.width,
        height: activeCandidate.height,
        areaPixels: activeCandidate.areaPixels,
        score: activeCandidate.score,
        positivePoints: points.filter((point) => point.label === 1).map(({ x, y }) => ({ x, y })),
        negativePoints: points.filter((point) => point.label === 0).map(({ x, y }) => ({ x, y })),
        modelName: activeCandidate.modelName,
        modelVersion: activeCandidate.modelVersion,
        notes: notes.trim() || null,
      });
      const savedLayer: Layer = { ...localLayer, id: region.id, region, status: "saved" };
      setLayers((current) => current.map((layer) => layer.id === localLayer.id ? savedLayer : layer));
      setSelectedLayerId(region.id);
      setStatus("Capa guardada correctamente.");
    } catch (reason) {
      const persistenceError = reason as RegionPersistenceError;
      const cleanupPending = persistenceError.name === "RegionPersistenceError" && persistenceError.cleanupPending;
      setLayers((current) => current.map((layer) => layer.id === localLayer.id ? { ...layer, status: cleanupPending ? "cleanup-pending" : "memory" } : layer));
      setError(sanitize(reason instanceof Error ? reason.message : "No se pudo guardar la capa."));
    } finally {
      setBusy(null);
    }
  };

  const deleteLayer = async (layer: Layer) => {
    if (!layer.region) {
      setLayers((current) => current.filter((item) => item.id !== layer.id));
      return;
    }
    try {
      await deleteRegionWithStorage(layer.region);
      setLayers((current) => current.filter((item) => item.id !== layer.id));
      setSelectedLayerId((current) => current === layer.id ? null : current);
    } catch (reason) {
      setError(sanitize(reason instanceof Error ? reason.message : "No se pudo eliminar la capa."));
    }
  };

  return (
    <div className={embedded ? undefined : "min-h-screen p-4 lg:p-6"} style={embedded ? { color: "var(--ld-text)" } : { background: "var(--ld-background)", color: "var(--ld-text)" }}>
      <div className={embedded ? undefined : "rounded-2xl border bg-white p-5 shadow-sm"} style={embedded ? undefined : { borderColor: "var(--ld-border)" }}>
        {embedded ? null : <PageHeader title="Laboratorio IA" subtitle="Segmentación asistida con MobileSAM para imágenes guardadas." />}
        {embedded ? <><h4 className="text-base font-semibold">MobileSAM</h4><p className="mt-1 text-sm" style={{ color: "var(--ld-text-secondary)" }}>Genera máscaras y guárdalas como capas aceptadas dentro de esta anotación.</p></> : null}
        {!embedded ? <p className="mt-1 text-sm" style={{ color: "var(--ld-text-secondary)" }}>MobileSAM vit_t en CPU propone límites visuales; tú confirmas su clasificación.</p> : null}
        <div className="mt-3 rounded border p-3 text-sm" style={{ borderColor: "var(--ld-border)" }}>
          <strong>Estado:</strong> {status} {!isStoredImage && sourceFile ? " Las capas de imágenes locales solo se conservan en memoria." : null}
        </div>
        {error ? <p className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_0.8fr]">
          <section className="rounded border p-4" style={{ borderColor: "var(--ld-border)", background: "var(--ld-background)" }}>
            <div className="mb-3 flex flex-wrap gap-2">
              {!embedded ? <label className="rounded border bg-white px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => void selectLocalFile(event)} className="mr-2" />
                Seleccionar imagen local
              </label> : null}
              <button type="button" onClick={() => setPoints((current) => current.slice(0, -1))} disabled={!points.length || busy !== null} className="rounded border bg-white px-3 py-2 text-sm disabled:opacity-50" style={{ borderColor: "var(--ld-border)" }}>Deshacer punto</button>
              <button type="button" onClick={() => { setPoints([]); setCandidates([]); }} disabled={!points.length || busy !== null} className="rounded border bg-white px-3 py-2 text-sm disabled:opacity-50" style={{ borderColor: "var(--ld-border)" }}>Limpiar guía</button>
            </div>
            {displayUrl && imageSize ? (
              <div className="relative overflow-hidden rounded border bg-white" style={{ borderColor: "var(--ld-border)" }}>
                <Image src={displayUrl} alt="Imagen para segmentar" width={imageSize.width} height={imageSize.height} unoptimized className="block h-auto w-full" />
                <svg viewBox={`0 0 ${imageSize.width} ${imageSize.height}`} className="absolute inset-0 h-full w-full" onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} style={{ cursor: busy ? "wait" : "crosshair" }}>
                  {layers.filter((layer) => layer.visible).map((layer) => <image key={layer.id} href={layer.maskUrl} width={imageSize.width} height={imageSize.height} opacity={layer.opacity} style={{ mixBlendMode: "multiply" }} />)}
                  {activeCandidate ? <image href={activeCandidate.maskDataUrl} width={imageSize.width} height={imageSize.height} opacity={0.35} style={{ mixBlendMode: "multiply" }} /> : null}
                  {points.map((point, index) => <circle key={`${point.x}-${point.y}-${index}`} cx={point.x * imageSize.width} cy={point.y * imageSize.height} r={Math.max(5, imageSize.width * 0.008)} fill={point.label === 1 ? "#4F7C5B" : "#C2410C"} stroke="white" strokeWidth={2} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDraggingPoint(index); }} />)}
                </svg>
              </div>
            ) : <div className="flex h-96 items-center justify-center rounded border border-dashed text-sm" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }}>Selecciona una fotografía para iniciar.</div>}
          </section>
          <section className="space-y-4">
            <div className="rounded border bg-white p-4" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Guía de puntos</h2>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={!serviceReady || !imageSize || busy !== null} onClick={() => setPromptMode("positive")} className="rounded px-3 py-2 text-sm text-white disabled:opacity-50" style={{ background: promptMode === "positive" ? "var(--ld-green)" : "#9ca3af" }}>Añadir área</button>
                <button type="button" disabled={!serviceReady || !imageSize || busy !== null} onClick={() => setPromptMode("negative")} className="rounded border px-3 py-2 text-sm disabled:opacity-50" style={{ borderColor: "var(--ld-border)", background: promptMode === "negative" ? "#fee2e2" : "white" }}>Excluir área</button>
              </div>
            </div>
            <div className="rounded border bg-white p-4" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Máscara activa</h2>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={() => setCandidateIndex((index) => Math.max(0, index - 1))} disabled={!candidates.length || candidateIndex === 0} className="rounded border px-3 py-2 text-sm disabled:opacity-50" style={{ borderColor: "var(--ld-border)" }}>Anterior</button>
                <span className="text-sm">{candidates.length ? `${candidateIndex + 1} / ${candidates.length}` : "Sin máscara"}</span>
                <button type="button" onClick={() => setCandidateIndex((index) => Math.min(candidates.length - 1, index + 1))} disabled={!candidates.length || candidateIndex === candidates.length - 1} className="rounded border px-3 py-2 text-sm disabled:opacity-50" style={{ borderColor: "var(--ld-border)" }}>Siguiente</button>
              </div>
              {activeCandidate ? <p className="mt-2 text-sm">Score: {activeCandidate.score.toFixed(3)} · Área: {activeCandidate.areaPixels} px</p> : null}
            </div>
            <div className="rounded border bg-white p-4" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Aceptar capa</h2>
              <select value={classification} onChange={(event) => { const next = event.target.value as AnnotationRegionClassification | ""; setClassification(next); if (next !== "lichen") setMorphotypeId(null); }} className="mt-3 w-full rounded border p-2" style={{ borderColor: "var(--ld-border)" }}>
                <option value="">Selecciona clasificación</option>
                {ANNOTATION_REGION_CLASSES.map((item) => <option key={item} value={item}>{CLASS_LABELS[item]}</option>)}
              </select>
              {classification === "lichen" ? <select value={morphotypeId ?? ""} onChange={(event) => setMorphotypeId(event.target.value || null)} className="mt-2 w-full rounded border p-2" style={{ borderColor: "var(--ld-border)" }}><option value="">Selecciona morfotipo</option>{morphotypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : null}
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notas opcionales" rows={2} className="mt-2 w-full rounded border p-2" style={{ borderColor: "var(--ld-border)" }} />
              <button type="button" onClick={() => void acceptCandidate()} disabled={!activeCandidate || !classification || busy !== null || (classification === "lichen" && !morphotypeId)} className="mt-3 rounded px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--ld-green)" }}>{isStoredImage ? "Aceptar y guardar capa" : "Aceptar capa en memoria"}</button>
            </div>
            <div className="rounded border bg-white p-4" style={{ borderColor: "var(--ld-border)" }}><h2 className="font-semibold">Crear morfotipo</h2><input value={newMorphotype.label} onChange={(event) => setNewMorphotype((current) => ({ ...current, label: event.target.value }))} placeholder="Etiqueta" className="mt-2 w-full rounded border p-2" style={{ borderColor: "var(--ld-border)" }} /><select value={newMorphotype.growthForm} onChange={(event) => setNewMorphotype((current) => ({ ...current, growthForm: event.target.value as MorphotypeRow["growth_form"] }))} className="mt-2 w-full rounded border p-2" style={{ borderColor: "var(--ld-border)" }}><option value="unknown">unknown</option><option value="crustose">crustose</option><option value="foliose">foliose</option><option value="fruticose">fruticose</option><option value="squamulose">squamulose</option></select><input value={newMorphotype.colorHex} onChange={(event) => setNewMorphotype((current) => ({ ...current, colorHex: event.target.value }))} placeholder="#RRGGBB" className="mt-2 w-full rounded border p-2" style={{ borderColor: "var(--ld-border)" }} /><textarea value={newMorphotype.notes} onChange={(event) => setNewMorphotype((current) => ({ ...current, notes: event.target.value }))} placeholder="Notas" rows={2} className="mt-2 w-full rounded border p-2" style={{ borderColor: "var(--ld-border)" }} /><button type="button" onClick={() => void createMorphotype()} className="mt-2 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Crear morfotipo</button>{!isStoredImage ? <p className="mt-2 text-xs" style={{ color: "var(--ld-text-secondary)" }}>Los morfotipos de imágenes locales solo se conservan en memoria.</p> : null}</div>
          </section>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
          <section className="rounded border bg-white p-4" style={{ borderColor: "var(--ld-border)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Capas aceptadas</h2>{isStoredImage ? <a href={`/annotations?imageId=${encodeURIComponent(storedImageId ?? "")}`} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Guardar y continuar en Anotaciones</a> : null}</div>
            {!layers.length ? <p className="mt-3 text-sm" style={{ color: "var(--ld-text-secondary)" }}>Aún no hay capas aceptadas.</p> : <div className="mt-3 space-y-2">{layers.map((layer) => <div key={layer.id} className="rounded border p-3 text-sm" style={{ borderColor: selectedLayerId === layer.id ? "var(--ld-text)" : "var(--ld-border)" }}><button type="button" onClick={() => setSelectedLayerId(layer.id)} className="w-full text-left"><strong>{CLASS_LABELS[layer.classification]}</strong><p>{morphotypes.find((item) => item.id === layer.morphotypeId)?.label ?? "Sin morfotipo"} · Score {layer.score.toFixed(3)} · Área {layer.areaPixels} px</p><p>Estado: {layer.status === "saved" ? "guardada" : layer.status === "memory" ? "en memoria" : layer.status === "saving" ? "guardando" : "Limpieza pendiente"}</p></button><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => setLayers((current) => current.map((item) => item.id === layer.id ? { ...item, visible: !item.visible } : item))} className="rounded border px-2 py-1" style={{ borderColor: "var(--ld-border)" }}>{layer.visible ? "Ocultar" : "Mostrar"}</button><label>Opacidad <input type="range" min="0.1" max="0.9" step="0.05" value={layer.opacity} onChange={(event) => setLayers((current) => current.map((item) => item.id === layer.id ? { ...item, opacity: Number(event.target.value) } : item))} /></label><button type="button" onClick={() => void deleteLayer(layer)} className="rounded border px-2 py-1 text-red-700" style={{ borderColor: "var(--ld-border)" }}>Eliminar</button>{!embedded && layer.region && isStoredImage ? <a href={`/annotations?imageId=${encodeURIComponent(storedImageId ?? "")}`} className="rounded border px-2 py-1" style={{ borderColor: "var(--ld-border)" }}>Abrir en Anotaciones</a> : null}</div></div>)}</div>}
          </section>
          <section className="rounded border bg-white p-4 text-sm" style={{ borderColor: "var(--ld-border)" }}><h2 className="font-semibold">Resumen provisional</h2><p className="mt-3">Capas: {layers.length}</p>{ANNOTATION_REGION_CLASSES.map((item) => summary[item] ? <p key={item}>{CLASS_LABELS[item]}: {summary[item]}</p> : null)}<p className="mt-3">El área de cada capa se expresa en píxeles. Sumar áreas puede duplicar zonas solapadas y no constituye cobertura científica final.</p><p className="mt-2">La cobertura correcta requerirá la unión de máscaras de liquen dentro del área de corteza en una fase posterior.</p></section>
        </div>
      </div>
    </div>
  );
}

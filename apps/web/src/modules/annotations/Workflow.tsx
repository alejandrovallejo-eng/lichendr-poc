"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import {
  completeAnnotationSet,
  deleteAnnotationPoint,
  deleteMorphotype,
  getImageRecord,
  getSignedImageUrl,
  listAccessibleImages,
  loadAnnotationState,
  upsertAnnotationPoint,
  upsertAnnotationSet,
  upsertMorphotype,
  isValidAnnotationRoi,
  type AnnotationPointClassification,
  type AnnotationPointConfidenceLevel,
  type AnnotationPointDraft,
  type AnnotationSetDraft,
  type AnnotationSetRow,
  type MorphotypeDraft,
  type MorphotypeRow,
  type AccessibleImageRecord,
} from "@/modules/annotations/client";

interface LocalPointState {
  pointIndex: number;
  classification: AnnotationPointClassification | null;
  confidenceLevel: AnnotationPointConfidenceLevel;
  morphotypeId: string | null;
  id?: string | null;
  xNormalized: number;
  yNormalized: number;
}

interface PendingRoiPoint {
  x: number;
  y: number;
}

interface SelectedPointState {
  pointIndex: number;
  xNormalized: number;
  yNormalized: number;
}

interface ActionRecord {
  pointIndex: number;
  previousClassification: AnnotationPointClassification | null;
  nextClassification: AnnotationPointClassification | null;
  previousMorphotypeId: string | null;
  nextMorphotypeId: string | null;
  previousId: string | null;
  nextId: string | null;
}

interface SaveStatus {
  type: "info" | "success" | "error";
  text: string;
}

const CATEGORY_OPTIONS: Array<{ value: AnnotationPointClassification; label: string; color: string }> = [
  { value: "lichen", label: "Liquen", color: "#1d4ed8" },
  { value: "bark", label: "Corteza", color: "#8b5a2b" },
  { value: "moss", label: "Musgo", color: "#16a34a" },
  { value: "algae", label: "Alga", color: "#0f766e" },
  { value: "shadow", label: "Sombra", color: "#111827" },
  { value: "glare", label: "Reflejo", color: "#facc15" },
  { value: "unknown", label: "Desconocido", color: "#6b7280" },
];

const GROWTH_FORMS = ["crustose", "foliose", "fruticose", "squamulose", "unknown"] as const;

function normalizeLabel(value: string) {
  return value.trim().toLowerCase();
}

function getCategoryColor(classification: AnnotationPointClassification | null, morphotypeColor: string | null) {
  if (classification === null) {
    return "#ffffff";
  }

  if (classification === "lichen") {
    return morphotypeColor ?? "#1d4ed8";
  }

  const match = CATEGORY_OPTIONS.find((option) => option.value === classification);
  return match?.color ?? "#6b7280";
}

function isFullImageRoi(roi: { x: number | null; y: number | null; width: number | null; height: number | null }) {
  return roi.x === 0 && roi.y === 0 && roi.width === 1 && roi.height === 1;
}

function getRoiSummary(roi: { x: number | null; y: number | null; width: number | null; height: number | null }) {
  if (!isValidAnnotationRoi(roi)) {
    return "Imagen completa";
  }

  return isFullImageRoi(roi) ? "Imagen completa" : "Área de corteza";
}

export default function AnnotationsWorkflow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const imageIdParam = searchParams.get("imageId") ?? null;

  const [availableImages, setAvailableImages] = useState<AccessibleImageRecord[]>([]);
  const [selectedImage, setSelectedImage] = useState<AccessibleImageRecord | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(imageIdParam);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [isLoadingState, setIsLoadingState] = useState(false);
  const [annotationSet, setAnnotationSet] = useState<AnnotationSetRow | null>(null);
  const [morphotypes, setMorphotypes] = useState<MorphotypeRow[]>([]);
  const [pointStates, setPointStates] = useState<Record<number, LocalPointState>>({});
  const [gridRows, setGridRows] = useState(10);
  const [gridColumns, setGridColumns] = useState(10);
  const [roi, setRoi] = useState<{ x: number | null; y: number | null; width: number | null; height: number | null }>({ x: 0, y: 0, width: 1, height: 1 });
  const [selectionMode, setSelectionMode] = useState<"full" | "roi">("full");
  const [pendingRoiPoint, setPendingRoiPoint] = useState<PendingRoiPoint | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPointState | null>(null);
  const [selectedClassification, setSelectedClassification] = useState<AnnotationPointClassification>("lichen");
  const [selectedMorphotypeId, setSelectedMorphotypeId] = useState<string | null>(null);
  const [morphotypeForm, setMorphotypeForm] = useState<{ label: string; growthForm: MorphotypeDraft["growthForm"]; colorHex: string; notes: string }>({ label: "", growthForm: "unknown", colorHex: "", notes: "" });
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [lastActionStack, setLastActionStack] = useState<ActionRecord[]>([]);
  const imageHostRef = useRef<HTMLDivElement | null>(null);

  const loadAvailableImages = useCallback(async () => {
    setSelectedImage(null);
    setSelectedImageId(null);
    setSignedUrl(null);
    setAnnotationSet(null);
    setMorphotypes([]);
    setPointStates({});
    setGridRows(10);
    setGridColumns(10);
    setRoi({ x: 0, y: 0, width: 1, height: 1 });
    setSelectionMode("full");
    setPendingRoiPoint(null);
    setSelectedPoint(null);
    setImageLoadError(false);
    setIsLoadingImages(true);

    try {
      const images = await listAccessibleImages();
      setAvailableImages(images);
    } catch {
      setAvailableImages([]);
      setSaveStatus({ type: "error", text: "No se pudieron cargar las imágenes disponibles." });
    } finally {
      setIsLoadingImages(false);
    }
  }, []);

  const loadAnnotationImage = useCallback(async (imageId: string) => {
    setIsLoadingState(true);
    setSaveStatus(null);
    setSelectedImageId(imageId);

    try {
      const image = await getImageRecord(imageId);
      if (!image) {
        setSelectedImage(null);
        setSignedUrl(null);
        setSaveStatus({ type: "error", text: "No se encontró la imagen seleccionada." });
        setIsLoadingState(false);
        return;
      }

      const signed = await getSignedImageUrl(image.storage_path);
      setSelectedImage(image);
      setSignedUrl(signed);
      setImageLoadError(false);

      const state = await loadAnnotationState(imageId);
      setAnnotationSet(state.annotationSet);
      setMorphotypes(state.morphotypes);
      setGridRows(state.annotationSet?.grid_rows ?? 10);
      setGridColumns(state.annotationSet?.grid_columns ?? 10);
      setRoi({
        x: state.annotationSet?.roi_x ?? 0,
        y: state.annotationSet?.roi_y ?? 0,
        width: state.annotationSet?.roi_width ?? 1,
        height: state.annotationSet?.roi_height ?? 1,
      });

      const nextPointStates: Record<number, LocalPointState> = {};
      for (const point of state.points) {
        nextPointStates[point.point_index] = {
          pointIndex: point.point_index,
          classification: point.classification as AnnotationPointClassification,
          confidenceLevel: point.confidence_level as AnnotationPointConfidenceLevel,
          morphotypeId: point.morphotype_id,
          id: point.id,
          xNormalized: point.x_normalized,
          yNormalized: point.y_normalized,
        };
      }

      setPointStates(nextPointStates);
      setLastActionStack([]);
      setSelectedPoint(null);
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo cargar la anotación de esta imagen." });
    } finally {
      setIsLoadingState(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!imageIdParam) {
      void loadAvailableImages();
      return;
    }

    void loadAnnotationImage(imageIdParam);
  }, [imageIdParam, loadAvailableImages, loadAnnotationImage]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const generatedPoints = useMemo(() => {
    const activeRoi = roi;
    const effectiveRoi = {
      x: activeRoi.x ?? 0,
      y: activeRoi.y ?? 0,
      width: activeRoi.width ?? 1,
      height: activeRoi.height ?? 1,
    };

    const points: Array<{ pointIndex: number; xNormalized: number; yNormalized: number }> = [];
    for (let row = 0; row < gridRows; row += 1) {
      for (let column = 0; column < gridColumns; column += 1) {
        const xNormalized = effectiveRoi.x + effectiveRoi.width * ((column + 0.5) / gridColumns);
        const yNormalized = effectiveRoi.y + effectiveRoi.height * ((row + 0.5) / gridRows);
        points.push({ pointIndex: row * gridColumns + column + 1, xNormalized, yNormalized });
      }
    }

    return points;
  }, [gridRows, gridColumns, roi]);

  const stats = useMemo(() => {
    const classifiedPoints = Object.values(pointStates).filter((point) => point.classification != null).length;
    const totalPoints = generatedPoints.length;
    const unclassifiedPoints = totalPoints - classifiedPoints;
    const evaluablePoints = Object.values(pointStates).filter((point) => point.classification === "lichen" || point.classification === "bark" || point.classification === "moss" || point.classification === "algae").length;
    const excludedPoints = Object.values(pointStates).filter((point) => point.classification === "shadow" || point.classification === "glare" || point.classification === "unknown").length;
    const lichenPoints = Object.values(pointStates).filter((point) => point.classification === "lichen").length;
    const visibleMorphotypeIds = new Set(Object.values(pointStates).filter((point) => point.classification === "lichen" && point.morphotypeId).map((point) => point.morphotypeId));
    const lichenCoverage = evaluablePoints > 0 ? (lichenPoints / evaluablePoints) * 100 : null;

    return {
      totalPoints,
      classifiedPoints,
      unclassifiedPoints,
      evaluablePoints,
      excludedPoints,
      lichenPoints,
      visibleMorphotypes: visibleMorphotypeIds.size,
      lichenCoverage,
    };
  }, [generatedPoints.length, pointStates]);

  const handleSelectImage = (imageId: string) => {
    router.push(`/annotations?imageId=${imageId}`);
  };

  const handleToggleFullImage = () => {
    if (Object.keys(pointStates).length > 0 && !window.confirm("Cambiar el ROI descartará las clasificaciones locales actuales. ¿Deseas continuar?")) {
      return;
    }

    setRoi({ x: null, y: null, width: null, height: null });
    setSelectionMode("full");
    setPendingRoiPoint(null);
    setPointStates({});
    setLastActionStack([]);
    setSaveStatus({ type: "info", text: "Se ha restaurado la imagen completa y se han descartado las clasificaciones locales." });
  };

  const handleStartRoiSelection = () => {
    setSelectionMode("roi");
    setPendingRoiPoint(null);
  };

  const handleResetRoi = () => {
    if (Object.keys(pointStates).length > 0 && !window.confirm("Reiniciar el ROI descartará las clasificaciones locales actuales. ¿Deseas continuar?")) {
      return;
    }

    setRoi({ x: 0, y: 0, width: 1, height: 1 });
    setPendingRoiPoint(null);
    setPointStates({});
    setLastActionStack([]);
    setSaveStatus({ type: "info", text: "Se ha reiniciado el área y se han descartado las clasificaciones locales." });
  };

  const applyRoiFromPoints = (start: PendingRoiPoint, end: PendingRoiPoint) => {
    if (Math.abs(start.x - end.x) < 0.0001 || Math.abs(start.y - end.y) < 0.0001) {
      setSaveStatus({ type: "error", text: "El rectángulo debe tener ancho y alto mayores que cero." });
      return;
    }

    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxX = Math.max(start.x, end.x);
    const maxY = Math.max(start.y, end.y);

    setRoi({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    setPendingRoiPoint(null);
    setSelectionMode("full");
    setSaveStatus({ type: "info", text: "Área de corteza definida correctamente." });
  };

  const handleImageClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!imageHostRef.current || selectionMode !== "roi") {
      return;
    }

    const bounds = imageHostRef.current.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;

    if (pendingRoiPoint == null) {
      setPendingRoiPoint({ x, y });
      return;
    }

    applyRoiFromPoints(pendingRoiPoint, { x, y });
  };

  const handlePointSelection = async (point: { pointIndex: number; xNormalized: number; yNormalized: number }) => {
    if (!selectedImageId) {
      return;
    }

    const existing = pointStates[point.pointIndex];
    setSelectedPoint(point);
    const nextClassification = selectedClassification === "unknown" ? "unknown" : selectedClassification;

    if (selectedClassification === "lichen" && !selectedMorphotypeId) {
      setSaveStatus({ type: "error", text: "Selecciona un morfotipo antes de clasificar un punto como líquen." });
      return;
    }

    const nextMorphotypeId = selectedClassification === "lichen" ? selectedMorphotypeId : null;

    const previousState = existing
      ? {
          classification: existing.classification,
          morphotypeId: existing.morphotypeId,
          id: existing.id ?? null,
        }
      : { classification: null, morphotypeId: null, id: null };

    const nextClassificationValue: AnnotationPointClassification | null = selectedClassification === "unknown" ? "unknown" : selectedClassification;

    const nextState: LocalPointState = {
      pointIndex: point.pointIndex,
      classification: nextClassificationValue,
      confidenceLevel: "medium",
      morphotypeId: nextMorphotypeId,
      xNormalized: point.xNormalized,
      yNormalized: point.yNormalized,
      id: existing?.id ?? null,
    };

    setPointStates((current) => ({ ...current, [point.pointIndex]: nextState }));
    setLastActionStack((current) => [
      {
        pointIndex: point.pointIndex,
        previousClassification: previousState.classification,
        nextClassification: nextClassificationValue,
        previousMorphotypeId: previousState.morphotypeId,
        nextMorphotypeId: nextMorphotypeId,
        previousId: previousState.id,
        nextId: existing?.id ?? null,
      },
      ...current,
    ].slice(0, 20));

    try {
      if (nextClassificationValue == null) {
        if (existing?.id) {
          await deleteAnnotationPoint(existing.id);
        }
      } else {
        const payload: AnnotationPointDraft = {
          id: existing?.id ?? undefined,
          annotationSetId: annotationSet?.id ?? "",
          pointIndex: point.pointIndex,
          xNormalized: point.xNormalized,
          yNormalized: point.yNormalized,
          classification: nextClassificationValue,
          confidenceLevel: "medium",
          morphotypeId: nextMorphotypeId,
          notes: null,
        };

        const savedPoint = await upsertAnnotationPoint(payload);
        setPointStates((current) => ({ ...current, [point.pointIndex]: { ...current[point.pointIndex], id: savedPoint.id } }));
      }

      setSaveStatus({ type: "success", text: "Clasificación actualizada correctamente." });
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo persistir la clasificación. Puedes reintentar." });
    }
  };

  const handleUndoLastChange = async () => {
    if (lastActionStack.length === 0) {
      return;
    }

    const action = lastActionStack[0];
    const previousPoint = pointStates[action.pointIndex];

    const restoredState: LocalPointState | null = action.previousClassification == null
      ? null
      : {
          pointIndex: action.pointIndex,
          classification: action.previousClassification,
          confidenceLevel: "medium",
          morphotypeId: action.previousMorphotypeId,
          id: action.previousId ?? null,
          xNormalized: previousPoint?.xNormalized ?? 0,
          yNormalized: previousPoint?.yNormalized ?? 0,
        };

    setPointStates((current) => {
      const next = { ...current };
      if (restoredState) {
        next[action.pointIndex] = restoredState;
      } else {
        delete next[action.pointIndex];
      }
      return next;
    });

    try {
      if (action.previousClassification == null) {
        if (action.previousId) {
          await deleteAnnotationPoint(action.previousId);
        }
      } else {
        const payload: AnnotationPointDraft = {
          id: action.previousId ?? undefined,
          annotationSetId: annotationSet?.id ?? "",
          pointIndex: action.pointIndex,
          xNormalized: previousPoint?.xNormalized ?? 0,
          yNormalized: previousPoint?.yNormalized ?? 0,
          classification: action.previousClassification,
          confidenceLevel: "medium",
          morphotypeId: action.previousMorphotypeId,
          notes: null,
        };
        const savedPoint = await upsertAnnotationPoint(payload);
        setPointStates((current) => ({ ...current, [action.pointIndex]: { ...current[action.pointIndex], id: savedPoint.id } }));
      }

      setLastActionStack((current) => current.slice(1));
      setSaveStatus({ type: "info", text: "Se ha deshecho el último cambio local." });
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo deshacer el último cambio." });
    }
  };

  const handleClearSelectedPointClassification = async () => {
    if (!selectedImageId || !selectedPoint) {
      setSaveStatus({ type: "error", text: "Selecciona un punto antes de limpiar su clasificación." });
      return;
    }

    const existing = pointStates[selectedPoint.pointIndex];
    if (!existing || existing.classification == null) {
      setSaveStatus({ type: "info", text: "El punto seleccionado ya está sin clasificar." });
      return;
    }

    setPointStates((current) => {
      const next = { ...current };
      delete next[selectedPoint.pointIndex];
      return next;
    });
    setLastActionStack((current) => [
      {
        pointIndex: selectedPoint.pointIndex,
        previousClassification: existing.classification,
        nextClassification: null,
        previousMorphotypeId: existing.morphotypeId,
        nextMorphotypeId: null,
        previousId: existing.id ?? null,
        nextId: null,
      },
      ...current,
    ].slice(0, 20));

    try {
      if (existing.id) {
        await deleteAnnotationPoint(existing.id);
      }
      setSelectedPoint(null);
      setSaveStatus({ type: "success", text: "Clasificación limpiada correctamente." });
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo limpiar la clasificación del punto." });
    }
  };

  const persistAnnotationSet = async (status: "draft" | "completed") => {
    if (!selectedImageId) {
      return;
    }

    setIsSaving(true);
    setSaveStatus({ type: "info", text: "Guardando anotación..." });

    try {
      const annotationDraft: AnnotationSetDraft = {
        imageId: selectedImageId,
        gridRows,
        gridColumns,
        roiX: roi.x,
        roiY: roi.y,
        roiWidth: roi.width,
        roiHeight: roi.height,
        status,
        notes: status === "completed" ? "Estimación visual basada en el método de conteo sistemático de puntos." : null,
      };

      const nextAnnotationSet = await upsertAnnotationSet(annotationDraft);
      setAnnotationSet(nextAnnotationSet);
      setSaveStatus({ type: "success", text: status === "completed" ? "Anotación completada correctamente." : "Borrador guardado correctamente." });
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo guardar la anotación. Puedes reintentar." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedImageId) {
      setSaveStatus({ type: "error", text: "Primero selecciona una imagen." });
      return;
    }

    if (!isValidAnnotationRoi(roi)) {
      setSaveStatus({ type: "error", text: "Define un ROI antes de guardar el borrador." });
      return;
    }

    await persistAnnotationSet("draft");
  };

  const handleCompleteAnnotation = async () => {
    if (!selectedImageId) {
      setSaveStatus({ type: "error", text: "Primero selecciona una imagen." });
      return;
    }

    if (!isValidAnnotationRoi(roi)) {
      setSaveStatus({ type: "error", text: "Define un ROI antes de completar la anotación." });
      return;
    }

    const classifiedPoints = Object.values(pointStates).filter((point) => point.classification != null).length;
    const totalPoints = generatedPoints.length;
    if (classifiedPoints === 0 || classifiedPoints === totalPoints) {
      setSaveStatus({ type: "error", text: "Completa la anotación solo cuando todos los puntos estén clasificados y al menos uno sea evaluable." });
      return;
    }

    setIsCompleting(true);
    setSaveStatus({ type: "info", text: "Completando anotación..." });

    try {
      await persistAnnotationSet("completed");
      if (annotationSet?.id) {
        await completeAnnotationSet(annotationSet.id);
      }
      setSaveStatus({ type: "success", text: "Anotación completada. Este resultado representa una estimación visual, no una identificación de especies." });
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo completar la anotación. Puedes reintentar." });
    } finally {
      setIsCompleting(false);
    }
  };

  const handleCreateMorphotype = async () => {
    if (!selectedImageId || !annotationSet?.id) {
      setSaveStatus({ type: "error", text: "Guarda primero la anotación para asociar morfotipos." });
      return;
    }

    const normalizedLabel = normalizeLabel(morphotypeForm.label);
    if (!normalizedLabel) {
      setSaveStatus({ type: "error", text: "El nombre del morfotipo es obligatorio." });
      return;
    }

    if (normalizedLabel.length > 80) {
      setSaveStatus({ type: "error", text: "El nombre del morfotipo no puede superar 80 caracteres." });
      return;
    }

    const duplicate = morphotypes.some((morphotype) => normalizeLabel(morphotype.label) === normalizedLabel);
    if (duplicate) {
      setSaveStatus({ type: "error", text: "Ya existe un morfotipo con ese nombre." });
      return;
    }

    if (morphotypeForm.colorHex && !/^#[0-9A-Fa-f]{6}$/.test(morphotypeForm.colorHex)) {
      setSaveStatus({ type: "error", text: "El color debe usar formato #RRGGBB." });
      return;
    }

    try {
      const payload: MorphotypeDraft = {
        annotationSetId: annotationSet.id,
        label: morphotypeForm.label.trim(),
        growthForm: morphotypeForm.growthForm as MorphotypeDraft["growthForm"],
        colorHex: morphotypeForm.colorHex || null,
        notes: morphotypeForm.notes.trim() || null,
      };

      const savedMorphotype = await upsertMorphotype(payload);
      setMorphotypes((current) => [...current, savedMorphotype]);
      setSelectedMorphotypeId(savedMorphotype.id);
      setMorphotypeForm({ label: "", growthForm: "unknown", colorHex: "", notes: "" });
      setSaveStatus({ type: "success", text: "Morfotipo creado correctamente." });
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo crear el morfotipo." });
    }
  };

  const handleDeleteMorphotype = async (morphotypeId: string) => {
    const isInUse = Object.values(pointStates).some((point) => point.morphotypeId === morphotypeId);
    if (isInUse) {
      setSaveStatus({ type: "error", text: "No se puede eliminar un morfotipo que ya está asociado a puntos." });
      return;
    }

    try {
      await deleteMorphotype(morphotypeId);
      setMorphotypes((current) => current.filter((morphotype) => morphotype.id !== morphotypeId));
      if (selectedMorphotypeId === morphotypeId) {
        setSelectedMorphotypeId(null);
      }
      setSaveStatus({ type: "success", text: "Morfotipo eliminado correctamente." });
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo eliminar el morfotipo." });
    }
  };

  return (
    <div>
      <PageHeader title="Anotaciones manuales" subtitle="Flujo inicial de conteo sistemático de puntos sobre imágenes guardadas." />

      <section className="mb-6 rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }}>
        <p className="text-sm">La versión 1 usa una cuadrícula sistemática, clasifica todos los puntos y estima cobertura de líquenes como lichen points / evaluable points × 100.</p>
        <p className="mt-2 text-sm">Un morfotipo visible no equivale necesariamente a una especie.</p>
      </section>

      {!selectedImageId ? (
        <section className="mb-6 rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h2 className="font-semibold" style={{ color: "var(--ld-text)" }}>Selecciona una imagen guardada</h2>
          {isLoadingImages ? <p className="mt-2 text-sm">Cargando imágenes...</p> : null}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {availableImages.map((image) => (
              <button key={image.id} type="button" onClick={() => handleSelectImage(image.id)} className="rounded border p-3 text-left" style={{ borderColor: "var(--ld-border)", background: "#fff" }}>
                <p className="font-medium" style={{ color: "var(--ld-text)" }}>{image.original_filename}</p>
                <p className="mt-1 text-sm" style={{ color: "var(--ld-text-secondary)" }}>{new Date(image.created_at).toLocaleString()}</p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selectedImageId && selectedImage ? (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_0.9fr]">
          <section className="rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold" style={{ color: "var(--ld-text)" }}>{selectedImage.original_filename}</h2>
                <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>{new Date(selectedImage.created_at).toLocaleString()}</p>
              </div>
              <button type="button" onClick={() => router.push("/annotations")} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
                Elegir otra imagen
              </button>
            </div>

            {isLoadingState ? <p className="mt-4 text-sm">Cargando anotación...</p> : null}

            <div className="mt-4 rounded border p-3" style={{ borderColor: "var(--ld-border)", background: "#fff" }}>
              <div className="mb-3 flex flex-wrap gap-2">
                <button type="button" onClick={handleToggleFullImage} className="rounded border px-3 py-2 text-sm" style={{ borderColor: isValidAnnotationRoi(roi) && isFullImageRoi(roi) ? "var(--ld-text)" : "var(--ld-border)", background: isValidAnnotationRoi(roi) && isFullImageRoi(roi) ? "var(--ld-sand)" : "#fff", color: "var(--ld-text)" }}>
                  Usar imagen completa
                </button>
                <button type="button" onClick={handleStartRoiSelection} className="rounded border px-3 py-2 text-sm" style={{ borderColor: selectionMode === "roi" || (isValidAnnotationRoi(roi) && !isFullImageRoi(roi)) ? "var(--ld-text)" : "var(--ld-border)", background: selectionMode === "roi" || (isValidAnnotationRoi(roi) && !isFullImageRoi(roi)) ? "var(--ld-sand)" : "#fff", color: "var(--ld-text)" }}>
                  Definir área de corteza
                </button>
                <button type="button" onClick={handleResetRoi} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
                  Reiniciar área
                </button>
              </div>

              <div ref={imageHostRef} className="relative overflow-hidden rounded border" style={{ borderColor: "var(--ld-border)" }}>
                {signedUrl ? (
                  <>
                    <Image
                      src={signedUrl}
                      alt={selectedImage.original_filename}
                      width={1200}
                      height={800}
                      className="block w-full object-contain"
                      unoptimized
                      onError={() => setImageLoadError(true)}
                    />
                    {imageLoadError ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/90 p-4 text-center text-sm">
                        <p>El navegador no pudo mostrar esta imagen. Usa una versión JPEG, PNG o WebP para la anotación si el archivo viene en HEIC/HEIF.</p>
                      </div>
                    ) : (
                      <svg viewBox="0 0 1 1" className="absolute inset-0 h-full w-full" onClick={handleImageClick} style={{ cursor: selectionMode === "roi" ? "crosshair" : "default" }}>
                        {roi.x != null && roi.y != null && roi.width != null && roi.height != null ? (
                          <rect x={roi.x} y={roi.y} width={roi.width} height={roi.height} fill="rgba(248, 113, 113, 0.1)" stroke="#ef4444" strokeWidth={0.003} />
                        ) : null}
                        {generatedPoints.map((point) => {
                          const localPoint = pointStates[point.pointIndex];
                          const fill = getCategoryColor(localPoint?.classification ?? null, morphotypes.find((morphotype) => morphotype.id === localPoint?.morphotypeId)?.color_hex ?? null);
                          return (
                            <circle key={point.pointIndex} cx={point.xNormalized} cy={point.yNormalized} r={0.012} fill={fill} stroke={localPoint?.classification == null ? "#111827" : "#ffffff"} strokeWidth={0.0015} onClick={() => void handlePointSelection(point)} style={{ cursor: "pointer" }} />
                          );
                        })}
                      </svg>
                    )}
                  </>
                ) : (
                  <div className="flex min-h-[320px] items-center justify-center text-sm" style={{ color: "var(--ld-text-secondary)" }}>Esperando URL firmada…</div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                <span className="rounded border px-2 py-1">ROI: {getRoiSummary(roi)}</span>
                <span className="rounded border px-2 py-1">Puntos: {generatedPoints.length}</span>
                {pendingRoiPoint ? <span className="rounded border px-2 py-1">Primer punto fijado…</span> : null}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
              <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>Herramienta de clasificación</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {CATEGORY_OPTIONS.map((option) => (
                  <button key={option.value} type="button" onClick={() => setSelectedClassification(option.value)} className="rounded border px-3 py-2 text-sm" style={{ borderColor: selectedClassification === option.value ? "var(--ld-text)" : "var(--ld-border)", background: selectedClassification === option.value ? "var(--ld-sand)" : "#fff" }}>
                    {option.label}
                  </button>
                ))}
                <button type="button" onClick={() => void handleClearSelectedPointClassification()} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
                  Limpiar clasificación
                </button>
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>Los puntos sin registro quedan como sin clasificar; unknown significa que sí se revisó y se eligió esa categoría.</p>
            </div>

            <div className="rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
              <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>Morfotipos</h3>
              <div className="mt-3 space-y-2">
                {morphotypes.map((morphotype) => (
                  <div key={morphotype.id} className="flex items-center justify-between rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }}>
                    <button type="button" onClick={() => setSelectedMorphotypeId(morphotype.id)} className="text-left" style={{ color: "var(--ld-text)" }}>
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ background: morphotype.color_hex ?? "#1d4ed8" }} />
                        <span>{morphotype.label}</span>
                      </div>
                      <p className="text-xs" style={{ color: "var(--ld-text-secondary)" }}>{morphotype.growth_form}</p>
                    </button>
                    <button type="button" onClick={() => void handleDeleteMorphotype(morphotype.id)} className="text-sm" style={{ color: "#b91c1c" }}>
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 rounded border p-3" style={{ borderColor: "var(--ld-border)" }}>
                <label className="mb-1 block text-sm font-medium" style={{ color: "var(--ld-text)" }} htmlFor="morphotype-label">Nombre</label>
                <input id="morphotype-label" value={morphotypeForm.label} onChange={(event) => setMorphotypeForm((current) => ({ ...current, label: event.target.value }))} className="w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }} />
                <label className="mt-2 mb-1 block text-sm font-medium" style={{ color: "var(--ld-text)" }} htmlFor="morphotype-growth">Forma de crecimiento</label>
                <select id="morphotype-growth" value={morphotypeForm.growthForm} onChange={(event) => setMorphotypeForm((current) => ({ ...current, growthForm: event.target.value as MorphotypeDraft["growthForm"] }))} className="w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}>
                  {GROWTH_FORMS.map((growthForm) => (
                    <option key={growthForm} value={growthForm}>{growthForm}</option>
                  ))}
                </select>
                <label className="mt-2 mb-1 block text-sm font-medium" style={{ color: "var(--ld-text)" }} htmlFor="morphotype-color">Color</label>
                <input id="morphotype-color" value={morphotypeForm.colorHex} onChange={(event) => setMorphotypeForm((current) => ({ ...current, colorHex: event.target.value }))} className="w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }} />
                <label className="mt-2 mb-1 block text-sm font-medium" style={{ color: "var(--ld-text)" }} htmlFor="morphotype-notes">Notas</label>
                <textarea id="morphotype-notes" rows={2} value={morphotypeForm.notes} onChange={(event) => setMorphotypeForm((current) => ({ ...current, notes: event.target.value }))} className="w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }} />
                <button type="button" onClick={() => void handleCreateMorphotype()} className="mt-3 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
                  Crear morfotipo
                </button>
              </div>
            </div>

            <div className="rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
              <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>Configuración de cuadrícula</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                  Filas
                  <input type="number" min={2} max={30} value={gridRows} onChange={(event) => setGridRows(Number(event.target.value))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }} />
                </label>
                <label className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                  Columnas
                  <input type="number" min={2} max={30} value={gridColumns} onChange={(event) => setGridColumns(Number(event.target.value))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }} />
                </label>
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>La cuadrícula se genera en el centro de cada celda dentro del ROI activo.</p>
            </div>

            <div className="rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
              <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>Resumen en tiempo real</h3>
              <div className="mt-3 grid gap-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                <p>Puntos totales: {stats.totalPoints}</p>
                <p>Puntos clasificados: {stats.classifiedPoints}</p>
                <p>Puntos sin clasificar: {stats.unclassifiedPoints}</p>
                <p>Puntos evaluables: {stats.evaluablePoints}</p>
                <p>Puntos excluidos: {stats.excludedPoints}</p>
                <p>Puntos de liquen: {stats.lichenPoints}</p>
                <p>Morfotipos visibles utilizados: {stats.visibleMorphotypes}</p>
                <p>Cobertura estimada de líquenes: {stats.lichenCoverage == null ? "Datos insuficientes" : `${stats.lichenCoverage.toFixed(1)}%`}</p>
              </div>
            </div>

            <div className="rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
              <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>Guardado</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void handleSaveDraft()} disabled={isSaving || !selectedImageId} className="rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
                  Guardar borrador
                </button>
                <button type="button" onClick={() => void handleCompleteAnnotation()} disabled={isCompleting || !selectedImageId} className="rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
                  Completar anotación
                </button>
                <button type="button" onClick={() => void handleUndoLastChange()} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
                  Deshacer último cambio
                </button>
              </div>
              {saveStatus ? <p className={`mt-3 text-sm ${saveStatus.type === "error" ? "text-red-700" : saveStatus.type === "success" ? "text-emerald-700" : "text-slate-700"}`}>{saveStatus.text}</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import {
  completeAnnotationSet,
  deleteAnnotationPoint,
  deleteMorphotype,
  ensureAnnotationSetForImage,
  getImageRecord,
  getSignedImageUrl,
  listAccessibleImages,
  loadAnnotationState,
  upsertAnnotationPoint,
  upsertAnnotationSet,
  upsertMorphotype,
  isValidAnnotationRoi,
  type AnnotationMethod,
  type AnnotationPointClassification,
  type AnnotationPointConfidenceLevel,
  type AnnotationPointDraft,
  type AnnotationSetDraft,
  type AnnotationSetRow,
  type MorphotypeDraft,
  type MorphotypeRow,
  type AccessibleImageRecord,
} from "@/modules/annotations/client";
import AiLayersWorkflow from "@/modules/annotations/AiLayersWorkflow";
import VisionLab from "@/modules/vision-lab/VisionLab";

export type AnnotationTool = "manual" | "ai" | "layers";

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
  kind: "create" | "move" | "classify" | "delete";
  previousPoint: LocalPointState | null;
  nextPoint: LocalPointState | null;
}

interface SaveStatus {
  type: "info" | "success" | "error";
  text: string;
}

interface DragState {
  pointIndex: number;
  pointerId: number;
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

function getClassificationAbbreviation(classification: AnnotationPointClassification | null) {
  if (classification === null) return "?";
  if (classification === "lichen") return "L";
  if (classification === "bark") return "C";
  if (classification === "moss") return "M";
  if (classification === "algae") return "A";
  if (classification === "shadow") return "S";
  if (classification === "glare") return "R";
  return "U";
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

function clampNormalized(value: number) {
  return Math.min(1, Math.max(0, value));
}

function getNextAvailablePointIndex(existingPoints: Record<number, LocalPointState>) {
  let candidate = 1;
  while (existingPoints[candidate]) {
    candidate += 1;
  }
  return candidate;
}

interface AnnotationsWorkflowProps {
  initialImageId?: string | null;
  initialTool?: AnnotationTool;
}

export default function AnnotationsWorkflow({ initialImageId = null, initialTool = "manual" }: AnnotationsWorkflowProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const imageIdParam = searchParams.get("imageId") ?? initialImageId;

  const [activeTool, setActiveTool] = useState<AnnotationTool>(initialTool);
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
  const [annotationMode, setAnnotationMode] = useState<AnnotationMethod>("manual_free_points");
  const [pendingRoiPoint, setPendingRoiPoint] = useState<PendingRoiPoint | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPointState | null>(null);
  const [selectedClassification, setSelectedClassification] = useState<AnnotationPointClassification>("lichen");
  const [selectedMorphotypeId, setSelectedMorphotypeId] = useState<string | null>(null);
  const [morphotypeForm, setMorphotypeForm] = useState<{ label: string; growthForm: MorphotypeDraft["growthForm"]; colorHex: string; notes: string }>({ label: "", growthForm: "unknown", colorHex: "", notes: "" });
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [lastActionStack, setLastActionStack] = useState<ActionRecord[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const imageHostRef = useRef<HTMLDivElement | null>(null);
  const imageLoadRequestIdRef = useRef(0);

  const loadAvailableImages = useCallback(async () => {
    imageLoadRequestIdRef.current += 1;
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
    setAnnotationMode("manual_free_points");
    setPendingRoiPoint(null);
    setSelectedPoint(null);
    setImageLoadError(false);
    setIsLoadingState(false);
    setIsSaving(false);
    setIsCompleting(false);
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
    const requestId = imageLoadRequestIdRef.current + 1;
    imageLoadRequestIdRef.current = requestId;
    setIsLoadingState(true);
    setSaveStatus(null);
    setSelectedImageId(imageId);
    setSelectedImage(null);
    setSignedUrl(null);
    setAnnotationSet(null);
    setMorphotypes([]);
    setPointStates({});
    setIsSaving(false);
    setIsCompleting(false);

    try {
      const image = await getImageRecord(imageId);
      if (requestId !== imageLoadRequestIdRef.current) return;
      if (!image) {
        setSaveStatus({ type: "error", text: "No se encontró la imagen seleccionada." });
        return;
      }

      const signed = await getSignedImageUrl(image.storage_path);
      const state = await loadAnnotationState(imageId);
      const activeAnnotationSet = state.annotationSet ?? await ensureAnnotationSetForImage(imageId, {
        method: "manual_free_points",
        status: "draft",
        gridRows: 10,
        gridColumns: 10,
        roiX: 0,
        roiY: 0,
        roiWidth: 1,
        roiHeight: 1,
      });
      if (requestId !== imageLoadRequestIdRef.current) return;

      setSelectedImage(image);
      setSignedUrl(signed);
      setImageLoadError(false);
      setAnnotationSet(activeAnnotationSet);
      setMorphotypes(state.morphotypes);
      setGridRows(activeAnnotationSet.grid_rows ?? 10);
      setGridColumns(activeAnnotationSet.grid_columns ?? 10);
      setRoi({
        x: activeAnnotationSet.roi_x ?? 0,
        y: activeAnnotationSet.roi_y ?? 0,
        width: activeAnnotationSet.roi_width ?? 1,
        height: activeAnnotationSet.roi_height ?? 1,
      });
      setAnnotationMode((activeAnnotationSet.method as AnnotationMethod | undefined) ?? "manual_free_points");

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
      if (requestId === imageLoadRequestIdRef.current) {
        setSaveStatus({ type: "error", text: "No se pudo cargar la anotación de esta imagen." });
      }
    } finally {
      if (requestId === imageLoadRequestIdRef.current) {
        setIsLoadingState(false);
      }
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

  const pointEntries = useMemo(() => Object.values(pointStates), [pointStates]);

  const systematicStats = useMemo(() => {
    const classifiedPoints = pointEntries.filter((point) => point.classification != null).length;
    const totalPoints = generatedPoints.length;
    const unclassifiedPoints = totalPoints - classifiedPoints;
    const evaluablePoints = pointEntries.filter((point) => point.classification === "lichen" || point.classification === "bark" || point.classification === "moss" || point.classification === "algae").length;
    const excludedPoints = pointEntries.filter((point) => point.classification === "shadow" || point.classification === "glare" || point.classification === "unknown").length;
    const lichenPoints = pointEntries.filter((point) => point.classification === "lichen").length;
    const visibleMorphotypeIds = new Set(pointEntries.filter((point) => point.classification === "lichen" && point.morphotypeId).map((point) => point.morphotypeId));
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
  }, [generatedPoints.length, pointEntries]);

  const freeStats = useMemo(() => {
    const existingPointsCount = pointEntries.length;
    const classifiedPoints = pointEntries.filter((point) => point.classification != null).length;
    const unclassifiedPoints = pointEntries.filter((point) => point.classification == null).length;
    const evaluablePoints = pointEntries.filter((point) => point.classification === "lichen" || point.classification === "bark" || point.classification === "moss" || point.classification === "algae").length;
    const excludedPoints = pointEntries.filter((point) => point.classification === "shadow" || point.classification === "glare" || point.classification === "unknown").length;
    const lichenPoints = pointEntries.filter((point) => point.classification === "lichen").length;
    const visibleMorphotypeIds = new Set(pointEntries.filter((point) => point.classification === "lichen" && point.morphotypeId).map((point) => point.morphotypeId));

    return {
      totalPoints: existingPointsCount,
      classifiedPoints,
      unclassifiedPoints,
      evaluablePoints,
      excludedPoints,
      lichenPoints,
      visibleMorphotypes: visibleMorphotypeIds.size,
    };
  }, [pointEntries]);

  const stats = annotationMode === "manual_free_points" ? freeStats : systematicStats;

  const systematicCanComplete = generatedPoints.length > 0 && systematicStats.unclassifiedPoints === 0 && systematicStats.evaluablePoints > 0;
  const freeCanComplete = freeStats.totalPoints > 0 && freeStats.unclassifiedPoints === 0 && pointEntries.every((point) => point.classification !== "lichen" || Boolean(point.morphotypeId));
  const canComplete = annotationMode === "manual_free_points" ? freeCanComplete : systematicCanComplete;

  const completionHint = annotationMode === "manual_free_points"
    ? freeCanComplete
      ? "Listo para completar."
      : "Añade al menos un punto clasificado y asegúrate de que cada liquen tenga morfotipo."
    : systematicCanComplete
      ? "Listo para completar."
      : "Completa todos los puntos del muestreo y deja al menos un punto evaluable.";

  const confirmStateChange = useCallback((message: string) => {
    if (pointEntries.length === 0) {
      return true;
    }

    return window.confirm(message);
  }, [pointEntries.length]);

  const handleSelectImage = (imageId: string) => {
    router.push(`/annotations?imageId=${imageId}&tool=${activeTool}`);
  };

  const handleToggleFullImage = () => {
    if (!confirmStateChange("Cambiar el ROI descartará las clasificaciones locales actuales. ¿Deseas continuar?")) {
      return;
    }

    setRoi({ x: null, y: null, width: null, height: null });
    setSelectionMode("full");
    setPendingRoiPoint(null);
    setPointStates({});
    setLastActionStack([]);
    setSelectedPoint(null);
    setSaveStatus({ type: "info", text: "Se ha restaurado la imagen completa y se han descartado las clasificaciones locales." });
  };

  const handleStartRoiSelection = () => {
    setSelectionMode("roi");
    setPendingRoiPoint(null);
    setSaveStatus(null);
  };

  const handleResetRoi = () => {
    if (!confirmStateChange("Reiniciar el ROI descartará las clasificaciones locales actuales. ¿Deseas continuar?")) {
      return;
    }

    setRoi({ x: 0, y: 0, width: 1, height: 1 });
    setPendingRoiPoint(null);
    setPointStates({});
    setLastActionStack([]);
    setSelectedPoint(null);
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

  const persistPoint = useCallback(async (pointState: LocalPointState) => {
    if (!annotationSet?.id) {
      return pointState;
    }

    const payload: AnnotationPointDraft = {
      id: pointState.id ?? undefined,
      annotationSetId: annotationSet.id,
      pointIndex: pointState.pointIndex,
      xNormalized: pointState.xNormalized,
      yNormalized: pointState.yNormalized,
      classification: pointState.classification ?? "unknown",
      confidenceLevel: pointState.confidenceLevel,
      morphotypeId: pointState.classification === "lichen" ? pointState.morphotypeId : null,
      notes: null,
    };

    const savedPoint = await upsertAnnotationPoint(payload);
    return { ...pointState, id: savedPoint.id };
  }, [annotationSet]);

  const handleSwitchMode = async (nextMode: AnnotationMethod) => {
    if (annotationMode === nextMode) {
      return;
    }

    if (!confirmStateChange("Cambiar de modo descartará los puntos y clasificaciones actuales. ¿Deseas continuar?")) {
      return;
    }

    setAnnotationMode(nextMode);
    setPointStates({});
    setLastActionStack([]);
    setSelectedPoint(null);
    setSaveStatus({ type: "info", text: nextMode === "manual_free_points" ? "Modo cambiado a marcación libre." : "Modo cambiado a cuadrícula sistemática." });
  };

  const applyClassificationToPoint = useCallback(async (point: SelectedPointState | { pointIndex: number; xNormalized: number; yNormalized: number }, classification: AnnotationPointClassification) => {
    if (!selectedImageId) {
      return;
    }

    if (classification === "lichen" && !selectedMorphotypeId) {
      setSaveStatus({ type: "error", text: "Selecciona un morfotipo antes de clasificar un punto como líquen." });
      return;
    }

    const existing = pointStates[point.pointIndex];
    const previousPoint = existing ? { ...existing } : null;
    const nextMorphotypeId = classification === "lichen" ? selectedMorphotypeId : null;
    const nextPoint: LocalPointState = {
      pointIndex: point.pointIndex,
      classification,
      confidenceLevel: "medium",
      morphotypeId: nextMorphotypeId,
      id: existing?.id ?? null,
      xNormalized: point.xNormalized,
      yNormalized: point.yNormalized,
    };

    setPointStates((current) => ({ ...current, [point.pointIndex]: nextPoint }));
    setLastActionStack((current) => {
      const action: ActionRecord = { pointIndex: point.pointIndex, kind: "classify", previousPoint, nextPoint };
      return [action, ...current].slice(0, 20);
    });
    setSelectedPoint({ pointIndex: point.pointIndex, xNormalized: point.xNormalized, yNormalized: point.yNormalized });
    setSaveStatus({ type: "info", text: "Clasificación aplicada." });

    try {
      const savedPoint = await persistPoint(nextPoint);
      setPointStates((current) => ({ ...current, [point.pointIndex]: { ...current[point.pointIndex], id: savedPoint.id } }));
      setSaveStatus({ type: "success", text: "Clasificación actualizada correctamente." });
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo persistir la clasificación. Puedes reintentar." });
    }
  }, [persistPoint, pointStates, selectedImageId, selectedMorphotypeId]);

  const handlePointSelection = async (point: { pointIndex: number; xNormalized: number; yNormalized: number }) => {
    if (!selectedImageId) {
      return;
    }

    if (annotationMode === "manual_free_points") {
      setSelectedPoint(point);
      setSaveStatus(null);
      return;
    }

    await applyClassificationToPoint(point, selectedClassification);
  };

  const handleApplyClassificationToSelectedPoint = async (classification: AnnotationPointClassification) => {
    if (!selectedPoint) {
      setSelectedClassification(classification);
      setSaveStatus({ type: "info", text: "Selecciona un punto para aplicar la clasificación." });
      return;
    }

    if (annotationMode === "manual_free_points") {
      await applyClassificationToPoint(selectedPoint, classification);
      return;
    }

    setSelectedClassification(classification);
  };

  const handleDeleteSelectedPoint = async () => {
    if (!selectedPoint || !selectedImageId) {
      setSaveStatus({ type: "error", text: "Selecciona un punto antes de eliminarlo." });
      return;
    }

    const existing = pointStates[selectedPoint.pointIndex];
    if (!existing) {
      setSaveStatus({ type: "info", text: "El punto ya no existe." });
      return;
    }

    const previousPoint = { ...existing };
    setPointStates((current) => {
      const next = { ...current };
      delete next[selectedPoint.pointIndex];
      return next;
    });
    setLastActionStack((current) => {
      const action: ActionRecord = { pointIndex: selectedPoint.pointIndex, kind: "delete", previousPoint, nextPoint: null };
      return [action, ...current].slice(0, 20);
    });
    setSelectedPoint(null);
    setSaveStatus({ type: "info", text: "Punto eliminado localmente." });

    try {
      if (existing.id) {
        await deleteAnnotationPoint(existing.id);
      }
      setSaveStatus({ type: "success", text: "Punto eliminado correctamente." });
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo eliminar el punto. Puedes reintentar." });
    }
  };

  const handleClearSelectedPointClassification = async () => {
    if (!selectedPoint || !selectedImageId) {
      setSaveStatus({ type: "error", text: "Selecciona un punto antes de limpiar su clasificación." });
      return;
    }

    const existing = pointStates[selectedPoint.pointIndex];
    if (!existing) {
      setSaveStatus({ type: "info", text: "El punto ya no existe." });
      return;
    }

    if (annotationMode === "manual_free_points") {
      await handleDeleteSelectedPoint();
      return;
    }

    const previousPoint = { ...existing };
    const clearedPoint: LocalPointState = { ...existing, classification: null, morphotypeId: null, id: existing.id ?? null };
    setPointStates((current) => ({ ...current, [selectedPoint.pointIndex]: clearedPoint }));
    setLastActionStack((current) => {
      const action: ActionRecord = { pointIndex: selectedPoint.pointIndex, kind: "classify", previousPoint, nextPoint: clearedPoint };
      return [action, ...current].slice(0, 20);
    });
    setSaveStatus({ type: "info", text: "Clasificación limpiada localmente." });

    try {
      const savedPoint = await persistPoint(clearedPoint);
      setPointStates((current) => ({ ...current, [selectedPoint.pointIndex]: { ...current[selectedPoint.pointIndex], id: savedPoint.id } }));
      setSaveStatus({ type: "success", text: "Clasificación limpiada correctamente." });
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo limpiar la clasificación del punto." });
    }
  };

  const handleUndoLastChange = async () => {
    if (lastActionStack.length === 0) {
      return;
    }

    const action = lastActionStack[0];
    const restoredPoint = action.previousPoint ? { ...action.previousPoint } : null;

    setPointStates((current) => {
      const next = { ...current };
      if (restoredPoint) {
        next[action.pointIndex] = restoredPoint;
      } else {
        delete next[action.pointIndex];
      }
      return next;
    });

    setLastActionStack((current) => current.slice(1));
    setSaveStatus({ type: "info", text: "Se ha deshecho el último cambio local." });

    try {
      if (action.kind === "delete" && restoredPoint?.id) {
        const payload: AnnotationPointDraft = {
          id: restoredPoint.id,
          annotationSetId: annotationSet?.id ?? "",
          pointIndex: restoredPoint.pointIndex,
          xNormalized: restoredPoint.xNormalized,
          yNormalized: restoredPoint.yNormalized,
          classification: restoredPoint.classification ?? "unknown",
          confidenceLevel: restoredPoint.confidenceLevel,
          morphotypeId: restoredPoint.classification === "lichen" ? restoredPoint.morphotypeId : null,
          notes: null,
        };
        const savedPoint = await upsertAnnotationPoint(payload);
        setPointStates((current) => ({ ...current, [action.pointIndex]: { ...current[action.pointIndex], id: savedPoint.id } }));
      } else if (action.kind === "create" && action.nextPoint) {
        if (action.nextPoint.id) {
          await deleteAnnotationPoint(action.nextPoint.id);
        }
      } else if (action.kind === "classify" || action.kind === "move") {
        if (restoredPoint) {
          const savedPoint = await persistPoint(restoredPoint);
          setPointStates((current) => ({ ...current, [action.pointIndex]: { ...current[action.pointIndex], id: savedPoint.id } }));
        }
      }
      setSaveStatus({ type: "success", text: "Se ha deshecho el último cambio." });
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo deshacer el último cambio." });
    }
  };

  const handleCreateFreePoint = useCallback(async (xNormalized: number, yNormalized: number) => {
    if (!selectedImageId) {
      return;
    }

    if (selectedClassification === "lichen" && !selectedMorphotypeId) {
      setSaveStatus({ type: "error", text: "Selecciona un morfotipo antes de crear un punto de líquen." });
      return;
    }

    const pointIndex = getNextAvailablePointIndex(pointStates);
    const nextPoint: LocalPointState = {
      pointIndex,
      classification: selectedClassification,
      confidenceLevel: "medium",
      morphotypeId: selectedClassification === "lichen" ? selectedMorphotypeId : null,
      id: null,
      xNormalized: clampNormalized(xNormalized),
      yNormalized: clampNormalized(yNormalized),
    };

    setPointStates((current) => ({ ...current, [pointIndex]: nextPoint }));
    setLastActionStack((current) => {
      const action: ActionRecord = { pointIndex, kind: "create", previousPoint: null, nextPoint };
      return [action, ...current].slice(0, 20);
    });
    setSelectedPoint({ pointIndex, xNormalized: nextPoint.xNormalized, yNormalized: nextPoint.yNormalized });
    setSaveStatus({ type: "info", text: "Punto creado localmente." });

    try {
      const savedPoint = await persistPoint(nextPoint);
      setPointStates((current) => ({ ...current, [pointIndex]: { ...current[pointIndex], id: savedPoint.id } }));
      setSaveStatus({ type: "success", text: "Punto creado correctamente." });
    } catch {
      setSaveStatus({ type: "error", text: "No se pudo crear el punto. Puedes reintentar." });
    }
  }, [persistPoint, pointStates, selectedClassification, selectedImageId, selectedMorphotypeId]);

  const handleCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!imageHostRef.current || selectionMode === "roi") {
      return;
    }

    if (annotationMode !== "manual_free_points") {
      return;
    }

    const bounds = imageHostRef.current.getBoundingClientRect();
    const xNormalized = clampNormalized((event.clientX - bounds.left) / bounds.width);
    const yNormalized = clampNormalized((event.clientY - bounds.top) / bounds.height);
    void handleCreateFreePoint(xNormalized, yNormalized);
  };

  const handlePointPointerDown = (event: React.PointerEvent<SVGCircleElement>, point: { pointIndex: number; xNormalized: number; yNormalized: number }) => {
    event.stopPropagation();

    if (annotationMode !== "manual_free_points") {
      setSaveStatus({ type: "info", text: "Los puntos de la cuadrícula sistemática son fijos para evitar sesgo." });
      return;
    }

    setSelectedPoint(point);
    setDragState({ pointIndex: point.pointIndex, pointerId: event.pointerId });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCanvasPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragState || annotationMode !== "manual_free_points") {
      return;
    }

    if (!imageHostRef.current) {
      return;
    }

    const bounds = imageHostRef.current.getBoundingClientRect();
    const xNormalized = clampNormalized((event.clientX - bounds.left) / bounds.width);
    const yNormalized = clampNormalized((event.clientY - bounds.top) / bounds.height);

    setPointStates((current) => {
      const existing = current[dragState.pointIndex];
      if (!existing) {
        return current;
      }
      const nextPoint = { ...existing, xNormalized, yNormalized };
      return { ...current, [dragState.pointIndex]: nextPoint };
    });
    setSelectedPoint({ pointIndex: dragState.pointIndex, xNormalized, yNormalized });
  };

  const handleCanvasPointerUp = async (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragState || annotationMode !== "manual_free_points") {
      return;
    }

    const currentPoint = pointStates[dragState.pointIndex];
    if (currentPoint) {
      try {
        const previousPoint = { ...currentPoint };
        const nextPoint = { ...currentPoint, xNormalized: currentPoint.xNormalized, yNormalized: currentPoint.yNormalized };
        setLastActionStack((current) => {
          const action: ActionRecord = { pointIndex: currentPoint.pointIndex, kind: "move", previousPoint, nextPoint };
          return [action, ...current].slice(0, 20);
        });
        const savedPoint = await persistPoint(nextPoint);
        setPointStates((currentMap) => ({ ...currentMap, [dragState.pointIndex]: { ...currentMap[dragState.pointIndex], id: savedPoint.id } }));
        setSaveStatus({ type: "success", text: "Punto movido correctamente." });
      } catch {
        setSaveStatus({ type: "error", text: "No se pudo guardar la nueva posición del punto." });
      }
    }

    setDragState(null);
    event.currentTarget.releasePointerCapture?.(dragState.pointerId);
  };

  const persistAnnotationSet = async (status: "draft" | "completed") => {
    if (!selectedImageId) {
      return;
    }

    const requestId = imageLoadRequestIdRef.current;
    setIsSaving(true);
    setSaveStatus({ type: "info", text: "Guardando anotación..." });

    try {
      const annotationDraft: AnnotationSetDraft = {
        imageId: selectedImageId,
        method: annotationMode,
        gridRows,
        gridColumns,
        roiX: roi.x,
        roiY: roi.y,
        roiWidth: roi.width,
        roiHeight: roi.height,
        status,
        notes: status === "completed" ? (annotationMode === "manual_free_points" ? "Marcación libre para registrar ocurrencias y morfotipos." : "Estimación visual basada en el método de conteo sistemático de puntos.") : null,
      };

      const nextAnnotationSet = await upsertAnnotationSet(annotationDraft);
      if (requestId !== imageLoadRequestIdRef.current) return;
      setAnnotationSet(nextAnnotationSet);
      setSaveStatus({ type: "success", text: status === "completed" ? "Anotación completada correctamente." : "Borrador guardado correctamente." });
    } catch {
      if (requestId === imageLoadRequestIdRef.current) {
        setSaveStatus({ type: "error", text: "No se pudo guardar la anotación. Puedes reintentar." });
      }
    } finally {
      if (requestId === imageLoadRequestIdRef.current) {
        setIsSaving(false);
      }
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

    if (!canComplete) {
      setSaveStatus({ type: "error", text: annotationMode === "manual_free_points" ? "Completa la anotación con al menos un punto clasificado y todos los líquenes con morfotipo." : "Completa la anotación solo cuando todos los puntos estén clasificados y al menos uno sea evaluable." });
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
    const isInUse = pointEntries.some((point) => point.morphotypeId === morphotypeId);
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
      <PageHeader title="Anotaciones" subtitle="Marcación manual y segmentación asistida con MobileSAM para imágenes guardadas." />

      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Herramientas de anotación">
        {([
          ["manual", "Manual"],
          ["ai", "Asistencia IA"],
          ["layers", "Capas"],
        ] as const).map(([tool, label]) => (
          <button
            key={tool}
            type="button"
            aria-pressed={activeTool === tool}
            onClick={() => setActiveTool(tool)}
            className="rounded border px-4 py-2 text-sm font-medium"
            style={{
              borderColor: activeTool === tool ? "var(--ld-text)" : "var(--ld-border)",
              background: activeTool === tool ? "var(--ld-sand)" : "var(--ld-card)",
              color: "var(--ld-text)",
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTool === "manual" ? <section className="mb-6 rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border px-3 py-1 text-sm" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
            Modo activo: {annotationMode === "manual_free_points" ? "Marcación libre" : "Cuadrícula sistemática"}
          </span>
          <span className="rounded-full border px-3 py-1 text-sm" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
            {annotationMode === "manual_free_points" ? "Puntos móviles y libres" : "Puntos fijos para evitar sesgo"}
          </span>
        </div>
        <p className="mt-3 text-sm">{annotationMode === "manual_free_points" ? "La marcación libre sirve para registrar ocurrencias y morfotipos; no produce una estimación no sesgada de cobertura." : "La cuadrícula systemic usa puntos fijos dentro del ROI para producir una estimación de cobertura."}</p>
      </section> : null}

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

      {selectedImageId && selectedImage && activeTool === "manual" ? (
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
                <button type="button" onClick={() => void handleSwitchMode("manual_free_points")} className="rounded border px-3 py-2 text-sm" style={{ borderColor: annotationMode === "manual_free_points" ? "var(--ld-text)" : "var(--ld-border)", background: annotationMode === "manual_free_points" ? "var(--ld-sand)" : "#fff", color: "var(--ld-text)" }}>
                  Marcación libre
                </button>
                <button type="button" onClick={() => void handleSwitchMode("systematic_point_count")} className="rounded border px-3 py-2 text-sm" style={{ borderColor: annotationMode === "systematic_point_count" ? "var(--ld-text)" : "var(--ld-border)", background: annotationMode === "systematic_point_count" ? "var(--ld-sand)" : "#fff", color: "var(--ld-text)" }}>
                  Cuadrícula sistemática
                </button>
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
                      <svg
                        viewBox="0 0 1 1"
                        className="absolute inset-0 h-full w-full"
                        onClick={handleImageClick}
                        onPointerDown={handleCanvasPointerDown}
                        onPointerMove={handleCanvasPointerMove}
                        onPointerUp={handleCanvasPointerUp}
                        style={{ cursor: selectionMode === "roi" ? "crosshair" : annotationMode === "manual_free_points" ? "crosshair" : "default" }}
                      >
                        {roi.x != null && roi.y != null && roi.width != null && roi.height != null ? (
                          <rect x={roi.x} y={roi.y} width={roi.width} height={roi.height} fill="rgba(248, 113, 113, 0.1)" stroke="#ef4444" strokeWidth={0.003} />
                        ) : null}
                        {annotationMode === "manual_free_points"
                          ? pointEntries.map((point) => {
                              const isSelected = selectedPoint?.pointIndex === point.pointIndex;
                              const fill = getCategoryColor(point.classification, morphotypes.find((morphotype) => morphotype.id === point.morphotypeId)?.color_hex ?? null);
                              const radius = isSelected ? 0.014 : 0.011;
                              return (
                                <g key={point.pointIndex}>
                                  <circle
                                    cx={point.xNormalized}
                                    cy={point.yNormalized}
                                    r={radius}
                                    fill={fill}
                                    stroke={isSelected ? "#0f172a" : "#ffffff"}
                                    strokeWidth={isSelected ? 0.0025 : 0.0015}
                                    onPointerDown={(event) => handlePointPointerDown(event, point)}
                                  />
                                  <text x={point.xNormalized} y={point.yNormalized + 0.0015} textAnchor="middle" fontSize="0.0085" fill="#fff" fontWeight="700">
                                    {getClassificationAbbreviation(point.classification)}
                                  </text>
                                </g>
                              );
                            })
                          : generatedPoints.map((point) => {
                              const localPoint = pointStates[point.pointIndex];
                              const fill = getCategoryColor(localPoint?.classification ?? null, morphotypes.find((morphotype) => morphotype.id === localPoint?.morphotypeId)?.color_hex ?? null);
                              return (
                                <circle
                                  key={point.pointIndex}
                                  cx={point.xNormalized}
                                  cy={point.yNormalized}
                                  r={0.012}
                                  fill={fill}
                                  stroke={localPoint?.classification == null ? "#111827" : "#ffffff"}
                                  strokeWidth={0.0015}
                                  onClick={() => void handlePointSelection(point)}
                                  style={{ cursor: "pointer" }}
                                />
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
                <span className="rounded border px-2 py-1">Puntos: {annotationMode === "manual_free_points" ? stats.totalPoints : generatedPoints.length}</span>
                {pendingRoiPoint ? <span className="rounded border px-2 py-1">Primer punto fijado…</span> : null}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
              <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>Herramienta de clasificación</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {CATEGORY_OPTIONS.map((option) => (
                  <button key={option.value} type="button" onClick={() => void handleApplyClassificationToSelectedPoint(option.value)} className="rounded border px-3 py-2 text-sm" style={{ borderColor: selectedClassification === option.value ? "var(--ld-text)" : "var(--ld-border)", background: selectedClassification === option.value ? "var(--ld-sand)" : "#fff" }}>
                    {option.label}
                  </button>
                ))}
                <button type="button" onClick={() => void handleClearSelectedPointClassification()} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
                  Limpiar clasificación
                </button>
                <button type="button" onClick={() => void handleDeleteSelectedPoint()} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)", color: "#b91c1c" }}>
                  Eliminar punto
                </button>
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>{annotationMode === "manual_free_points" ? "En marcación libre, los puntos se crean y se mueven libremente. El punto seleccionado cambie de color para indicar que está activo." : "Los puntos de la cuadrícula sistemática son fijos; si intentas moverlos verás un aviso breve."}</p>
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
                <p>Puntos: {stats.totalPoints}</p>
                <p>Categorías visibles: {stats.classifiedPoints}</p>
                <p>Morfotipos visibles: {stats.visibleMorphotypes}</p>
                {annotationMode === "systematic_point_count" ? (
                  <>
                    <p>Puntos sin clasificar: {stats.unclassifiedPoints}</p>
                    <p>Puntos evaluables: {stats.evaluablePoints}</p>
                    <p>Puntos excluidos: {stats.excludedPoints}</p>
                    <p>Cobertura estimada de líquenes: {systematicStats.lichenCoverage == null ? "Datos insuficientes" : `${systematicStats.lichenCoverage.toFixed(1)}%`}</p>
                  </>
                ) : null}
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
              <p className="mt-3 text-sm" style={{ color: "var(--ld-text-secondary)" }}>{completionHint}</p>
              {saveStatus ? <p className={`mt-3 text-sm ${saveStatus.type === "error" ? "text-red-700" : saveStatus.type === "success" ? "text-emerald-700" : "text-slate-700"}`}>{saveStatus.text}</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {selectedImageId && selectedImage && activeTool === "ai" ? (
        <section className="rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h2 className="font-semibold" style={{ color: "var(--ld-text)" }}>Asistencia IA</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>Usa MobileSAM para crear capas asociadas a la imagen y al conjunto de anotación actuales.</p>
          <div className="mt-4 rounded border p-3" style={{ borderColor: "var(--ld-border)", background: "#fff" }}>
            <VisionLab
              embedded
              imageId={selectedImageId}
              annotationSetId={annotationSet?.id ?? null}
              morphotypes={morphotypes}
              onMorphotypesChange={setMorphotypes}
            />
          </div>
        </section>
      ) : null}

      {selectedImageId && selectedImage && activeTool === "layers" ? (
        annotationSet ? <AiLayersWorkflow imageId={selectedImageId} annotationSetId={annotationSet.id} /> : <p className="text-sm">Cargando conjunto de anotación…</p>
      ) : null}
    </div>
  );
}

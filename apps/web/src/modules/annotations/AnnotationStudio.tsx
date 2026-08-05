"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Stage } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  ANNOTATION_REGION_CLASSES,
  createMorphotypeForAnnotationSet,
  createTemporaryUrl,
  deleteRegionWithStorage,
  loadAiAnnotationState,
  saveAcceptedRegion,
  updateRegionClassification,
  type AnnotationRegionClassification,
  type AnnotationRegionRow,
  type AnnotationRegionSource,
  type MorphotypeRow,
  type RegionSaveInput,
} from "@/modules/annotations/regions";
import { upsertMorphotype } from "@/modules/annotations/client";
import {
  createRoiMask,
  createWorkingImage,
  drawMask,
  loadCrossOriginImage,
  loadMaskFromUrl,
  maskToPngBlob,
  polygonArea,
  rasterizePolygon,
  rgbToHex,
  sampleMedianRgb,
  type MaskPoint,
  type WorkingImage,
} from "@/modules/annotations/studio-browser-utils";
import { calculateCoverage, calculateMaskArea } from "@/modules/annotations/studio-mask-utils";
import type {
  ColorWorkerRequest,
  ColorWorkerResponse,
  SimilarColorComponent,
} from "@/modules/annotations/color-worker-types";

const MAX_WORKING_DIMENSION = 1024;
const SEGMENT_DEBOUNCE_MS = 250;
const COLOR_DEBOUNCE_MS = 250;
const MAX_HISTORY_ENTRIES = 25;
const MAX_HISTORY_BYTES = 12 * 1024 * 1024;
const TRUNK_NOTE = "Tronco evaluable";
const COLOR_WORKER_URL = new URL("./color-selection.worker.ts", import.meta.url);

type StudioTool = "select" | "ai" | "lasso" | "brush" | "eraser" | "eyedropper" | "similar";
type CandidateTarget = "trunk" | "region";

interface PointPrompt {
  x: number;
  y: number;
  label: 0 | 1;
}

interface MobileSamCandidate {
  id: string;
  score: number;
  maskDataUrl: string;
  width: number;
  height: number;
  areaPixels: number;
  modelName: string;
  modelVersion: string | null;
}

interface CandidateMetadata {
  source: AnnotationRegionSource;
  score: number | null;
  modelName: string;
  modelVersion: string | null;
  representativeColorHex: string | null;
  colorToleranceDeltaE: number | null;
}

interface StudioLayer {
  region: AnnotationRegionRow;
  visible: boolean;
  opacity: number;
  title: string;
}

interface MaskPatchHistory {
  kind: "mask";
  indices: Uint32Array;
  before: Uint8Array;
  after: Uint8Array;
}

interface PointsHistory {
  kind: "points";
  before: PointPrompt[];
  after: PointPrompt[];
}

interface VisibilityHistory {
  kind: "visibility";
  layerId: string;
  before: boolean;
  after: boolean;
}

interface LayerAddHistory {
  kind: "layer-add";
  layer: StudioLayer;
  saveInput: RegionSaveInput;
}

type HistoryEntry = MaskPatchHistory | PointsHistory | VisibilityHistory | LayerAddHistory;

interface StrokeState {
  value: 0 | 1;
  before: Map<number, number>;
  previousPoint: MaskPoint;
}

interface AnnotationStudioProps {
  imageUrl: string;
  imageName: string;
  annotationSetId: string;
  initialMorphotypes: MorphotypeRow[];
  roi: { x: number | null; y: number | null; width: number | null; height: number | null };
  initialTool?: "ai" | "layers" | "manual";
  onChooseAnotherImage: () => void;
  onMorphotypesChange: (morphotypes: MorphotypeRow[]) => void;
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

const CLASS_COLORS: Record<AnnotationRegionClassification, [number, number, number]> = {
  lichen: [45, 125, 76],
  bark: [139, 90, 43],
  moss: [22, 163, 74],
  algae: [15, 118, 110],
  shadow: [31, 41, 55],
  glare: [250, 204, 21],
  unknown: [107, 114, 128],
};

const SOURCE_LABELS: Record<AnnotationRegionSource, string> = {
  mobile_sam: "AI",
  manual: "Manual",
  color_assisted: "Color asistido",
};

const TOOL_LABELS: Array<{ value: StudioTool; label: string }> = [
  { value: "select", label: "Seleccionar / mover" },
  { value: "ai", label: "Selección IA" },
  { value: "lasso", label: "Lazo / polígono" },
  { value: "brush", label: "Pincel" },
  { value: "eraser", label: "Borrador" },
  { value: "eyedropper", label: "Cuentagotas" },
  { value: "similar", label: "Colores similares" },
];

function sanitizeMessage(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, 240);
}

function defaultLayerTitle(region: AnnotationRegionRow, morphotypes: MorphotypeRow[]): string {
  if (region.classification === "bark" && region.notes?.includes(TRUNK_NOTE)) return TRUNK_NOTE;
  if (region.classification === "lichen") {
    return morphotypes.find((item) => item.id === region.morphotype_id)?.label ?? "Liquen sin morfotipo";
  }
  return CLASS_LABELS[region.classification];
}

function historyEntryBytes(entry: HistoryEntry): number {
  if (entry.kind === "mask") return entry.indices.byteLength + entry.before.byteLength + entry.after.byteLength;
  if (entry.kind === "layer-add") return entry.saveInput.mask.size;
  return 256;
}

function isTrunkLayer(layer: StudioLayer): boolean {
  return layer.region.classification === "bark" && Boolean(layer.region.notes?.includes(TRUNK_NOTE));
}

function sortLayers(layers: StudioLayer[]): StudioLayer[] {
  return [...layers].sort((left, right) => {
    if (isTrunkLayer(left)) return -1;
    if (isTrunkLayer(right)) return 1;
    if (left.region.classification === "lichen" && right.region.classification !== "lichen") return -1;
    if (right.region.classification === "lichen" && left.region.classification !== "lichen") return 1;
    return left.region.created_at.localeCompare(right.region.created_at);
  });
}

export default function AnnotationStudio({
  imageUrl,
  imageName,
  annotationSetId,
  initialMorphotypes,
  roi,
  initialTool = "manual",
  onChooseAnotherImage,
  onMorphotypesChange,
}: AnnotationStudioProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const workingImageRef = useRef<WorkingImage | null>(null);
  const candidateMaskRef = useRef<Uint8Array | null>(null);
  const layerMasksRef = useRef<Map<string, Uint8Array>>(new Map());
  const historyRef = useRef<HistoryEntry[]>([]);
  const redoRef = useRef<HistoryEntry[]>([]);
  const historyBytesRef = useRef(0);
  const strokeRef = useRef<StrokeState | null>(null);
  const draggingPointStartRef = useRef<PointPrompt[] | null>(null);
  const mountedRef = useRef(true);
  const visionSessionRef = useRef<string | null>(null);
  const visionAbortRef = useRef<AbortController | null>(null);
  const visionRequestRef = useRef(0);
  const segmentationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colorWorkerRef = useRef<Worker | null>(null);
  const colorRequestRef = useRef(0);
  const latestColorRequestRef = useRef(0);

  const [workingImage, setWorkingImage] = useState<WorkingImage | null>(null);
  const [candidateCanvas, setCandidateCanvas] = useState<HTMLCanvasElement | null>(null);
  const [layersCanvas, setLayersCanvas] = useState<HTMLCanvasElement | null>(null);
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [stageSize, setStageSize] = useState({ width: 900, height: 620 });
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [activeTool, setActiveTool] = useState<StudioTool>(initialTool === "ai" ? "ai" : "select");
  const [candidateTarget, setCandidateTarget] = useState<CandidateTarget>("trunk");
  const [candidateMetadata, setCandidateMetadata] = useState<CandidateMetadata | null>(null);
  const [candidateOpacity, setCandidateOpacity] = useState(0.55);
  const [points, setPoints] = useState<PointPrompt[]>([]);
  const [promptLabel, setPromptLabel] = useState<0 | 1>(1);
  const [candidates, setCandidates] = useState<MobileSamCandidate[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [polygonPoints, setPolygonPoints] = useState<MaskPoint[]>([]);
  const [brushSize, setBrushSize] = useState(28);
  const [sampledRgb, setSampledRgb] = useState<[number, number, number] | null>(null);
  const [sampleConfirmed, setSampleConfirmed] = useState(false);
  const [colorTolerance, setColorTolerance] = useState(12);
  const [minimumArea, setMinimumArea] = useState(40);
  const [colorComponents, setColorComponents] = useState<SimilarColorComponent[]>([]);
  const [excludedComponents, setExcludedComponents] = useState<Set<number>>(new Set());
  const [layers, setLayers] = useState<StudioLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [morphotypes, setMorphotypes] = useState(initialMorphotypes);
  const [classification, setClassification] = useState<AnnotationRegionClassification>("lichen");
  const [morphotypeId, setMorphotypeId] = useState<string | null>(initialMorphotypes[0]?.id ?? null);
  const [showNewMorphotype, setShowNewMorphotype] = useState(false);
  const [newMorphotype, setNewMorphotype] = useState({
    label: "",
    growthForm: "unknown" as MorphotypeRow["growth_form"],
    notes: "",
  });
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("Cargando espacio de anotación…");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"loading" | "prepare" | "segment" | "save" | "delete" | null>("loading");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [coverageRevision, setCoverageRevision] = useState(0);

  const fitScale = workingImage
    ? Math.min(stageSize.width / workingImage.width, stageSize.height / workingImage.height)
    : 1;
  const displayScale = fitScale * view.zoom;
  const trunkLayer = layers.find(isTrunkLayer) ?? null;
  const phase = trunkLayer ? (layers.some((layer) => !isTrunkLayer(layer)) ? 3 : 2) : 1;
  const selectedLayer = layers.find((layer) => layer.region.id === selectedLayerId) ?? null;

  const coverage = useMemo(() => {
    const trunkMask = trunkLayer ? layerMasksRef.current.get(trunkLayer.region.id) ?? null : null;
    const lichenMasks = layers
      .filter((layer) => layer.region.classification === "lichen")
      .map((layer) => layerMasksRef.current.get(layer.region.id))
      .filter((mask): mask is Uint8Array => Boolean(mask));
    return calculateCoverage(trunkMask, lichenMasks);
  }, [coverageRevision, layers, trunkLayer]);

  const bumpHistory = useCallback(() => setHistoryRevision((current) => current + 1), []);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    const bytes = historyEntryBytes(entry);
    historyRef.current.push(entry);
    historyBytesRef.current += bytes;
    redoRef.current = [];
    while (
      historyRef.current.length > MAX_HISTORY_ENTRIES
      || historyBytesRef.current > MAX_HISTORY_BYTES && historyRef.current.length > 1
    ) {
      const removed = historyRef.current.shift();
      if (removed) historyBytesRef.current -= historyEntryBytes(removed);
    }
    bumpHistory();
  }, [bumpHistory]);

  const clearVisionSession = useCallback(() => {
    const sessionId = visionSessionRef.current;
    visionSessionRef.current = null;
    if (sessionId) {
      void fetch(`/api/vision/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    }
  }, []);

  const cancelVisionRequest = useCallback(() => {
    visionRequestRef.current += 1;
    visionAbortRef.current?.abort();
    visionAbortRef.current = null;
    if (segmentationTimerRef.current) clearTimeout(segmentationTimerRef.current);
  }, []);

  const renderCandidate = useCallback((mask = candidateMaskRef.current) => {
    const image = workingImageRef.current;
    if (!image || !mask) {
      setCandidateCanvas(null);
      return;
    }
    const canvas = candidateCanvas ?? document.createElement("canvas");
    drawMask(
      canvas,
      mask,
      image.width,
      image.height,
      candidateTarget === "trunk" ? [245, 158, 11] : [14, 165, 233],
      Math.round(candidateOpacity * 255),
    );
    if (!candidateCanvas) setCandidateCanvas(canvas);
    setCanvasRevision((current) => current + 1);
  }, [candidateCanvas, candidateOpacity, candidateTarget]);

  const renderLayers = useCallback((nextLayers = layers, nextSelectedId = selectedLayerId) => {
    const image = workingImageRef.current;
    if (!image) return;
    const canvas = layersCanvas ?? document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    const imageData = context.createImageData(image.width, image.height);
    for (const layer of nextLayers) {
      if (!layer.visible) continue;
      const mask = layerMasksRef.current.get(layer.region.id);
      if (!mask) continue;
      const selected = layer.region.id === nextSelectedId;
      const color = selected ? [255, 230, 0] : CLASS_COLORS[layer.region.classification];
      const alpha = Math.round((selected ? Math.min(1, layer.opacity + 0.25) : layer.opacity) * 255);
      for (let index = 0; index < mask.length; index += 1) {
        if (mask[index] === 0) continue;
        const pixelIndex = index * 4;
        imageData.data[pixelIndex] = color[0];
        imageData.data[pixelIndex + 1] = color[1];
        imageData.data[pixelIndex + 2] = color[2];
        imageData.data[pixelIndex + 3] = Math.max(imageData.data[pixelIndex + 3], alpha);
      }
    }
    context.putImageData(imageData, 0, 0);
    if (!layersCanvas) setLayersCanvas(canvas);
    setCanvasRevision((current) => current + 1);
  }, [layers, layersCanvas, selectedLayerId]);

  const setCandidate = useCallback((mask: Uint8Array | null, metadata: CandidateMetadata | null) => {
    candidateMaskRef.current = mask;
    setCandidateMetadata(metadata);
    if (!mask) {
      setCandidateCanvas(null);
      setColorComponents([]);
      setExcludedComponents(new Set());
      return;
    }
    renderCandidate(mask);
  }, [renderCandidate]);

  const resetCandidate = useCallback(() => {
    setCandidate(null, null);
    setPoints([]);
    setCandidates([]);
    setPolygonPoints([]);
    setNotes("");
  }, [setCandidate]);

  const fitToScreen = useCallback(() => {
    setView({ x: 0, y: 0, zoom: 1 });
  }, []);

  const refreshLayerCanvases = useCallback((nextLayers: StudioLayer[], nextSelectedId = selectedLayerId) => {
    setLayers(nextLayers);
    renderLayers(nextLayers, nextSelectedId);
    setCoverageRevision((current) => current + 1);
  }, [renderLayers, selectedLayerId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const updateSize = () => {
      const width = Math.max(320, host.clientWidth);
      const height = Math.max(420, Math.min(720, window.innerHeight - 260));
      setStageSize({ width, height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    colorWorkerRef.current = new Worker(COLOR_WORKER_URL, { type: "module" });
    colorWorkerRef.current.onmessage = (event: MessageEvent<ColorWorkerResponse>) => {
      const response = event.data;
      if (!mountedRef.current || response.requestId !== latestColorRequestRef.current) return;
      if (response.type === "error") {
        setError(response.message);
        return;
      }
      const mask = new Uint8Array(response.mask);
      candidateMaskRef.current = mask;
      setCandidateMetadata({
        source: "color_assisted",
        score: null,
        modelName: "CIELAB Delta E 1976",
        modelVersion: "D65",
        representativeColorHex: sampledRgb ? rgbToHex(sampledRgb) : null,
        colorToleranceDeltaE: colorTolerance,
      });
      setColorComponents(response.components);
      renderCandidate(mask);
      setStatus("Vista previa por color lista. Incluye o excluye componentes y corrige con pincel o borrador.");
    };
    return () => {
      mountedRef.current = false;
      cancelVisionRequest();
      clearVisionSession();
      colorWorkerRef.current?.terminate();
      colorWorkerRef.current = null;
      if (colorTimerRef.current) clearTimeout(colorTimerRef.current);
    };
  }, [cancelVisionRequest, clearVisionSession, colorTolerance, renderCandidate, sampledRgb]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setBusy("loading");
      setError(null);
      setStatus("Cargando imagen y capas guardadas…");
      resetCandidate();
      layerMasksRef.current = new Map();
      historyRef.current = [];
      redoRef.current = [];
      historyBytesRef.current = 0;
      bumpHistory();
      try {
        const element = await loadCrossOriginImage(imageUrl);
        const prepared = createWorkingImage(element, MAX_WORKING_DIMENSION);
        if (cancelled) return;
        workingImageRef.current = prepared;
        setWorkingImage(prepared);
        const state = await loadAiAnnotationState(annotationSetId);
        const loadedLayers = await Promise.all(state.regions.map(async (region): Promise<StudioLayer> => {
          const maskUrl = await createTemporaryUrl(region.mask_path);
          const mask = await loadMaskFromUrl(maskUrl, prepared.width, prepared.height);
          layerMasksRef.current.set(region.id, mask);
          return {
            region,
            visible: true,
            opacity: region.classification === "bark" ? 0.28 : 0.45,
            title: defaultLayerTitle(region, state.morphotypes),
          };
        }));
        if (cancelled) return;
        const sorted = sortLayers(loadedLayers);
        setMorphotypes(state.morphotypes);
        onMorphotypesChange(state.morphotypes);
        setLayers(sorted);
        setSelectedLayerId(initialTool === "layers" ? sorted[0]?.region.id ?? null : null);
        setCandidateTarget(sorted.some(isTrunkLayer) ? "region" : "trunk");
        setStatus(sorted.some(isTrunkLayer)
          ? "Tronco evaluable cargado. Marca regiones y confirma cada capa."
          : "Empieza definiendo el tronco evaluable.");
        setCoverageRevision((current) => current + 1);
        setBusy(null);
        window.setTimeout(() => renderLayers(sorted, initialTool === "layers" ? sorted[0]?.region.id ?? null : null), 0);
      } catch (reason) {
        if (!cancelled) {
          setBusy(null);
          setError(reason instanceof Error ? sanitizeMessage(reason.message) : "No se pudo abrir el editor.");
          setStatus("No se pudo cargar la imagen o sus píxeles.");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      cancelVisionRequest();
      clearVisionSession();
    };
  }, [annotationSetId, bumpHistory, cancelVisionRequest, clearVisionSession, imageUrl, initialTool, onMorphotypesChange, renderLayers, resetCandidate]);

  useEffect(() => {
    renderCandidate();
  }, [candidateOpacity, candidateTarget, renderCandidate]);

  const pointFromEvent = useCallback((event: KonvaEventObject<PointerEvent | MouseEvent | TouchEvent>): MaskPoint | null => {
    const image = workingImageRef.current;
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!image || !pointer) return null;
    const centeredX = (stageSize.width - image.width * displayScale) / 2 + view.x;
    const centeredY = (stageSize.height - image.height * displayScale) / 2 + view.y;
    const x = (pointer.x - centeredX) / displayScale;
    const y = (pointer.y - centeredY) / displayScale;
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
    return { x, y };
  }, [displayScale, stageSize.height, stageSize.width, view.x, view.y]);

  const prepareVision = useCallback(async (): Promise<string | null> => {
    if (visionSessionRef.current) return visionSessionRef.current;
    const image = workingImageRef.current;
    if (!image) return null;
    cancelVisionRequest();
    const requestId = visionRequestRef.current + 1;
    visionRequestRef.current = requestId;
    const controller = new AbortController();
    visionAbortRef.current = controller;
    setBusy("prepare");
    setStatus("Preparando imagen para MobileSAM…");
    setError(null);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        image.canvas.toBlob((result) => result ? resolve(result) : reject(new Error("No se pudo preparar la imagen.")), "image/jpeg", 0.92);
      });
      const formData = new FormData();
      formData.append("image", blob, "analysis.jpg");
      const response = await fetch("/api/vision/prepare", { method: "POST", body: formData, signal: controller.signal });
      const result = await response.json() as { sessionId?: string; error?: string };
      if (!response.ok || !result.sessionId) throw new Error(result.error ?? "No se pudo preparar MobileSAM.");
      if (requestId !== visionRequestRef.current || !mountedRef.current) return null;
      clearVisionSession();
      visionSessionRef.current = result.sessionId;
      setBusy(null);
      return result.sessionId;
    } catch (reason) {
      if ((reason as { name?: string }).name !== "AbortError" && mountedRef.current) {
        setBusy(null);
        setError("MobileSAM no está disponible. Puedes dibujar la máscara manualmente.");
      }
      return null;
    }
  }, [cancelVisionRequest, clearVisionSession]);

  const applyMobileSamCandidate = useCallback(async (nextIndex: number, nextCandidates = candidates) => {
    const selected = nextCandidates[nextIndex];
    const image = workingImageRef.current;
    if (!selected || !image) return;
    try {
      const mask = await loadMaskFromUrl(selected.maskDataUrl, image.width, image.height);
      setCandidateIndex(nextIndex);
      setCandidate(mask, {
        source: "mobile_sam",
        score: selected.score,
        modelName: selected.modelName,
        modelVersion: selected.modelVersion,
        representativeColorHex: sampledRgb ? rgbToHex(sampledRgb) : null,
        colorToleranceDeltaE: null,
      });
    } catch {
      setError("No se pudo leer la máscara propuesta.");
    }
  }, [candidates, sampledRgb, setCandidate]);

  const segment = useCallback(async (nextPoints: PointPrompt[]) => {
    if (nextPoints.length === 0) {
      setCandidates([]);
      if (candidateMetadata?.source === "mobile_sam") setCandidate(null, null);
      return;
    }
    const sessionId = await prepareVision();
    if (!sessionId) return;
    visionAbortRef.current?.abort();
    const requestId = visionRequestRef.current + 1;
    visionRequestRef.current = requestId;
    const controller = new AbortController();
    visionAbortRef.current = controller;
    setBusy("segment");
    setStatus("MobileSAM está proponiendo tres límites visuales…");
    try {
      const response = await fetch("/api/vision/segment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, points: nextPoints }),
        signal: controller.signal,
      });
      const result = await response.json() as {
        candidates?: MobileSamCandidate[];
        recommendedIndex?: number;
        error?: string;
      };
      if (!response.ok || !result.candidates || result.recommendedIndex == null) {
        throw new Error(result.error ?? "No se pudo segmentar.");
      }
      if (requestId !== visionRequestRef.current || !mountedRef.current) return;
      setCandidates(result.candidates);
      await applyMobileSamCandidate(result.recommendedIndex, result.candidates);
      setBusy(null);
      setStatus("MobileSAM propone límites visuales; selecciona uno y confirma qué representa.");
    } catch (reason) {
      if ((reason as { name?: string }).name !== "AbortError" && mountedRef.current) {
        setBusy(null);
        setError("No se pudo generar la selección IA.");
      }
    }
  }, [applyMobileSamCandidate, candidateMetadata?.source, prepareVision, setCandidate]);

  const scheduleSegment = useCallback((nextPoints: PointPrompt[]) => {
    if (segmentationTimerRef.current) clearTimeout(segmentationTimerRef.current);
    segmentationTimerRef.current = setTimeout(() => void segment(nextPoints), SEGMENT_DEBOUNCE_MS);
  }, [segment]);

  const addGuidePoint = useCallback((point: MaskPoint) => {
    const image = workingImageRef.current;
    if (!image || points.length >= 64) return;
    const before = points;
    const after = [...points, {
      x: point.x / image.width,
      y: point.y / image.height,
      label: promptLabel,
    } satisfies PointPrompt];
    setPoints(after);
    pushHistory({ kind: "points", before, after });
    scheduleSegment(after);
  }, [points, promptLabel, pushHistory, scheduleSegment]);

  const applyBrushCircle = useCallback((center: MaskPoint, value: 0 | 1, before: Map<number, number>) => {
    const image = workingImageRef.current;
    let mask = candidateMaskRef.current;
    if (!image) return;
    if (!mask) {
      mask = new Uint8Array(image.width * image.height);
      candidateMaskRef.current = mask;
      setCandidateMetadata({
        source: "manual",
        score: null,
        modelName: "Visual Annotation Studio",
        modelVersion: "1",
        representativeColorHex: sampledRgb ? rgbToHex(sampledRgb) : null,
        colorToleranceDeltaE: null,
      });
    }
    const radius = brushSize / 2;
    const minX = Math.max(0, Math.floor(center.x - radius));
    const maxX = Math.min(image.width - 1, Math.ceil(center.x + radius));
    const minY = Math.max(0, Math.floor(center.y - radius));
    const maxY = Math.min(image.height - 1, Math.ceil(center.y + radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (Math.hypot(x - center.x, y - center.y) > radius) continue;
        const index = y * image.width + x;
        if (mask[index] === value) continue;
        if (!before.has(index)) before.set(index, mask[index]);
        mask[index] = value;
      }
    }
  }, [brushSize, sampledRgb]);

  const applyBrushLine = useCallback((from: MaskPoint, to: MaskPoint, value: 0 | 1, before: Map<number, number>) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, brushSize / 4)));
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      applyBrushCircle({
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
      }, value, before);
    }
  }, [applyBrushCircle, brushSize]);

  const finishStroke = useCallback(() => {
    const stroke = strokeRef.current;
    const mask = candidateMaskRef.current;
    strokeRef.current = null;
    if (!stroke || !mask || stroke.before.size === 0) return;
    const indices = Uint32Array.from(stroke.before.keys());
    const before = Uint8Array.from(stroke.before.values());
    const after = new Uint8Array(indices.length);
    for (let index = 0; index < indices.length; index += 1) after[index] = mask[indices[index]];
    pushHistory({ kind: "mask", indices, before, after });
    renderCandidate(mask);
  }, [pushHistory, renderCandidate]);

  const finishPolygon = useCallback(() => {
    const image = workingImageRef.current;
    if (!image || polygonPoints.length < 3 || polygonArea(polygonPoints) < 4) {
      setError("El polígono debe tener al menos tres vértices y un área mayor que cero.");
      return;
    }
    const next = rasterizePolygon(polygonPoints, image.width, image.height);
    const previous = candidateMaskRef.current ?? new Uint8Array(next.length);
    const changedIndices: number[] = [];
    const beforeValues: number[] = [];
    const afterValues: number[] = [];
    for (let index = 0; index < next.length; index += 1) {
      if (previous[index] === next[index]) continue;
      changedIndices.push(index);
      beforeValues.push(previous[index]);
      afterValues.push(next[index]);
    }
    if (calculateMaskArea(next) === 0) {
      setError("El polígono no produjo una región válida.");
      return;
    }
    setCandidate(next, {
      source: "manual",
      score: null,
      modelName: "Visual Annotation Studio",
      modelVersion: "1",
      representativeColorHex: sampledRgb ? rgbToHex(sampledRgb) : null,
      colorToleranceDeltaE: null,
    });
    pushHistory({
      kind: "mask",
      indices: Uint32Array.from(changedIndices),
      before: Uint8Array.from(beforeValues),
      after: Uint8Array.from(afterValues),
    });
    setPolygonPoints([]);
    setStatus("Polígono cerrado. Corrige con pincel o borrador antes de guardar.");
  }, [polygonPoints, pushHistory, sampledRgb, setCandidate]);

  const sampleColor = useCallback((point: MaskPoint) => {
    const image = workingImageRef.current;
    if (!image) return;
    try {
      const rgb = sampleMedianRgb(image.canvas, point.x, point.y, 7);
      setSampledRgb(rgb);
      setSampleConfirmed(false);
      setError(null);
      setStatus("Color seleccionado con la mediana de un parche de 7 × 7 píxeles.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo muestrear el color.");
    }
  }, []);

  const requestSimilarColors = useCallback(() => {
    const worker = colorWorkerRef.current;
    const image = workingImageRef.current;
    if (!worker || !image || !sampledRgb) return;
    const trunkMask = trunkLayer ? layerMasksRef.current.get(trunkLayer.region.id) : null;
    const scope = trunkMask ?? createRoiMask(image.width, image.height, roi);
    const rgba = image.canvas.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, image.width, image.height).data;
    if (!rgba) {
      setError("No se pudieron leer los píxeles para la selección por color.");
      return;
    }
    const previousRequestId = latestColorRequestRef.current;
    if (previousRequestId > 0) {
      worker.postMessage({ type: "cancel", requestId: previousRequestId } satisfies ColorWorkerRequest);
    }
    const requestId = colorRequestRef.current + 1;
    colorRequestRef.current = requestId;
    latestColorRequestRef.current = requestId;
    const rgbaBuffer = rgba.slice().buffer;
    const scopeBuffer = scope.slice().buffer;
    worker.postMessage({
      type: "configure",
      width: image.width,
      height: image.height,
      rgba: rgbaBuffer,
      scopeMask: scopeBuffer,
    } satisfies ColorWorkerRequest, [rgbaBuffer, scopeBuffer]);
    worker.postMessage({
      type: "select",
      requestId,
      sampleRgb,
      toleranceDeltaE: colorTolerance,
      minimumArea,
    } satisfies ColorWorkerRequest);
    setStatus("Calculando componentes de color dentro del tronco evaluable…");
  }, [colorTolerance, minimumArea, roi, sampledRgb, trunkLayer]);

  useEffect(() => {
    if (activeTool !== "similar" || !sampledRgb) return;
    if (colorTimerRef.current) clearTimeout(colorTimerRef.current);
    colorTimerRef.current = setTimeout(requestSimilarColors, COLOR_DEBOUNCE_MS);
    return () => {
      if (colorTimerRef.current) clearTimeout(colorTimerRef.current);
    };
  }, [activeTool, colorTolerance, minimumArea, requestSimilarColors, sampledRgb]);

  const toggleColorComponent = useCallback((componentId: number) => {
    const nextExcluded = new Set(excludedComponents);
    if (nextExcluded.has(componentId)) nextExcluded.delete(componentId);
    else nextExcluded.add(componentId);
    setExcludedComponents(nextExcluded);
    const requestId = colorRequestRef.current + 1;
    colorRequestRef.current = requestId;
    latestColorRequestRef.current = requestId;
    colorWorkerRef.current?.postMessage({
      type: "components",
      requestId,
      excludedComponentIds: [...nextExcluded],
    } satisfies ColorWorkerRequest);
  }, [excludedComponents]);

  const handleCanvasPointerDown = useCallback((event: KonvaEventObject<PointerEvent>) => {
    if (busy || event.target.name() === "guide-point") return;
    const point = pointFromEvent(event);
    if (!point) return;
    if (activeTool === "ai") {
      addGuidePoint(point);
      return;
    }
    if (activeTool === "lasso") {
      setPolygonPoints((current) => [...current, point]);
      return;
    }
    if (activeTool === "eyedropper") {
      sampleColor(point);
      return;
    }
    if (activeTool === "brush" || activeTool === "eraser") {
      if (activeTool === "eraser" && !candidateMaskRef.current) return;
      const value = activeTool === "brush" ? 1 : 0;
      const stroke: StrokeState = { value, before: new Map(), previousPoint: point };
      strokeRef.current = stroke;
      applyBrushCircle(point, value, stroke.before);
      renderCandidate();
    }
  }, [activeTool, addGuidePoint, applyBrushCircle, busy, pointFromEvent, renderCandidate, sampleColor]);

  const handleCanvasPointerMove = useCallback((event: KonvaEventObject<PointerEvent>) => {
    const stroke = strokeRef.current;
    if (!stroke) return;
    const point = pointFromEvent(event);
    if (!point) return;
    applyBrushLine(stroke.previousPoint, point, stroke.value, stroke.before);
    stroke.previousPoint = point;
    renderCandidate();
  }, [applyBrushLine, pointFromEvent, renderCandidate]);

  const handleCanvasPointerUp = useCallback(() => finishStroke(), [finishStroke]);

  const handleUndo = useCallback(async () => {
    const entry = historyRef.current.pop();
    if (!entry || busy) return;
    historyBytesRef.current -= historyEntryBytes(entry);
    if (entry.kind === "mask") {
      const mask = candidateMaskRef.current;
      if (mask) {
        for (let index = 0; index < entry.indices.length; index += 1) mask[entry.indices[index]] = entry.before[index];
        renderCandidate(mask);
      }
    } else if (entry.kind === "points") {
      setPoints(entry.before);
      scheduleSegment(entry.before);
    } else if (entry.kind === "visibility") {
      const next = layers.map((layer) => layer.region.id === entry.layerId ? { ...layer, visible: entry.before } : layer);
      refreshLayerCanvases(next);
    } else {
      setBusy("delete");
      try {
        await deleteRegionWithStorage(entry.layer.region);
        refreshLayerCanvases(layers.filter((layer) => layer.region.id !== entry.layer.region.id));
      } catch {
        setError("No se pudo deshacer la aceptación de la capa.");
        historyRef.current.push(entry);
        historyBytesRef.current += historyEntryBytes(entry);
        setBusy(null);
        bumpHistory();
        return;
      }
      setBusy(null);
    }
    redoRef.current.push(entry);
    bumpHistory();
  }, [bumpHistory, busy, layers, refreshLayerCanvases, renderCandidate, scheduleSegment]);

  const handleRedo = useCallback(async () => {
    const entry = redoRef.current.pop();
    if (!entry || busy) return;
    if (entry.kind === "mask") {
      const mask = candidateMaskRef.current;
      if (mask) {
        for (let index = 0; index < entry.indices.length; index += 1) mask[entry.indices[index]] = entry.after[index];
        renderCandidate(mask);
      }
    } else if (entry.kind === "points") {
      setPoints(entry.after);
      scheduleSegment(entry.after);
    } else if (entry.kind === "visibility") {
      const next = layers.map((layer) => layer.region.id === entry.layerId ? { ...layer, visible: entry.after } : layer);
      refreshLayerCanvases(next);
    } else {
      setBusy("save");
      try {
        const region = await saveAcceptedRegion(entry.saveInput);
        const layer = { ...entry.layer, region };
        refreshLayerCanvases(sortLayers([...layers, layer]), region.id);
      } catch {
        setError("No se pudo rehacer la aceptación de la capa.");
        redoRef.current.push(entry);
        setBusy(null);
        bumpHistory();
        return;
      }
      setBusy(null);
    }
    historyRef.current.push(entry);
    historyBytesRef.current += historyEntryBytes(entry);
    bumpHistory();
  }, [bumpHistory, busy, layers, refreshLayerCanvases, renderCandidate, scheduleSegment]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPolygonPoints([]);
        setStatus("Polígono cancelado.");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) void handleRedo();
        else void handleUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleUndo]);

  const persistCandidate = useCallback(async () => {
    const image = workingImageRef.current;
    const mask = candidateMaskRef.current;
    const metadata = candidateMetadata;
    if (!image || !mask || !metadata || busy) return;
    const areaPixels = calculateMaskArea(mask);
    if (areaPixels === 0) {
      setError("La máscara candidata está vacía.");
      return;
    }
    const nextClassification = candidateTarget === "trunk" ? "bark" : classification;
    let selectedMorphotypeId = nextClassification === "lichen" ? morphotypeId : null;
    let nextMorphotypes = morphotypes;
    if (nextClassification === "lichen") {
      if (!sampledRgb || !sampleConfirmed) {
        setError("Confirma un color visible con el cuentagotas antes de guardar una capa de liquen.");
        return;
      }
      const selectedColor = rgbToHex(sampledRgb);
      if (showNewMorphotype) {
        if (!newMorphotype.label.trim()) {
          setError("Escribe un nombre para el nuevo morfotipo.");
          return;
        }
        const created = await createMorphotypeForAnnotationSet(
          annotationSetId,
          newMorphotype.label,
          newMorphotype.growthForm,
          selectedColor,
          newMorphotype.notes.trim() || null,
        );
        selectedMorphotypeId = created.id;
        nextMorphotypes = [...morphotypes, created];
      } else {
        const selected = morphotypes.find((item) => item.id === selectedMorphotypeId);
        if (!selected) {
          setError("Selecciona un morfotipo.");
          return;
        }
        if (selected.color_hex && selected.color_hex.toUpperCase() !== selectedColor && !window.confirm(`El morfotipo ${selected.label} ya usa ${selected.color_hex}. ¿Reemplazarlo por ${selectedColor}?`)) {
          return;
        }
        if (selected.color_hex?.toUpperCase() !== selectedColor) {
          const updated = await upsertMorphotype({
            id: selected.id,
            annotationSetId,
            label: selected.label,
            growthForm: selected.growth_form,
            colorHex: selectedColor,
            notes: selected.notes,
          });
          nextMorphotypes = morphotypes.map((item) => item.id === updated.id ? updated : item);
        }
      }
    }

    setBusy("save");
    setError(null);
    setStatus("Guardando máscara en la capa privada…");
    try {
      const id = crypto.randomUUID();
      const blob = await maskToPngBlob(mask, image.width, image.height);
      const saveInput: RegionSaveInput = {
        id,
        annotationSetId,
        classification: nextClassification,
        morphotypeId: selectedMorphotypeId,
        mask: blob,
        width: image.width,
        height: image.height,
        areaPixels,
        score: metadata.score,
        positivePoints: metadata.source === "mobile_sam"
          ? points.filter((point) => point.label === 1).map(({ x, y }) => ({ x, y }))
          : [],
        negativePoints: metadata.source === "mobile_sam"
          ? points.filter((point) => point.label === 0).map(({ x, y }) => ({ x, y }))
          : [],
        modelName: metadata.modelName,
        modelVersion: metadata.modelVersion,
        notes: candidateTarget === "trunk" ? TRUNK_NOTE : notes.trim() || null,
        source: metadata.source,
        representativeColorHex: sampledRgb ? rgbToHex(sampledRgb) : metadata.representativeColorHex,
        colorToleranceDeltaE: metadata.colorToleranceDeltaE,
      };
      const region = await saveAcceptedRegion(saveInput);
      if (!mountedRef.current) return;
      layerMasksRef.current.set(region.id, mask.slice());
      const layer: StudioLayer = {
        region,
        visible: true,
        opacity: nextClassification === "bark" ? 0.28 : 0.45,
        title: defaultLayerTitle(region, nextMorphotypes),
      };
      const nextLayers = sortLayers([...layers, layer]);
      setMorphotypes(nextMorphotypes);
      onMorphotypesChange(nextMorphotypes);
      setSelectedLayerId(region.id);
      refreshLayerCanvases(nextLayers, region.id);
      pushHistory({ kind: "layer-add", layer, saveInput });
      setCandidateTarget("region");
      resetCandidate();
      setShowNewMorphotype(false);
      setNewMorphotype({ label: "", growthForm: "unknown", notes: "" });
      setBusy(null);
      setStatus(candidateTarget === "trunk"
        ? "Tronco evaluable confirmado. Ahora marca regiones."
        : "Capa confirmada y guardada.");
    } catch (reason) {
      if (mountedRef.current) {
        setBusy(null);
        setError(reason instanceof Error ? sanitizeMessage(reason.message) : "No se pudo guardar la capa.");
      }
    }
  }, [
    annotationSetId,
    busy,
    candidateMetadata,
    candidateTarget,
    classification,
    layers,
    morphotypeId,
    morphotypes,
    newMorphotype,
    notes,
    onMorphotypesChange,
    points,
    pushHistory,
    refreshLayerCanvases,
    resetCandidate,
    sampledRgb,
    sampleConfirmed,
    showNewMorphotype,
  ]);

  const toggleLayerVisibility = useCallback((layer: StudioLayer) => {
    const next = layers.map((item) => item.region.id === layer.region.id ? { ...item, visible: !item.visible } : item);
    pushHistory({ kind: "visibility", layerId: layer.region.id, before: layer.visible, after: !layer.visible });
    refreshLayerCanvases(next);
  }, [layers, pushHistory, refreshLayerCanvases]);

  const updateLayerOpacity = useCallback((layerId: string, opacity: number) => {
    refreshLayerCanvases(layers.map((layer) => layer.region.id === layerId ? { ...layer, opacity } : layer));
  }, [layers, refreshLayerCanvases]);

  const selectLayer = useCallback((layer: StudioLayer) => {
    setSelectedLayerId(layer.region.id);
    setClassification(layer.region.classification);
    setMorphotypeId(layer.region.morphotype_id);
    renderLayers(layers, layer.region.id);
  }, [layers, renderLayers]);

  const saveSelectedLayerClassification = useCallback(async () => {
    if (!selectedLayer || busy || isTrunkLayer(selectedLayer)) return;
    if (classification === "lichen" && !morphotypeId) {
      setError("Selecciona un morfotipo.");
      return;
    }
    setBusy("save");
    try {
      const region = await updateRegionClassification(
        selectedLayer.region.id,
        annotationSetId,
        classification,
        classification === "lichen" ? morphotypeId : null,
      );
      const next = layers.map((layer) => layer.region.id === region.id
        ? { ...layer, region, title: defaultLayerTitle(region, morphotypes) }
        : layer);
      refreshLayerCanvases(sortLayers(next), region.id);
      setStatus("Clasificación de la capa actualizada.");
      setBusy(null);
    } catch {
      setBusy(null);
      setError("No se pudo actualizar la clasificación.");
    }
  }, [annotationSetId, busy, classification, layers, morphotypeId, morphotypes, refreshLayerCanvases, selectedLayer]);

  const deleteLayer = useCallback(async (layer: StudioLayer) => {
    if (busy || !window.confirm(`¿Eliminar la capa “${layer.title}” y su máscara guardada?`)) return;
    setBusy("delete");
    try {
      await deleteRegionWithStorage(layer.region);
      layerMasksRef.current.delete(layer.region.id);
      const next = layers.filter((item) => item.region.id !== layer.region.id);
      setSelectedLayerId(null);
      refreshLayerCanvases(next, null);
      if (isTrunkLayer(layer)) {
        setCandidateTarget("trunk");
        setStatus("Se eliminó el tronco evaluable. Define uno nuevo antes de calcular cobertura.");
      } else {
        setStatus("Capa eliminada.");
      }
      historyRef.current = [];
      redoRef.current = [];
      historyBytesRef.current = 0;
      bumpHistory();
      setBusy(null);
    } catch (reason) {
      setBusy(null);
      setError(reason instanceof Error ? sanitizeMessage(reason.message) : "No se pudo eliminar la capa.");
    }
  }, [bumpHistory, busy, layers, refreshLayerCanvases]);

  const stageOrigin = workingImage ? {
    x: (stageSize.width - workingImage.width * displayScale) / 2 + view.x,
    y: (stageSize.height - workingImage.height * displayScale) / 2 + view.y,
  } : { x: 0, y: 0 };

  return (
    <div className="space-y-3" style={{ color: "var(--ld-text)" }}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Annotation Studio</h1>
          <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>{imageName}</p>
        </div>
        <button type="button" onClick={onChooseAnotherImage} className="rounded border px-3 py-2 text-sm focus-visible:outline-2" style={{ borderColor: "var(--ld-border)" }}>
          Elegir otra imagen
        </button>
      </header>

      <ol className="grid gap-2 text-sm sm:grid-cols-3" aria-label="Flujo de trabajo">
        {[
          [1, "Definir tronco"],
          [2, "Marcar regiones"],
          [3, "Revisar y guardar"],
        ].map(([step, label]) => (
          <li key={step} className="rounded border px-3 py-2 font-medium" style={{
            borderColor: phase === step ? "var(--ld-text)" : "var(--ld-border)",
            background: phase === step ? "var(--ld-sand)" : "var(--ld-card)",
          }}>
            {step}. {label}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2 rounded border bg-white p-2" role="toolbar" aria-label="Herramientas de dibujo" style={{ borderColor: "var(--ld-border)" }}>
        {TOOL_LABELS.map((tool) => {
          const disabled = Boolean(busy) || tool.value === "eraser" && !candidateMetadata || tool.value === "similar" && (!sampledRgb || !trunkLayer);
          return (
            <button
              key={tool.value}
              type="button"
              aria-pressed={activeTool === tool.value}
              disabled={disabled}
              onClick={() => {
                setActiveTool(tool.value);
                if (tool.value === "ai" || tool.value === "lasso") setCandidateTarget(trunkLayer ? "region" : "trunk");
              }}
              className="rounded border px-3 py-2 text-sm font-medium focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                borderColor: activeTool === tool.value ? "var(--ld-text)" : "var(--ld-border)",
                background: activeTool === tool.value ? "var(--ld-sand)" : "#fff",
              }}
            >
              {tool.label}
            </button>
          );
        })}
        <button type="button" disabled={historyRef.current.length === 0 || Boolean(busy)} onClick={() => void handleUndo()} className="rounded border px-3 py-2 text-sm disabled:opacity-40" style={{ borderColor: "var(--ld-border)" }}>Deshacer</button>
        <button type="button" disabled={redoRef.current.length === 0 || Boolean(busy)} onClick={() => void handleRedo()} className="rounded border px-3 py-2 text-sm disabled:opacity-40" style={{ borderColor: "var(--ld-border)" }}>Rehacer</button>
        <button type="button" onClick={fitToScreen} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Ajustar imagen a pantalla</button>
        <span className="sr-only" aria-live="polite">Historial {historyRevision}</span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 rounded border bg-slate-100 p-2" style={{ borderColor: "var(--ld-border)" }}>
          <div className="mb-2 flex flex-wrap items-center gap-3 rounded bg-white px-3 py-2 text-sm">
            {activeTool === "ai" ? (
              <>
                <span>Guía MobileSAM:</span>
                <button type="button" aria-pressed={promptLabel === 1} onClick={() => setPromptLabel(1)} className="rounded border px-2 py-1" style={{ borderColor: promptLabel === 1 ? "#15803d" : "var(--ld-border)" }}>Punto positivo</button>
                <button type="button" aria-pressed={promptLabel === 0} onClick={() => setPromptLabel(0)} className="rounded border px-2 py-1" style={{ borderColor: promptLabel === 0 ? "#c2410c" : "var(--ld-border)" }}>Punto negativo</button>
                <span>{points.length} puntos</span>
              </>
            ) : null}
            {activeTool === "lasso" ? (
              <>
                <span>{polygonPoints.length} vértices</span>
                <button type="button" disabled={polygonPoints.length < 3} onClick={finishPolygon} className="rounded border px-2 py-1 disabled:opacity-40" style={{ borderColor: "var(--ld-border)" }}>Finalizar polígono</button>
                <button type="button" onClick={() => setPolygonPoints([])} className="rounded border px-2 py-1" style={{ borderColor: "var(--ld-border)" }}>Cancelar</button>
              </>
            ) : null}
            {activeTool === "brush" || activeTool === "eraser" ? (
              <label className="flex items-center gap-2">
                Tamaño {brushSize}px
                <input type="range" min={4} max={120} value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
              </label>
            ) : null}
            {candidateMetadata ? (
              <label className="flex items-center gap-2">
                Opacidad {Math.round(candidateOpacity * 100)}%
                <input type="range" min={0.15} max={0.9} step={0.05} value={candidateOpacity} onChange={(event) => setCandidateOpacity(Number(event.target.value))} />
              </label>
            ) : null}
          </div>

          <div ref={hostRef} className="overflow-hidden rounded bg-slate-900" aria-label="Lienzo de anotación">
            <Stage
              width={stageSize.width}
              height={stageSize.height}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerLeave={handleCanvasPointerUp}
              onDblClick={() => {
                if (activeTool === "lasso" && polygonPoints.length >= 3) finishPolygon();
              }}
              onWheel={(event) => {
                event.evt.preventDefault();
                const factor = event.evt.deltaY > 0 ? 0.9 : 1.1;
                setView((current) => ({ ...current, zoom: Math.max(0.5, Math.min(6, current.zoom * factor)) }));
              }}
            >
              <Layer>
                <Group
                  x={stageOrigin.x}
                  y={stageOrigin.y}
                  scaleX={displayScale}
                  scaleY={displayScale}
                  draggable={activeTool === "select"}
                  onDragEnd={(event) => setView((current) => ({
                    ...current,
                    x: current.x + event.target.x() - stageOrigin.x,
                    y: current.y + event.target.y() - stageOrigin.y,
                  }))}
                >
                  {workingImage ? <KonvaImage image={workingImage.element} width={workingImage.width} height={workingImage.height} /> : null}
                  {layersCanvas ? <KonvaImage key={`layers-${canvasRevision}`} image={layersCanvas} width={workingImage?.width} height={workingImage?.height} listening={false} /> : null}
                  {candidateCanvas ? <KonvaImage key={`candidate-${canvasRevision}`} image={candidateCanvas} width={workingImage?.width} height={workingImage?.height} listening={false} /> : null}
                  {polygonPoints.length > 0 ? (
                    <Line points={polygonPoints.flatMap((point) => [point.x, point.y])} stroke="#38bdf8" strokeWidth={2 / displayScale} closed={polygonPoints.length >= 3} />
                  ) : null}
                  {points.map((point, index) => (
                    <Circle
                      key={`${index}-${point.label}`}
                      name="guide-point"
                      x={point.x * (workingImage?.width ?? 1)}
                      y={point.y * (workingImage?.height ?? 1)}
                      radius={7 / displayScale}
                      fill={point.label === 1 ? "#16a34a" : "#ea580c"}
                      stroke="#fff"
                      strokeWidth={2 / displayScale}
                      draggable={activeTool === "ai" && !busy}
                      onPointerDown={(event) => {
                        event.cancelBubble = true;
                        draggingPointStartRef.current = points.map((item) => ({ ...item }));
                      }}
                      onDragMove={(event) => {
                        const image = workingImageRef.current;
                        if (!image) return;
                        const x = Math.max(0, Math.min(1, event.target.x() / image.width));
                        const y = Math.max(0, Math.min(1, event.target.y() / image.height));
                        setPoints((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, x, y } : item));
                      }}
                      onDragEnd={() => {
                        const before = draggingPointStartRef.current;
                        draggingPointStartRef.current = null;
                        if (!before) return;
                        setPoints((current) => {
                          pushHistory({ kind: "points", before, after: current });
                          scheduleSegment(current);
                          return current;
                        });
                      }}
                    />
                  ))}
                </Group>
              </Layer>
            </Stage>
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--ld-text-secondary)" }}>
            La IA propone un límite visual; la persona usuaria confirma si representa tronco, liquen u otra categoría.
          </p>
          {status ? <p className="mt-2 rounded border bg-white p-2 text-sm" aria-live="polite" style={{ borderColor: "var(--ld-border)" }}>{status}</p> : null}
          {error ? <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700" role="alert">{error}</p> : null}
        </main>

        <aside className="space-y-3">
          {!trunkLayer ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">1. Tronco evaluable</h2>
              <p className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>Define el límite que se usará como denominador de cobertura.</p>
              <button type="button" onClick={() => { setCandidateTarget("trunk"); setActiveTool("ai"); }} className="mt-3 w-full rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Sugerir tronco con IA</button>
              <button type="button" onClick={() => { setCandidateTarget("trunk"); setActiveTool("lasso"); }} className="mt-2 w-full rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Dibujar tronco manualmente</button>
            </section>
          ) : null}

          {candidates.length > 0 ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Propuestas MobileSAM</h2>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {candidates.map((candidate, index) => (
                  <button key={candidate.id} type="button" aria-pressed={candidateIndex === index} onClick={() => void applyMobileSamCandidate(index)} className="rounded border p-2 text-xs" style={{ borderColor: candidateIndex === index ? "var(--ld-text)" : "var(--ld-border)" }}>
                    Opción {index + 1}<br />{candidate.score.toFixed(3)}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {sampledRgb ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Color seleccionado</h2>
              <div className="mt-2 flex items-center gap-3">
                <span className="h-14 w-14 rounded border" aria-label={`Muestra ${rgbToHex(sampledRgb)}`} style={{ background: rgbToHex(sampledRgb), borderColor: "var(--ld-border)" }} />
                <div className="text-sm">
                  <p>{rgbToHex(sampledRgb)}</p>
                  <p className="text-xs" style={{ color: "var(--ld-text-secondary)" }}>RGB {sampledRgb.join(", ")}</p>
                </div>
              </div>
              <button type="button" onClick={() => setSampleConfirmed(true)} className="mt-2 w-full rounded border px-3 py-2 text-sm" style={{ borderColor: sampleConfirmed ? "#15803d" : "var(--ld-border)" }}>
                {sampleConfirmed ? "Color confirmado" : "Usar este color"}
              </button>
              <button type="button" onClick={() => setActiveTool("eyedropper")} className="mt-2 w-full rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Muestrear de nuevo</button>
            </section>
          ) : null}

          {activeTool === "similar" && sampledRgb ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Colores similares</h2>
              <label className="mt-3 block text-sm">
                Tolerancia Delta E: {colorTolerance}
                <input className="w-full" type="range" min={1} max={50} value={colorTolerance} onChange={(event) => setColorTolerance(Number(event.target.value))} />
              </label>
              <label className="mt-3 block text-sm">
                Área mínima: {minimumArea} px
                <input className="w-full" type="range" min={1} max={1000} value={minimumArea} onChange={(event) => setMinimumArea(Number(event.target.value))} />
              </label>
              <p className="mt-2 text-xs" style={{ color: "var(--ld-text-secondary)" }}>CIELAB D65 y Delta E 1976. La búsqueda se limita al tronco confirmado.</p>
              <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                {colorComponents.map((component, index) => (
                  <label key={component.id} className="flex items-center justify-between gap-2 text-sm">
                    <span><input type="checkbox" checked={!excludedComponents.has(component.id)} onChange={() => toggleColorComponent(component.id)} /> Componente {index + 1}</span>
                    <span>{component.areaPixels} px</span>
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          {candidateMetadata ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">{candidateTarget === "trunk" ? "Confirmar tronco" : "Clasificar región"}</h2>
              {candidateTarget === "region" ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {ANNOTATION_REGION_CLASSES.map((item) => (
                    <button key={item} type="button" aria-pressed={classification === item} onClick={() => setClassification(item)} className="rounded border px-2 py-2 text-sm" style={{ borderColor: classification === item ? "var(--ld-text)" : "var(--ld-border)" }}>{CLASS_LABELS[item]}</button>
                  ))}
                </div>
              ) : null}
              {candidateTarget === "region" && classification === "lichen" ? (
                <div className="mt-3 space-y-2">
                  <select value={morphotypeId ?? ""} disabled={showNewMorphotype} onChange={(event) => setMorphotypeId(event.target.value || null)} className="w-full rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>
                    <option value="">Selecciona morfotipo</option>
                    {morphotypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                  <label className="block text-sm"><input type="checkbox" checked={showNewMorphotype} onChange={(event) => setShowNewMorphotype(event.target.checked)} /> Crear morfotipo</label>
                  {showNewMorphotype ? (
                    <>
                      <label className="block text-sm">Nombre<input value={newMorphotype.label} onChange={(event) => setNewMorphotype((current) => ({ ...current, label: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
                      <label className="block text-sm">Forma de crecimiento<select value={newMorphotype.growthForm} onChange={(event) => setNewMorphotype((current) => ({ ...current, growthForm: event.target.value as MorphotypeRow["growth_form"] }))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }}>
                        {["crustose", "foliose", "fruticose", "squamulose", "unknown"].map((item) => <option key={item} value={item}>{item}</option>)}
                      </select></label>
                      <label className="block text-sm">Notas<textarea rows={2} value={newMorphotype.notes} onChange={(event) => setNewMorphotype((current) => ({ ...current, notes: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
                    </>
                  ) : null}
                </div>
              ) : null}
              {candidateTarget === "region" ? <label className="mt-3 block text-sm">Notas de la región<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label> : null}
              <button type="button" disabled={Boolean(busy)} onClick={() => void persistCandidate()} className="mt-3 w-full rounded border px-3 py-2 text-sm font-semibold disabled:opacity-40" style={{ borderColor: "var(--ld-text)", background: "var(--ld-sand)" }}>
                {candidateTarget === "trunk" ? "Confirmar como Tronco evaluable" : "Guardar como capa"}
              </button>
              <button type="button" disabled={Boolean(busy)} onClick={resetCandidate} className="mt-2 w-full rounded border px-3 py-2 text-sm disabled:opacity-40" style={{ borderColor: "var(--ld-border)" }}>Descartar candidato</button>
            </section>
          ) : null}

          <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
            <h2 className="font-semibold">Capas</h2>
            <div className="mt-2 max-h-80 space-y-2 overflow-auto">
              {layers.length === 0 ? <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Todavía no hay capas guardadas.</p> : null}
              {layers.map((layer) => (
                <div key={layer.region.id} className="rounded border p-2 text-sm" style={{ borderColor: selectedLayerId === layer.region.id ? "var(--ld-text)" : "var(--ld-border)" }}>
                  <button type="button" onClick={() => selectLayer(layer)} className="w-full text-left">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="h-3 w-3 rounded-full" style={{ background: `rgb(${CLASS_COLORS[layer.region.classification].join(",")})` }} />
                      {layer.title}
                    </span>
                    <span className="mt-1 block text-xs" style={{ color: "var(--ld-text-secondary)" }}>{SOURCE_LABELS[layer.region.source]}</span>
                  </button>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => toggleLayerVisibility(layer)} className="rounded border px-2 py-1" style={{ borderColor: "var(--ld-border)" }}>{layer.visible ? "Ocultar" : "Mostrar"}</button>
                    <button type="button" disabled={Boolean(busy)} onClick={() => void deleteLayer(layer)} className="rounded border px-2 py-1 text-red-700 disabled:opacity-40" style={{ borderColor: "var(--ld-border)" }}>Eliminar</button>
                  </div>
                  <label className="mt-2 block text-xs">Opacidad <input className="w-full" type="range" min={0.1} max={0.9} step={0.05} value={layer.opacity} onChange={(event) => updateLayerOpacity(layer.region.id, Number(event.target.value))} /></label>
                </div>
              ))}
            </div>
          </section>

          {selectedLayer && !isTrunkLayer(selectedLayer) ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Editar capa</h2>
              <select value={classification} onChange={(event) => setClassification(event.target.value as AnnotationRegionClassification)} className="mt-2 w-full rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>
                {ANNOTATION_REGION_CLASSES.map((item) => <option key={item} value={item}>{CLASS_LABELS[item]}</option>)}
              </select>
              {classification === "lichen" ? (
                <select value={morphotypeId ?? ""} onChange={(event) => setMorphotypeId(event.target.value || null)} className="mt-2 w-full rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>
                  <option value="">Selecciona morfotipo</option>
                  {morphotypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              ) : null}
              <button type="button" disabled={Boolean(busy)} onClick={() => void saveSelectedLayerClassification()} className="mt-2 w-full rounded border px-3 py-2 text-sm disabled:opacity-40" style={{ borderColor: "var(--ld-border)" }}>Guardar clasificación</button>
            </section>
          ) : null}

          <section className="rounded border bg-white p-3 text-sm" style={{ borderColor: "var(--ld-border)" }}>
            <h2 className="font-semibold">Resumen visual provisional</h2>
            {coverage.coveragePercent == null ? (
              <p className="mt-2">Datos insuficientes</p>
            ) : (
              <div className="mt-2 space-y-1">
                <p>Área evaluable: {coverage.evaluableArea.toLocaleString()} px</p>
                <p>Área de liquen (unión): {coverage.lichenArea.toLocaleString()} px</p>
                <p>Cobertura de liquen: {coverage.coveragePercent.toFixed(1)}%</p>
                {coverage.overlapPixels > 0 ? <p className="text-amber-700">Aviso: {coverage.overlapPixels.toLocaleString()} px solapados se contaron una sola vez.</p> : null}
              </div>
            )}
            <p className="mt-2 text-xs" style={{ color: "var(--ld-text-secondary)" }}>Unión de regiones de liquen confirmadas, recortada al tronco evaluable. Las ayudas IA y de color son anotaciones confirmadas por la persona usuaria, no identificación automática de especies.</p>
            <span className="sr-only">{coverageRevision}</span>
          </section>
        </aside>
      </div>
    </div>
  );
}

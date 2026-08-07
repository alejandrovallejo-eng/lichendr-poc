"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Stage } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  ANNOTATION_REGION_CLASSES,
  createMorphotypeForAnnotationSet,
  createTemporaryUrl,
  deleteRegionWithStorage,
  loadAiAnnotationState,
  replaceAcceptedTrunkRegion,
  RegionPersistenceError,
  retryMaskCleanup,
  saveAcceptedRegion,
  updateRegionClassification,
  updateRegionNotes,
  type AnnotationRegionClassification,
  type AnnotationRegionRow,
  type AnnotationRegionSource,
  type MorphotypeRow,
  type RegionSaveInput,
} from "@/modules/annotations/regions";
import {
  finalizeAnnotationSet,
  reopenAnnotationSet,
  upsertMorphotype,
  type AnnotationImageContext,
  type AnnotationMetricsRow,
  type AnnotationSetRow,
  type MorphotypeDraft,
} from "@/modules/annotations/client";
import {
  createRoiMask,
  createWorkingImage,
  loadBlobBackedImage,
  loadMaskFromUrl,
  maskToPngBlob,
  polygonArea,
  rasterizePolygon,
  readWorkingImagePixels,
  rgbToHex,
  sampleMedianRgb,
  validateRasterDimensions,
  type MaskPoint,
  type WorkingImage,
} from "@/modules/annotations/studio-browser-utils";
import {
  calculateAnnotationMetricSummary,
  calculateCoverage,
  calculateMaskArea,
  calculateMaskBounds,
  clipMask,
} from "@/modules/annotations/studio-mask-utils";
import type {
  ColorAnalysisStage,
  ColorPaletteCandidate,
  ColorWorkerRequest,
  ColorWorkerResponse,
  SimilarColorComponent,
} from "@/modules/annotations/color-worker-types";

const MAX_WORKING_DIMENSION = 1024;
const SEGMENT_DEBOUNCE_MS = 250;
const COLOR_DEBOUNCE_MS = 250;
const COLOR_ANALYSIS_TIMEOUT_MS = 15_000;
const MAX_HISTORY_ENTRIES = 25;
const MAX_HISTORY_BYTES = 12 * 1024 * 1024;
const TRUNK_NOTE = "Tronco evaluable";
const LAYER_NAME_PREFIX = "Nombre de capa: ";
const COLOR_WORKER_URL = new URL("./color-selection.worker.ts", import.meta.url);

type StudioTool = "select" | "ai" | "lasso" | "brush" | "eraser" | "eyedropper" | "similar";
type CandidateTarget = "trunk" | "region";
type StudioState =
  | "loading-image"
  | "selecting-trunk"
  | "proposing-trunk"
  | "reviewing-trunk"
  | "trunk-confirmed"
  | "analyzing-colors"
  | "exploring-candidates"
  | "proposing-region"
  | "reviewing-region"
  | "classifying-region"
  | "saving-region"
  | "ready-for-next-region"
  | "reviewing-layers"
  | "error";

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

interface ColorRequestMetadata {
  sampleRgb: [number, number, number];
  toleranceDeltaE: number;
}

type ColorTerminalResponse = Extract<ColorWorkerResponse, { type: "palette" | "result" }>;

interface PendingColorRequest {
  resolve: (response: ColorTerminalResponse) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type ColorAnalysisFeedback =
  | { kind: "idle"; message: null; pixelReadFailure: false }
  | { kind: "analyzing" | "success" | "empty" | "cancelled" | "error"; message: string; pixelReadFailure: boolean };

interface CandidateRenderRequest {
  mask: Uint8Array;
  opacity: number;
  target: CandidateTarget;
}

class ColorAnalysisCancelledError extends Error {}

class ColorAnalysisTimeoutError extends Error {}

function colorStageMessage(stage: ColorAnalysisStage): string {
  if (stage === "comparing-colors") return "Comparando colores…";
  if (stage === "grouping-regions") return "Agrupando regiones…";
  return "Preparando resultados…";
}

interface AnnotationStudioProps {
  imageId: string;
  imageUrl: string;
  imageName: string;
  annotationSetId: string;
  annotationStatus: "draft" | "completed";
  completedAt: string | null;
  imageContext: AnnotationImageContext;
  initialMorphotypes: MorphotypeRow[];
  initialMetrics: AnnotationMetricsRow | null;
  roi: { x: number | null; y: number | null; width: number | null; height: number | null };
  initialTool?: "ai" | "layers" | "manual";
  onChooseAnotherImage: () => void;
  onMorphotypesChange: (morphotypes: MorphotypeRow[]) => void;
  onAnnotationSetChange: (annotationSet: AnnotationSetRow) => void;
  onViewEvaluated: () => void;
  onGoToAnalysis: () => void;
  onEvaluateNext: () => Promise<boolean>;
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
  mobile_sam: "MobileSAM",
  manual: "Manual",
  color_assisted: "Asistida por color",
  automatic_four_view: "Automática 4 vistas",
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

const STEP_LABELS = [
  "Confirmar corteza",
  "Buscar líquenes",
  "Clasificar regiones",
  "Revisar y guardar",
] as const;

const STATE_STATUS: Record<StudioState, string> = {
  "loading-image": "Cargando imagen",
  "selecting-trunk": "Pulsa la corteza para iniciar la propuesta",
  "proposing-trunk": "Analizando la corteza…",
  "reviewing-trunk": "Propuesta de corteza lista para confirmar",
  "trunk-confirmed": "Corteza confirmada",
  "analyzing-colors": "Analizando colores del tronco",
  "exploring-candidates": "Pulsa una zona que quieras revisar",
  "proposing-region": "Analizando la región…",
  "reviewing-region": "Región propuesta pendiente de confirmación",
  "classifying-region": "Región lista para clasificar",
  "saving-region": "Guardando región",
  "ready-for-next-region": "Región guardada",
  "reviewing-layers": "Revisa las capas guardadas",
  error: "La operación necesita atención",
};

function stepForState(state: StudioState): number {
  if (["loading-image", "selecting-trunk", "proposing-trunk", "reviewing-trunk"].includes(state)) return 1;
  if (state === "classifying-region" || state === "saving-region") return 3;
  if (state === "reviewing-layers") return 4;
  return 2;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function sanitizeMessage(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, 240);
}

function defaultLayerTitle(region: AnnotationRegionRow, morphotypes: MorphotypeRow[]): string {
  if (region.region_role === "trunk") return TRUNK_NOTE;
  const storedName = region.notes
    ?.split("\n")
    .find((line) => line.startsWith(LAYER_NAME_PREFIX))
    ?.slice(LAYER_NAME_PREFIX.length)
    .trim();
  if (storedName) return storedName;
  if (region.classification === "lichen") {
    return morphotypes.find((item) => item.id === region.morphotype_id)?.label ?? "Liquen sin morfotipo";
  }
  return CLASS_LABELS[region.classification];
}

function notesWithLayerName(notes: string | null, name: string): string {
  const remaining = (notes ?? "")
    .split("\n")
    .filter((line) => !line.startsWith(LAYER_NAME_PREFIX))
    .join("\n")
    .trim();
  return `${LAYER_NAME_PREFIX}${name}${remaining ? `\n${remaining}` : ""}`;
}

function storedGuidePoints(region: AnnotationRegionRow): PointPrompt[] {
  const normalize = (values: unknown[], label: 0 | 1): PointPrompt[] => values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const point = value as { x?: unknown; y?: unknown };
    if (typeof point.x !== "number" || typeof point.y !== "number") return [];
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return [];
    return [{ x: point.x, y: point.y, label }];
  });
  return [
    ...normalize(region.positive_points, 1),
    ...normalize(region.negative_points, 0),
  ];
}

function historyEntryBytes(entry: HistoryEntry): number {
  if (entry.kind === "mask") return entry.indices.byteLength + entry.before.byteLength + entry.after.byteLength;
  if (entry.kind === "layer-add") return entry.saveInput.mask.size;
  return 256;
}

function paintMaskCircle(
  mask: Uint8Array,
  width: number,
  height: number,
  center: MaskPoint,
  radius: number,
  value: 0 | 1,
  before: Map<number, number>,
  boundary?: Uint8Array | null,
): void {
  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(width - 1, Math.ceil(center.x + radius));
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(height - 1, Math.ceil(center.y + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (Math.hypot(x - center.x, y - center.y) > radius) continue;
      const index = y * width + x;
      if (boundary && boundary[index] === 0) continue;
      if (mask[index] === value) continue;
      if (!before.has(index)) before.set(index, mask[index]);
      mask[index] = value;
    }
  }
}

function paintReusableMaskCanvas(
  canvas: HTMLCanvasElement,
  currentImageData: ImageData | null,
  request: CandidateRenderRequest,
  width: number,
  height: number,
): ImageData {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo actualizar la vista previa de la máscara.");
  const imageData = currentImageData?.width === width && currentImageData.height === height
    ? currentImageData
    : context.createImageData(width, height);
  imageData.data.fill(0);
  const color = request.target === "trunk" ? [245, 158, 11] : [14, 165, 233];
  const alpha = Math.round(request.opacity * 255);
  for (let index = 0; index < request.mask.length; index += 1) {
    if (request.mask[index] === 0) continue;
    const pixelIndex = index * 4;
    imageData.data[pixelIndex] = color[0];
    imageData.data[pixelIndex + 1] = color[1];
    imageData.data[pixelIndex + 2] = color[2];
    imageData.data[pixelIndex + 3] = alpha;
  }
  context.putImageData(imageData, 0, 0);
  return imageData;
}

function isTrunkLayer(layer: StudioLayer): boolean {
  return layer.region.region_role === "trunk";
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
  imageId,
  imageUrl,
  imageName,
  annotationSetId,
  annotationStatus,
  completedAt,
  imageContext,
  initialMorphotypes,
  initialMetrics,
  roi,
  initialTool = "manual",
  onChooseAnotherImage,
  onMorphotypesChange,
  onAnnotationSetChange,
  onViewEvaluated,
  onGoToAnalysis,
  onEvaluateNext,
}: AnnotationStudioProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const workingImageRef = useRef<WorkingImage | null>(null);
  const candidateMaskRef = useRef<Uint8Array | null>(null);
  const initialReadOnlyRef = useRef(annotationStatus === "completed");
  const layerMasksRef = useRef<Map<string, Uint8Array>>(new Map());
  const historyRef = useRef<HistoryEntry[]>([]);
  const redoRef = useRef<HistoryEntry[]>([]);
  const historyBytesRef = useRef(0);
  const strokeRef = useRef<StrokeState | null>(null);
  const draggingPointStartRef = useRef<PointPrompt[] | null>(null);
  const mountedRef = useRef(true);
  const visionSessionRef = useRef<string | null>(null);
  const visionAbortRef = useRef<AbortController | null>(null);
  const imageLoadAbortRef = useRef<AbortController | null>(null);
  const imageObjectUrlRef = useRef<string | null>(null);
  const visionRequestRef = useRef(0);
  const segmentationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colorWorkerRef = useRef<Worker | null>(null);
  const colorRequestRef = useRef(0);
  const latestColorRequestRef = useRef(0);
  const pendingColorRequestsRef = useRef<Map<number, PendingColorRequest>>(new Map());
  const candidateOpacityRef = useRef(0.55);
  const candidateTargetRef = useRef<CandidateTarget>("trunk");
  const lastColorMetadataRef = useRef<ColorRequestMetadata | null>(null);
  const candidateCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const candidateImageDataRef = useRef<ImageData | null>(null);
  const candidateRenderFrameRef = useRef<number | null>(null);
  const candidateRenderRequestRef = useRef<CandidateRenderRequest | null>(null);
  const stageSizeRef = useRef({ width: 900, height: 620 });

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
  const [colorPalette, setColorPalette] = useState<ColorPaletteCandidate[]>([]);
  const [colorAnalysisFeedback, setColorAnalysisFeedback] = useState<ColorAnalysisFeedback>({
    kind: "idle",
    message: null,
    pixelReadFailure: false,
  });
  const [colorComponents, setColorComponents] = useState<SimilarColorComponent[]>([]);
  const [excludedComponents, setExcludedComponents] = useState<Set<number>>(new Set());
  const [layers, setLayers] = useState<StudioLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [morphotypes, setMorphotypes] = useState(initialMorphotypes);
  const [storedMetrics, setStoredMetrics] = useState(initialMetrics);
  const [classification, setClassification] = useState<AnnotationRegionClassification>("lichen");
  const [morphotypeId, setMorphotypeId] = useState<string | null>(initialMorphotypes[0]?.id ?? null);
  const [showNewMorphotype, setShowNewMorphotype] = useState(false);
  const [newMorphotype, setNewMorphotype] = useState({
    label: "",
    growthForm: "unknown" as MorphotypeRow["growth_form"],
    notes: "",
  });
  const [notes, setNotes] = useState("");
  const [studioState, setStudioState] = useState<StudioState>("loading-image");
  const [lastSavedMessage, setLastSavedMessage] = useState<string | null>(null);
  const [clickFeedback, setClickFeedback] = useState<MaskPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"loading" | "prepare" | "segment" | "save" | "delete" | "complete" | "reopen" | "cleanup" | null>("loading");
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const [coverage, setCoverage] = useState(() => calculateCoverage(null, []));
  const [pendingCleanupPaths, setPendingCleanupPaths] = useState<string[]>([]);
  const [completionSummary, setCompletionSummary] = useState<{
    completedAt: string;
    evaluatedRegionCount: number;
    lichenRegionCount: number;
    morphotypeLabels: string[];
    coveragePercent: number | null;
  } | null>(null);
  const [noPendingImages, setNoPendingImages] = useState(false);

  const fitScale = workingImage
    ? Math.min(stageSize.width / workingImage.width, stageSize.height / workingImage.height)
    : 1;
  const displayScale = fitScale * view.zoom;
  const trunkLayer = layers.find(isTrunkLayer) ?? null;
  const currentStep = stepForState(studioState);
  const selectedLayer = layers.find((layer) => layer.region.id === selectedLayerId) ?? null;
  const isReadOnly = annotationStatus === "completed";
  const selectedLayerHasUnsavedClassification = Boolean(
    selectedLayer
    && !isTrunkLayer(selectedLayer)
    && (
      selectedLayer.region.classification !== classification
      || selectedLayer.region.morphotype_id !== (classification === "lichen" ? morphotypeId : null)
    ),
  );
  const hasUnsavedChanges = Boolean(
    candidateMetadata
    || polygonPoints.length > 0
    || selectedLayerHasUnsavedClassification
    || pendingCleanupPaths.length > 0
    || busy === "save"
    || busy === "delete",
  );

  const bumpHistory = useCallback(() => {
    setHistoryCounts({ undo: historyRef.current.length, redo: redoRef.current.length });
  }, []);

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

  const renderCandidate = useCallback((
    mask = candidateMaskRef.current,
    opacity = candidateOpacityRef.current,
    target = candidateTargetRef.current,
  ) => {
    const image = workingImageRef.current;
    if (!image || !mask) {
      if (candidateRenderFrameRef.current !== null) {
        cancelAnimationFrame(candidateRenderFrameRef.current);
        candidateRenderFrameRef.current = null;
      }
      candidateRenderRequestRef.current = null;
      setCandidateCanvas(null);
      return;
    }
    candidateRenderRequestRef.current = { mask, opacity, target };
    if (candidateRenderFrameRef.current !== null) return;
    candidateRenderFrameRef.current = requestAnimationFrame(() => {
      candidateRenderFrameRef.current = null;
      const nextImage = workingImageRef.current;
      const request = candidateRenderRequestRef.current;
      if (!nextImage || !request) return;
      const canvas = candidateCanvasRef.current ?? document.createElement("canvas");
      try {
        candidateImageDataRef.current = paintReusableMaskCanvas(
          canvas,
          candidateImageDataRef.current,
          request,
          nextImage.width,
          nextImage.height,
        );
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "No se pudo mostrar la máscara.");
        return;
      }
      candidateCanvasRef.current = canvas;
      setCandidateCanvas(canvas);
      setCanvasRevision((current) => current + 1);
    });
  }, []);

  const renderLayers = useCallback((nextLayers: StudioLayer[], nextSelectedId: string | null) => {
    const image = workingImageRef.current;
    if (!image) return;
    const canvas = document.createElement("canvas");
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
    setLayersCanvas(canvas);
    setCanvasRevision((current) => current + 1);
  }, []);

  const clearMaskHistory = useCallback(() => {
    historyRef.current = historyRef.current.filter((entry) => entry.kind !== "mask");
    redoRef.current = redoRef.current.filter((entry) => entry.kind !== "mask");
    historyBytesRef.current = historyRef.current.reduce((sum, entry) => sum + historyEntryBytes(entry), 0);
    bumpHistory();
  }, [bumpHistory]);

  const setCandidate = useCallback((mask: Uint8Array | null, metadata: CandidateMetadata | null) => {
    if (mask) clearMaskHistory();
    candidateMaskRef.current = mask;
    setCandidateMetadata(metadata);
    if (!mask) {
      setCandidateCanvas(null);
      setColorComponents([]);
      setExcludedComponents(new Set());
      return;
    }
    renderCandidate(mask);
  }, [clearMaskHistory, renderCandidate, setCandidateCanvas, setCandidateMetadata, setColorComponents, setExcludedComponents]);

  const clearCandidateHistory = useCallback(() => {
    historyRef.current = historyRef.current.filter((entry) => entry.kind === "layer-add" || entry.kind === "visibility");
    redoRef.current = redoRef.current.filter((entry) => entry.kind === "layer-add" || entry.kind === "visibility");
    historyBytesRef.current = historyRef.current.reduce((sum, entry) => sum + historyEntryBytes(entry), 0);
    bumpHistory();
  }, [bumpHistory]);

  const resetCandidate = useCallback(() => {
    setCandidate(null, null);
    setPoints([]);
    setCandidates([]);
    setPolygonPoints([]);
    setNotes("");
    clearCandidateHistory();
  }, [clearCandidateHistory, setCandidate, setCandidates, setNotes, setPoints, setPolygonPoints]);

  const fitToScreen = useCallback(() => {
    setView({ x: 0, y: 0, zoom: 1 });
  }, []);

  const focusMask = useCallback((mask: Uint8Array) => {
    const image = workingImageRef.current;
    if (!image) return;
    const currentStageSize = stageSizeRef.current;
    const bounds = calculateMaskBounds(mask, image.width, image.height);
    if (!bounds) return;
    const baseScale = Math.min(currentStageSize.width / image.width, currentStageSize.height / image.height);
    const paddedWidth = Math.max(1, bounds.width * 1.14);
    const paddedHeight = Math.max(1, bounds.height * 1.14);
    const targetScale = Math.min(currentStageSize.width / paddedWidth, currentStageSize.height / paddedHeight);
    const zoom = Math.max(0.5, Math.min(6, targetScale / baseScale));
    const display = baseScale * zoom;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    setView({
      zoom,
      x: (image.width / 2 - centerX) * display,
      y: (image.height / 2 - centerY) * display,
    });
  }, [setView]);

  const nextColorRequestId = useCallback(() => {
    const requestId = colorRequestRef.current + 1;
    colorRequestRef.current = requestId;
    return requestId;
  }, []);

  const rejectPendingColorRequests = useCallback((reason: Error) => {
    for (const pending of pendingColorRequestsRef.current.values()) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }
    pendingColorRequestsRef.current.clear();
  }, []);

  const createColorWorker = useCallback(() => {
    const worker = new Worker(COLOR_WORKER_URL, { type: "module" });
    worker.onmessage = (event: MessageEvent<ColorWorkerResponse>) => {
      const response = event.data;
      if (!response || !Number.isSafeInteger(response.requestId)) {
        rejectPendingColorRequests(new Error("El worker devolvió una respuesta inválida."));
        return;
      }
      if (!mountedRef.current || response.requestId !== latestColorRequestRef.current) return;
      if (response.type === "progress") {
        setColorAnalysisFeedback({
          kind: "analyzing",
          message: colorStageMessage(response.stage),
          pixelReadFailure: false,
        });
        return;
      }
      const pending = pendingColorRequestsRef.current.get(response.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingColorRequestsRef.current.delete(response.requestId);
      if (response.type === "error") {
        pending.reject(new Error(response.message));
      } else {
        pending.resolve(response);
      }
    };
    const failWorker = () => {
      if (colorWorkerRef.current !== worker) return;
      colorWorkerRef.current = null;
      worker.terminate();
      rejectPendingColorRequests(new Error("El análisis de colores se interrumpió."));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      failWorker();
    };
    worker.onmessageerror = failWorker;
    return worker;
  }, [rejectPendingColorRequests, setColorAnalysisFeedback]);

  const ensureColorWorker = useCallback(() => {
    const current = colorWorkerRef.current;
    if (current) return current;
    const worker = createColorWorker();
    colorWorkerRef.current = worker;
    return worker;
  }, [createColorWorker]);

  const cancelColorAnalysis = useCallback((announce: boolean) => {
    const hadPendingRequest = pendingColorRequestsRef.current.size > 0;
    const hadScheduledRequest = colorTimerRef.current !== null;
    if (colorTimerRef.current) {
      clearTimeout(colorTimerRef.current);
      colorTimerRef.current = null;
    }
    const cancelRequestId = nextColorRequestId();
    latestColorRequestRef.current = cancelRequestId;
    try {
      colorWorkerRef.current?.postMessage({
        type: "cancel",
        requestId: cancelRequestId,
      } satisfies ColorWorkerRequest);
    } catch {
      colorWorkerRef.current?.terminate();
      colorWorkerRef.current = null;
    }
    rejectPendingColorRequests(new ColorAnalysisCancelledError("Análisis cancelado."));
    if (announce && (hadPendingRequest || hadScheduledRequest) && mountedRef.current) {
      setColorAnalysisFeedback({
        kind: "cancelled",
        message: "Análisis cancelado. Puedes reintentarlo o seleccionar una zona directamente.",
        pixelReadFailure: false,
      });
      setStudioState("exploring-candidates");
    }
  }, [nextColorRequestId, rejectPendingColorRequests, setColorAnalysisFeedback, setStudioState]);

  const sendColorRequest = useCallback((
    request: Exclude<ColorWorkerRequest, { type: "configure" | "cancel" }>,
    configuration?: {
      width: number;
      height: number;
      rgba: ArrayBuffer;
      scopeMask: ArrayBuffer;
    },
  ): Promise<ColorTerminalResponse> => {
    const worker = ensureColorWorker();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = pendingColorRequestsRef.current.get(request.requestId);
        if (!pending) return;
        pendingColorRequestsRef.current.delete(request.requestId);
        const cancelRequestId = nextColorRequestId();
        latestColorRequestRef.current = cancelRequestId;
        try {
          worker.postMessage({ type: "cancel", requestId: cancelRequestId } satisfies ColorWorkerRequest);
        } catch {
          worker.terminate();
          if (colorWorkerRef.current === worker) colorWorkerRef.current = null;
        }
        reject(new ColorAnalysisTimeoutError("El análisis de colores superó el tiempo permitido."));
      }, COLOR_ANALYSIS_TIMEOUT_MS);
      pendingColorRequestsRef.current.set(request.requestId, { resolve, reject, timeout });
      try {
        if (configuration) {
          worker.postMessage({
            type: "configure",
            requestId: request.requestId,
            width: configuration.width,
            height: configuration.height,
            rgba: configuration.rgba,
            scopeMask: configuration.scopeMask,
          } satisfies ColorWorkerRequest, [configuration.rgba, configuration.scopeMask]);
        }
        worker.postMessage(request);
      } catch {
        clearTimeout(timeout);
        pendingColorRequestsRef.current.delete(request.requestId);
        reject(new Error("No se pudo iniciar el análisis de colores."));
      }
    });
  }, [ensureColorWorker, nextColorRequestId]);

  const analyzeTrunkColors = useCallback(async (trunkMask: Uint8Array) => {
    cancelColorAnalysis(false);
    const requestId = nextColorRequestId();
    latestColorRequestRef.current = requestId;
    let shouldFinalize = true;
    setColorPalette([]);
    setError(null);
    setColorAnalysisFeedback({
      kind: "analyzing",
      message: "Preparando píxeles…",
      pixelReadFailure: false,
    });
    setStudioState("analyzing-colors");
    try {
      const image = workingImageRef.current;
      if (!image) throw new Error("La imagen de trabajo no está preparada.");
      const pixelCount = validateRasterDimensions(image.width, image.height, MAX_WORKING_DIMENSION);
      if (trunkMask.length !== pixelCount) {
        throw new Error("La máscara del tronco no coincide con las dimensiones de la imagen.");
      }
      const rgba = readWorkingImagePixels(image);
      const rgbaBuffer = rgba.slice().buffer;
      const scopeBuffer = trunkMask.slice().buffer;
      const response = await sendColorRequest({
        type: "palette",
        requestId,
        maximumColors: 8,
        minimumPercentage: 0.35,
      }, {
        width: image.width,
        height: image.height,
        rgba: rgbaBuffer,
        scopeMask: scopeBuffer,
      });
      if (requestId !== latestColorRequestRef.current || !mountedRef.current) {
        shouldFinalize = false;
        return;
      }
      if (response.type !== "palette") throw new Error("El worker devolvió un resultado de color inesperado.");
      setColorPalette(response.candidates);
      if (response.candidates.length === 0) {
        setColorAnalysisFeedback({
          kind: "empty",
          message: "No encontramos grupos de color claros. Puedes seleccionar una zona manualmente.",
          pixelReadFailure: false,
        });
      } else {
        setColorAnalysisFeedback({
          kind: "success",
          message: `Encontramos ${response.candidates.length} colores para revisar`,
          pixelReadFailure: false,
        });
      }
    } catch (reason) {
      if (reason instanceof ColorAnalysisCancelledError) {
        shouldFinalize = false;
        return;
      }
      const timedOut = reason instanceof ColorAnalysisTimeoutError;
      if (!timedOut && requestId !== latestColorRequestRef.current) {
        shouldFinalize = false;
        return;
      }
      const pixelReadFailure = reason instanceof Error
        && reason.message === "No fue posible leer los colores de esta imagen.";
      const message = pixelReadFailure
        ? "No fue posible leer los colores de esta imagen."
        : reason instanceof Error
          ? sanitizeMessage(reason.message)
          : "No se pudo completar el análisis de colores.";
      setError(message);
      setColorAnalysisFeedback({ kind: "error", message, pixelReadFailure });
    } finally {
      if (shouldFinalize && mountedRef.current) setStudioState("exploring-candidates");
    }
  }, [cancelColorAnalysis, nextColorRequestId, sendColorRequest, setColorAnalysisFeedback, setColorPalette, setError, setStudioState]);

  const updateCoverage = useCallback((nextLayers: StudioLayer[]) => {
    const nextTrunk = nextLayers.find(isTrunkLayer);
    const trunkMask = nextTrunk ? layerMasksRef.current.get(nextTrunk.region.id) ?? null : null;
    const lichenMasks = nextLayers
      .filter((layer) => layer.region.classification === "lichen")
      .map((layer) => layerMasksRef.current.get(layer.region.id))
      .filter((mask): mask is Uint8Array => Boolean(mask));
    setCoverage(calculateCoverage(trunkMask, lichenMasks));
  }, []);

  const refreshLayerCanvases = useCallback((nextLayers: StudioLayer[], nextSelectedId = selectedLayerId) => {
    setLayers(nextLayers);
    renderLayers(nextLayers, nextSelectedId);
    updateCoverage(nextLayers);
  }, [renderLayers, selectedLayerId, updateCoverage]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const updateSize = () => {
      const width = Math.max(320, host.clientWidth);
      const height = Math.max(420, Math.min(720, window.innerHeight - 260));
      const nextSize = { width, height };
      stageSizeRef.current = nextSize;
      setStageSize(nextSize);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    candidateOpacityRef.current = candidateOpacity;
    candidateTargetRef.current = candidateTarget;
  }, [candidateOpacity, candidateTarget]);

  useEffect(() => {
    mountedRef.current = true;
    try {
      colorWorkerRef.current = createColorWorker();
    } catch {
      colorWorkerRef.current = null;
    }
    return () => {
      mountedRef.current = false;
      cancelColorAnalysis(false);
      cancelVisionRequest();
      clearVisionSession();
      colorWorkerRef.current?.terminate();
      colorWorkerRef.current = null;
      if (candidateRenderFrameRef.current !== null) cancelAnimationFrame(candidateRenderFrameRef.current);
    };
  }, [cancelColorAnalysis, cancelVisionRequest, clearVisionSession, createColorWorker]);

  useEffect(() => {
    let cancelled = false;
    let renderTimer: number | null = null;
    let loadedObjectUrl: string | null = null;
    const controller = new AbortController();
    const load = async () => {
      const loadReadOnly = initialReadOnlyRef.current;
      setBusy("loading");
      setError(null);
      setPendingCleanupPaths([]);
      setCompletionSummary(null);
      setNoPendingImages(false);
      setStudioState("loading-image");
      cancelColorAnalysis(false);
      imageLoadAbortRef.current?.abort();
      imageLoadAbortRef.current = controller;
      if (imageObjectUrlRef.current) {
        URL.revokeObjectURL(imageObjectUrlRef.current);
        imageObjectUrlRef.current = null;
      }
      workingImageRef.current = null;
      setWorkingImage(null);
      setColorPalette([]);
      setColorAnalysisFeedback({ kind: "idle", message: null, pixelReadFailure: false });
      if (candidateRenderFrameRef.current !== null) {
        cancelAnimationFrame(candidateRenderFrameRef.current);
        candidateRenderFrameRef.current = null;
      }
      candidateRenderRequestRef.current = null;
      candidateMaskRef.current = null;
      setCandidateMetadata(null);
      setCandidateCanvas(null);
      setPoints([]);
      setCandidates([]);
      setPolygonPoints([]);
      setColorComponents([]);
      setExcludedComponents(new Set());
      setNotes("");
      layerMasksRef.current = new Map();
      historyRef.current = [];
      redoRef.current = [];
      historyBytesRef.current = 0;
      bumpHistory();
      try {
        const loaded = await loadBlobBackedImage(imageUrl, controller.signal);
        loadedObjectUrl = loaded.objectUrl;
        if (cancelled) {
          URL.revokeObjectURL(loaded.objectUrl);
          loadedObjectUrl = null;
          return;
        }
        imageObjectUrlRef.current = loaded.objectUrl;
        const prepared = createWorkingImage(loaded.element, MAX_WORKING_DIMENSION);
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
        setSelectedLayerId(loadReadOnly || initialTool === "layers" ? sorted[0]?.region.id ?? null : null);
        setCandidateTarget(sorted.some(isTrunkLayer) ? "region" : "trunk");
        const loadedTrunk = sorted.find(isTrunkLayer);
        setStudioState(loadReadOnly ? "reviewing-layers" : loadedTrunk ? "trunk-confirmed" : "selecting-trunk");
        setActiveTool(loadReadOnly ? "select" : "ai");
        updateCoverage(sorted);
        setBusy(null);
        renderTimer = window.setTimeout(() => {
          if (cancelled) return;
          renderLayers(sorted, loadReadOnly || initialTool === "layers" ? sorted[0]?.region.id ?? null : null);
          if (loadedTrunk) {
            const mask = layerMasksRef.current.get(loadedTrunk.region.id);
            if (mask) {
              focusMask(mask);
              if (!loadReadOnly) void analyzeTrunkColors(mask);
            }
          }
        }, 0);
      } catch (reason) {
        if (!cancelled && (reason as { name?: string }).name !== "AbortError") {
          setBusy(null);
          setError(reason instanceof Error ? sanitizeMessage(reason.message) : "No se pudo abrir el editor.");
          setStudioState("error");
          if (loadedObjectUrl) {
            URL.revokeObjectURL(loadedObjectUrl);
            if (imageObjectUrlRef.current === loadedObjectUrl) imageObjectUrlRef.current = null;
            loadedObjectUrl = null;
          }
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (imageLoadAbortRef.current === controller) imageLoadAbortRef.current = null;
      if (renderTimer) clearTimeout(renderTimer);
      cancelColorAnalysis(false);
      cancelVisionRequest();
      clearVisionSession();
      if (loadedObjectUrl) {
        URL.revokeObjectURL(loadedObjectUrl);
        if (imageObjectUrlRef.current === loadedObjectUrl) imageObjectUrlRef.current = null;
        loadedObjectUrl = null;
      }
    };
  }, [analyzeTrunkColors, annotationSetId, bumpHistory, cancelColorAnalysis, cancelVisionRequest, clearVisionSession, focusMask, imageUrl, initialTool, onMorphotypesChange, renderLayers, updateCoverage]);

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
    setStudioState(candidateTarget === "trunk" ? "proposing-trunk" : "proposing-region");
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
  }, [cancelVisionRequest, candidateTarget, clearVisionSession, setStudioState]);

  const applyMobileSamCandidate = useCallback(async (nextIndex: number, nextCandidates = candidates) => {
    const selected = nextCandidates[nextIndex];
    const image = workingImageRef.current;
    if (!selected || !image) return;
    try {
      let mask = await loadMaskFromUrl(selected.maskDataUrl, image.width, image.height);
      if (candidateTarget === "region" && trunkLayer) {
        const trunkMask = layerMasksRef.current.get(trunkLayer.region.id);
        if (trunkMask) mask = clipMask(mask, trunkMask);
      }
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
  }, [candidateTarget, candidates, sampledRgb, setCandidate, trunkLayer]);

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
    setStudioState(candidateTarget === "trunk" ? "proposing-trunk" : "proposing-region");
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
      setStudioState(candidateTarget === "trunk" ? "reviewing-trunk" : "reviewing-region");
    } catch (reason) {
      if ((reason as { name?: string }).name !== "AbortError" && mountedRef.current) {
        setBusy(null);
        setError("No se pudo generar la selección IA.");
        setStudioState("error");
      }
    }
  }, [applyMobileSamCandidate, candidateMetadata?.source, candidateTarget, prepareVision, setCandidate, setStudioState]);

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
    const trunkMask = candidateTarget === "region" && trunkLayer
      ? layerMasksRef.current.get(trunkLayer.region.id)
      : null;
    paintMaskCircle(mask, image.width, image.height, center, brushSize / 2, value, before, trunkMask);
  }, [brushSize, candidateTarget, sampledRgb, trunkLayer]);

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
    if (calculateMaskArea(mask) > 0) {
      setStudioState(candidateTarget === "trunk" ? "reviewing-trunk" : "reviewing-region");
    }
  }, [candidateTarget, pushHistory, renderCandidate, setStudioState]);

  const finishPolygon = useCallback(() => {
    const image = workingImageRef.current;
    if (!image || polygonPoints.length < 3 || polygonArea(polygonPoints) < 4) {
      setError("El polígono debe tener al menos tres vértices y un área mayor que cero.");
      return;
    }
    let next = rasterizePolygon(polygonPoints, image.width, image.height);
    if (candidateTarget === "region" && trunkLayer) {
      const trunkMask = layerMasksRef.current.get(trunkLayer.region.id);
      if (trunkMask) next = clipMask(next, trunkMask);
    }
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
    setStudioState(candidateTarget === "trunk" ? "reviewing-trunk" : "reviewing-region");
  }, [candidateTarget, polygonPoints, pushHistory, sampledRgb, setCandidate, setStudioState, trunkLayer]);

  const sampleColor = useCallback((point: MaskPoint) => {
    const image = workingImageRef.current;
    if (!image) return;
    try {
      const rgb = sampleMedianRgb(image.canvas, point.x, point.y, 7);
      setSampledRgb(rgb);
      setSampleConfirmed(false);
      setColorComponents([]);
      setExcludedComponents(new Set());
      setError(null);
      setStudioState("exploring-candidates");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo muestrear el color.");
    }
  }, [setColorComponents, setError, setExcludedComponents, setSampleConfirmed, setSampledRgb, setStudioState]);

  const requestSimilarColors = useCallback(async () => {
    const image = workingImageRef.current;
    if (!image || !sampledRgb) return;
    cancelColorAnalysis(false);
    const requestId = nextColorRequestId();
    latestColorRequestRef.current = requestId;
    let shouldFinalize = true;
    const requestMetadata: ColorRequestMetadata = {
      sampleRgb: [...sampledRgb],
      toleranceDeltaE: colorTolerance,
    };
    lastColorMetadataRef.current = requestMetadata;
    setColorComponents([]);
    setExcludedComponents(new Set());
    setError(null);
    setColorAnalysisFeedback({
      kind: "analyzing",
      message: "Preparando píxeles…",
      pixelReadFailure: false,
    });
    setStudioState("analyzing-colors");
    try {
      const pixelCount = validateRasterDimensions(image.width, image.height, MAX_WORKING_DIMENSION);
      const trunkMask = trunkLayer ? layerMasksRef.current.get(trunkLayer.region.id) : null;
      const scope = trunkMask ?? createRoiMask(image.width, image.height, roi);
      if (scope.length !== pixelCount) {
        throw new Error("La máscara del tronco no coincide con las dimensiones de la imagen.");
      }
      const rgba = readWorkingImagePixels(image);
      const rgbaBuffer = rgba.slice().buffer;
      const scopeBuffer = scope.slice().buffer;
      const response = await sendColorRequest({
        type: "select",
        requestId,
        sampleRgb: requestMetadata.sampleRgb,
        toleranceDeltaE: requestMetadata.toleranceDeltaE,
        minimumArea,
      }, {
        width: image.width,
        height: image.height,
        rgba: rgbaBuffer,
        scopeMask: scopeBuffer,
      });
      if (requestId !== latestColorRequestRef.current || !mountedRef.current) {
        shouldFinalize = false;
        return;
      }
      if (response.type !== "result") throw new Error("El worker devolvió un resultado de color inesperado.");
      const mask = new Uint8Array(response.mask);
      if (mask.length !== pixelCount) {
        throw new Error("La máscara de color no coincide con las dimensiones de la imagen.");
      }
      if (response.components.length === 0 || calculateMaskArea(mask) === 0) {
        setCandidate(null, null);
        setColorAnalysisFeedback({
          kind: "empty",
          message: "No encontramos grupos de color claros. Puedes seleccionar una zona manualmente.",
          pixelReadFailure: false,
        });
        return;
      }
      setCandidate(mask, {
        source: "color_assisted",
        score: null,
        modelName: "CIELAB Delta E 1976",
        modelVersion: "D65",
        representativeColorHex: rgbToHex(requestMetadata.sampleRgb),
        colorToleranceDeltaE: requestMetadata.toleranceDeltaE,
      });
      setColorComponents(response.components);
      setColorAnalysisFeedback({
        kind: "success",
        message: "Las regiones de color están listas para revisar.",
        pixelReadFailure: false,
      });
    } catch (reason) {
      if (reason instanceof ColorAnalysisCancelledError) {
        shouldFinalize = false;
        return;
      }
      const timedOut = reason instanceof ColorAnalysisTimeoutError;
      if (!timedOut && requestId !== latestColorRequestRef.current) {
        shouldFinalize = false;
        return;
      }
      const pixelReadFailure = reason instanceof Error
        && reason.message === "No fue posible leer los colores de esta imagen.";
      const message = pixelReadFailure
        ? "No fue posible leer los colores de esta imagen."
        : reason instanceof Error
          ? sanitizeMessage(reason.message)
          : "No se pudo completar el análisis de colores.";
      setError(message);
      setCandidate(null, null);
      setColorAnalysisFeedback({ kind: "error", message, pixelReadFailure });
    } finally {
      if (shouldFinalize && mountedRef.current) setStudioState("exploring-candidates");
    }
  }, [cancelColorAnalysis, colorTolerance, minimumArea, nextColorRequestId, roi, sampledRgb, sendColorRequest, setCandidate, setColorAnalysisFeedback, setColorComponents, setError, setExcludedComponents, setStudioState, trunkLayer]);

  useEffect(() => {
    if (activeTool !== "similar" || !sampledRgb) return;
    cancelColorAnalysis(false);
    if (colorTimerRef.current) clearTimeout(colorTimerRef.current);
    colorTimerRef.current = setTimeout(() => {
      colorTimerRef.current = null;
      void requestSimilarColors();
    }, COLOR_DEBOUNCE_MS);
    return () => {
      if (colorTimerRef.current) {
        clearTimeout(colorTimerRef.current);
        colorTimerRef.current = null;
      }
    };
  }, [activeTool, cancelColorAnalysis, colorTolerance, minimumArea, requestSimilarColors, sampledRgb]);

  const toggleColorComponent = useCallback(async (componentId: number) => {
    const nextExcluded = new Set(excludedComponents);
    if (nextExcluded.has(componentId)) nextExcluded.delete(componentId);
    else nextExcluded.add(componentId);
    setExcludedComponents(nextExcluded);
    const requestMetadata = lastColorMetadataRef.current;
    if (!requestMetadata) return;
    cancelColorAnalysis(false);
    const requestId = nextColorRequestId();
    latestColorRequestRef.current = requestId;
    let shouldFinalize = true;
    setError(null);
    setColorAnalysisFeedback({
      kind: "analyzing",
      message: "Preparando resultados…",
      pixelReadFailure: false,
    });
    setStudioState("analyzing-colors");
    try {
      const image = workingImageRef.current;
      if (!image) throw new Error("La imagen de trabajo no está preparada.");
      const pixelCount = validateRasterDimensions(image.width, image.height, MAX_WORKING_DIMENSION);
      const response = await sendColorRequest({
        type: "components",
        requestId,
        excludedComponentIds: [...nextExcluded],
      });
      if (requestId !== latestColorRequestRef.current || !mountedRef.current) {
        shouldFinalize = false;
        return;
      }
      if (response.type !== "result") throw new Error("El worker devolvió un resultado de color inesperado.");
      const mask = new Uint8Array(response.mask);
      if (mask.length !== pixelCount) {
        throw new Error("La máscara de color no coincide con las dimensiones de la imagen.");
      }
      setCandidate(mask, {
        source: "color_assisted",
        score: null,
        modelName: "CIELAB Delta E 1976",
        modelVersion: "D65",
        representativeColorHex: rgbToHex(requestMetadata.sampleRgb),
        colorToleranceDeltaE: requestMetadata.toleranceDeltaE,
      });
      setColorComponents(response.components);
      setColorAnalysisFeedback({
        kind: "success",
        message: "Las regiones de color están listas para revisar.",
        pixelReadFailure: false,
      });
    } catch (reason) {
      if (reason instanceof ColorAnalysisCancelledError) {
        shouldFinalize = false;
        return;
      }
      const timedOut = reason instanceof ColorAnalysisTimeoutError;
      if (!timedOut && requestId !== latestColorRequestRef.current) {
        shouldFinalize = false;
        return;
      }
      const message = reason instanceof Error
        ? sanitizeMessage(reason.message)
        : "No se pudo actualizar la selección por color.";
      setError(message);
      setColorAnalysisFeedback({ kind: "error", message, pixelReadFailure: false });
    } finally {
      if (shouldFinalize && mountedRef.current) setStudioState("exploring-candidates");
    }
  }, [cancelColorAnalysis, excludedComponents, nextColorRequestId, sendColorRequest, setCandidate, setColorAnalysisFeedback, setColorComponents, setError, setExcludedComponents, setStudioState]);

  const selectColorCandidate = useCallback((candidate: ColorPaletteCandidate) => {
    resetCandidate();
    setCandidateTarget("region");
    setSampledRgb(candidate.rgb);
    setSampleConfirmed(true);
    setActiveTool("similar");
    setError(null);
    setColorAnalysisFeedback({
      kind: "analyzing",
      message: "Preparando píxeles…",
      pixelReadFailure: false,
    });
    setStudioState("analyzing-colors");
  }, [resetCandidate, setActiveTool, setCandidateTarget, setSampleConfirmed, setSampledRgb, setStudioState]);

  const discardRegionCandidate = useCallback(() => {
    resetCandidate();
    setActiveTool("ai");
    setCandidateTarget("region");
    setStudioState("exploring-candidates");
  }, [resetCandidate, setActiveTool, setCandidateTarget, setStudioState]);

  const retryTrunkProposal = useCallback(() => {
    cancelColorAnalysis(false);
    resetCandidate();
    setCandidateTarget("trunk");
    setActiveTool("ai");
    setStudioState("selecting-trunk");
    fitToScreen();
  }, [cancelColorAnalysis, fitToScreen, resetCandidate, setActiveTool, setCandidateTarget, setStudioState]);

  const editTrunk = useCallback(() => {
    if (!trunkLayer) return;
    const regionCount = layers.filter((layer) => !isTrunkLayer(layer)).length;
    if (regionCount > 0 && !window.confirm("Ya existen regiones guardadas. ¿Quieres editar la corteza manteniendo esas regiones?")) return;
    const mask = layerMasksRef.current.get(trunkLayer.region.id);
    if (!mask) return;
    cancelColorAnalysis(false);
    resetCandidate();
    setCandidateTarget("trunk");
    setPoints(storedGuidePoints(trunkLayer.region));
    const storedColor = trunkLayer.region.representative_color_hex;
    setSampledRgb(storedColor ? hexToRgb(storedColor) : null);
    setSampleConfirmed(Boolean(storedColor));
    setCandidate(mask.slice(), {
      source: trunkLayer.region.source,
      score: trunkLayer.region.score,
      modelName: trunkLayer.region.model_name,
      modelVersion: trunkLayer.region.model_version,
      representativeColorHex: trunkLayer.region.representative_color_hex,
      colorToleranceDeltaE: trunkLayer.region.color_tolerance_delta_e,
    });
    setActiveTool("brush");
    setStudioState("reviewing-trunk");
  }, [cancelColorAnalysis, layers, resetCandidate, setActiveTool, setCandidate, setCandidateTarget, setPoints, setSampleConfirmed, setSampledRgb, setStudioState, trunkLayer]);

  const retryColorAnalysis = useCallback(() => {
    const mask = trunkLayer ? layerMasksRef.current.get(trunkLayer.region.id) : null;
    if (!mask) {
      setError("No hay una máscara de tronco válida para analizar.");
      setColorAnalysisFeedback({
        kind: "error",
        message: "No hay una máscara de tronco válida para analizar.",
        pixelReadFailure: false,
      });
      setStudioState("exploring-candidates");
      return;
    }
    void analyzeTrunkColors(mask);
  }, [analyzeTrunkColors, setColorAnalysisFeedback, setError, setStudioState, trunkLayer]);

  const selectLichenDirectly = useCallback(() => {
    cancelColorAnalysis(true);
    resetCandidate();
    setError(null);
    setCandidateTarget("region");
    setActiveTool("ai");
    setColorAnalysisFeedback({
      kind: "cancelled",
      message: "Análisis automático omitido. Pulsa un punto dentro del tronco para usar MobileSAM.",
      pixelReadFailure: false,
    });
    setStudioState("exploring-candidates");
  }, [cancelColorAnalysis, resetCandidate, setActiveTool, setCandidateTarget, setColorAnalysisFeedback, setError, setStudioState]);

  const continueManually = useCallback(() => {
    cancelColorAnalysis(true);
    resetCandidate();
    setError(null);
    setCandidateTarget("region");
    setActiveTool("lasso");
    setColorAnalysisFeedback({
      kind: "cancelled",
      message: "Análisis automático omitido. Dibuja la zona de liquen dentro del tronco.",
      pixelReadFailure: false,
    });
    setStudioState("exploring-candidates");
  }, [cancelColorAnalysis, resetCandidate, setActiveTool, setCandidateTarget, setColorAnalysisFeedback, setError, setStudioState]);

  const handleCanvasPointerDown = useCallback((event: KonvaEventObject<PointerEvent>) => {
    if (isReadOnly || busy || event.target.name() === "guide-point") return;
    const point = pointFromEvent(event);
    if (!point) return;
    setClickFeedback(point);
    window.setTimeout(() => setClickFeedback(null), 450);
    const trunkMask = trunkLayer ? layerMasksRef.current.get(trunkLayer.region.id) : null;
    if (candidateTarget === "region" && trunkMask) {
      const index = Math.floor(point.y) * (workingImageRef.current?.width ?? 0) + Math.floor(point.x);
      if (trunkMask[index] === 0) {
        setError("Pulsa dentro de la corteza confirmada.");
        return;
      }
    }
    if (activeTool === "ai") {
      if (trunkLayer && ["exploring-candidates", "ready-for-next-region", "trunk-confirmed"].includes(studioState)) {
        const image = workingImageRef.current;
        if (!image) return;
        sampleColor(point);
        setSampleConfirmed(true);
        setCandidateTarget("region");
        setClassification("lichen");
        const before = points;
        const after = [...points, { x: point.x / image.width, y: point.y / image.height, label: 1 as const }];
        setPoints(after);
        pushHistory({ kind: "points", before, after });
        scheduleSegment(after);
        return;
      }
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
  }, [activeTool, addGuidePoint, applyBrushCircle, busy, candidateTarget, isReadOnly, pointFromEvent, points, pushHistory, renderCandidate, sampleColor, scheduleSegment, setCandidateTarget, setClassification, setClickFeedback, setError, setPoints, setSampleConfirmed, studioState, trunkLayer]);

  const handleCanvasPointerMove = useCallback((event: KonvaEventObject<PointerEvent>) => {
    if (isReadOnly) return;
    const stroke = strokeRef.current;
    if (!stroke) return;
    const point = pointFromEvent(event);
    if (!point) return;
    applyBrushLine(stroke.previousPoint, point, stroke.value, stroke.before);
    stroke.previousPoint = point;
    renderCandidate();
  }, [applyBrushLine, isReadOnly, pointFromEvent, renderCandidate]);

  const handleCanvasPointerUp = useCallback(() => finishStroke(), [finishStroke]);

  const handleUndo = useCallback(async () => {
    if (busy) return;
    const entry = historyRef.current.pop();
    if (!entry) return;
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
      let cleanupPending = false;
      try {
        await deleteRegionWithStorage(entry.layer.region);
      } catch (reason) {
        cleanupPending = reason instanceof RegionPersistenceError && reason.cleanupPending;
        if (reason instanceof RegionPersistenceError && reason.cleanupPending && reason.storagePath) {
          setPendingCleanupPaths((current) => [...new Set([...current, reason.storagePath as string])]);
        }
        if (!cleanupPending) {
          setError("No se pudo deshacer la aceptación de la capa.");
          historyRef.current.push(entry);
          historyBytesRef.current += historyEntryBytes(entry);
          setBusy(null);
          bumpHistory();
          return;
        }
      }
      refreshLayerCanvases(layers.filter((layer) => layer.region.id !== entry.layer.region.id));
      if (cleanupPending) setError("La capa se eliminó, pero la limpieza del archivo de máscara quedó pendiente.");
      setBusy(null);
    }
    redoRef.current.push(entry);
    bumpHistory();
  }, [bumpHistory, busy, layers, refreshLayerCanvases, renderCandidate, scheduleSegment]);

  const handleRedo = useCallback(async () => {
    if (busy) return;
    if (pendingCleanupPaths.length > 0) {
      setError("Completa la limpieza pendiente antes de rehacer una capa.");
      return;
    }
    const entry = redoRef.current.pop();
    if (!entry) return;
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
        const region = await saveAcceptedRegion({ ...entry.saveInput, overwriteExistingMask: true });
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
  }, [bumpHistory, busy, layers, pendingCleanupPaths.length, refreshLayerCanvases, renderCandidate, scheduleSegment]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLElement && target.isContentEditable
      ) {
        return;
      }
      if (event.key === "Escape" && !isReadOnly) {
        cancelColorAnalysis(true);
        setPolygonPoints([]);
        setStudioState(trunkLayer ? "exploring-candidates" : "selecting-trunk");
      }
      if (!isReadOnly && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) void handleRedo();
        else void handleUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelColorAnalysis, handleRedo, handleUndo, isReadOnly, trunkLayer]);

  const persistCandidate = async (): Promise<boolean> => {
    const image = workingImageRef.current;
    const mask = candidateMaskRef.current;
    const metadata = candidateMetadata;
    if (isReadOnly || !image || !mask || !metadata || busy) return false;
    const trunkBoundary = candidateTarget === "region" && trunkLayer
      ? layerMasksRef.current.get(trunkLayer.region.id)
      : null;
    const persistedMask = trunkBoundary ? clipMask(mask, trunkBoundary) : mask;
    const areaPixels = calculateMaskArea(persistedMask);
    if (areaPixels === 0) {
      setError("La máscara candidata está vacía.");
      return false;
    }
    const nextClassification = candidateTarget === "trunk" ? "bark" : classification;
    let selectedMorphotypeId = nextClassification === "lichen" ? morphotypeId : null;
    let nextMorphotypes = morphotypes;
    if (nextClassification === "lichen") {
      if (!sampledRgb || !sampleConfirmed) {
        setError("Confirma un color visible con el cuentagotas antes de guardar una capa de liquen.");
        return false;
      }
      const selectedColor = rgbToHex(sampledRgb);
      if (showNewMorphotype) {
        if (!newMorphotype.label.trim()) {
          setError("Escribe un nombre para el nuevo morfotipo.");
          return false;
        }
      } else {
        const selected = morphotypes.find((item) => item.id === selectedMorphotypeId);
        if (!selected) {
          setError("Selecciona un morfotipo.");
          return false;
        }
        if (selected.color_hex && selected.color_hex.toUpperCase() !== selectedColor && !window.confirm(`El morfotipo ${selected.label} ya usa ${selected.color_hex}. ¿Reemplazarlo por ${selectedColor}?`)) {
          return false;
        }
      }
    }

    setBusy("save");
    setError(null);
    setStudioState(candidateTarget === "trunk" ? "reviewing-trunk" : "saving-region");
    try {
      if (nextClassification === "lichen" && sampledRgb) {
        const selectedColor = rgbToHex(sampledRgb);
        if (showNewMorphotype) {
          const created = await createMorphotypeForAnnotationSet(
            annotationSetId,
            newMorphotype.label,
            newMorphotype.growthForm,
            selectedColor,
            newMorphotype.notes.trim() || null,
          );
          selectedMorphotypeId = created.id;
          nextMorphotypes = [...morphotypes, created];
          setMorphotypes(nextMorphotypes);
          onMorphotypesChange(nextMorphotypes);
          setMorphotypeId(created.id);
          setShowNewMorphotype(false);
          setNewMorphotype({ label: "", growthForm: "unknown", notes: "" });
        } else {
          const selected = morphotypes.find((item) => item.id === selectedMorphotypeId);
          if (selected && selected.color_hex?.toUpperCase() !== selectedColor) {
            const updated = await upsertMorphotype({
              id: selected.id,
              annotationSetId,
              label: selected.label,
              growthForm: selected.growth_form as MorphotypeDraft["growthForm"],
              colorHex: selectedColor,
              notes: selected.notes,
            });
            nextMorphotypes = morphotypes.map((item) => item.id === updated.id ? updated : item);
            setMorphotypes(nextMorphotypes);
            onMorphotypesChange(nextMorphotypes);
          }
        }
      }
      const replacingTrunk = candidateTarget === "trunk" ? trunkLayer : null;
      const id = replacingTrunk?.region.id ?? crypto.randomUUID();
      const blob = await maskToPngBlob(persistedMask, image.width, image.height);
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
        regionRole: candidateTarget === "trunk" ? "trunk" : null,
      };
      const region = replacingTrunk
        ? await replaceAcceptedTrunkRegion(replacingTrunk.region, saveInput)
        : await saveAcceptedRegion(saveInput);
      if (!mountedRef.current) return false;
      layerMasksRef.current.set(region.id, persistedMask.slice());
      const layer: StudioLayer = {
        region,
        visible: true,
        opacity: nextClassification === "bark" ? 0.28 : 0.45,
        title: defaultLayerTitle(region, nextMorphotypes),
      };
      const nextLayers = replacingTrunk
        ? sortLayers(layers.map((item) => item.region.id === region.id ? layer : item))
        : sortLayers([...layers, layer]);
      setMorphotypes(nextMorphotypes);
      onMorphotypesChange(nextMorphotypes);
      setSelectedLayerId(region.id);
      refreshLayerCanvases(nextLayers, region.id);
      if (!replacingTrunk) pushHistory({ kind: "layer-add", layer, saveInput });
      setCandidateTarget("region");
      resetCandidate();
      setShowNewMorphotype(false);
      setNewMorphotype({ label: "", growthForm: "unknown", notes: "" });
      setBusy(null);
      setActiveTool("ai");
      if (candidateTarget === "trunk") {
        focusMask(persistedMask);
        window.setTimeout(() => {
          if (mountedRef.current) analyzeTrunkColors(persistedMask);
        }, 0);
      } else {
        const morphotypeLabel = nextClassification === "lichen"
          ? nextMorphotypes.find((item) => item.id === selectedMorphotypeId)?.label
          : null;
        setLastSavedMessage(`Región guardada como ${CLASS_LABELS[nextClassification]}${morphotypeLabel ? ` — ${morphotypeLabel}` : ""}.`);
        setStudioState("ready-for-next-region");
        window.setTimeout(() => {
          if (mountedRef.current) setStudioState("exploring-candidates");
        }, 1800);
      }
      return true;
    } catch (reason) {
      if (mountedRef.current) {
        if (reason instanceof RegionPersistenceError && reason.cleanupPending && reason.storagePath) {
          setPendingCleanupPaths((current) => [...new Set([...current, reason.storagePath as string])]);
        }
        setBusy(null);
        setError(reason instanceof Error ? sanitizeMessage(reason.message) : "No se pudo guardar la capa.");
        setStudioState(candidateTarget === "trunk" ? "reviewing-trunk" : "classifying-region");
      }
      return false;
    }
  };

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
    setStudioState("reviewing-layers");
    renderLayers(layers, layer.region.id);
  }, [layers, renderLayers, setClassification, setMorphotypeId, setSelectedLayerId, setStudioState]);

  const saveSelectedLayerClassification = useCallback(async (): Promise<boolean> => {
    if (isReadOnly || !selectedLayer || busy || isTrunkLayer(selectedLayer)) return false;
    if (classification === "lichen" && !morphotypeId) {
      setError("Selecciona un morfotipo.");
      return false;
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
      setLastSavedMessage("Clasificación de la capa actualizada.");
      setBusy(null);
      return true;
    } catch {
      setBusy(null);
      setError("No se pudo actualizar la clasificación.");
      return false;
    }
  }, [annotationSetId, busy, classification, isReadOnly, layers, morphotypeId, morphotypes, refreshLayerCanvases, selectedLayer]);

  const renameLayer = async (layer: StudioLayer) => {
    if (busy || isTrunkLayer(layer)) return;
    const name = window.prompt("Nuevo nombre de la capa", layer.title)?.trim();
    if (!name || name === layer.title) return;
    setBusy("save");
    try {
      const region = await updateRegionNotes(
        layer.region.id,
        annotationSetId,
        notesWithLayerName(layer.region.notes, name),
      );
      const next = layers.map((item) => item.region.id === region.id ? { ...item, region, title: name } : item);
      refreshLayerCanvases(next, region.id);
      setLastSavedMessage("Nombre de capa actualizado.");
      setBusy(null);
    } catch {
      setBusy(null);
      setError("No se pudo renombrar la capa.");
    }
  };

  const editSelectedMorphotype = async () => {
    if (!selectedLayer?.region.morphotype_id || busy) return;
    const morphotype = morphotypes.find((item) => item.id === selectedLayer.region.morphotype_id);
    if (!morphotype) return;
    const label = window.prompt("Nombre del morfotipo", morphotype.label)?.trim();
    if (!label || label === morphotype.label) return;
    setBusy("save");
    try {
      const updated = await upsertMorphotype({
        id: morphotype.id,
        annotationSetId,
        label,
        growthForm: morphotype.growth_form as MorphotypeDraft["growthForm"],
        colorHex: morphotype.color_hex,
        notes: morphotype.notes,
      });
      const nextMorphotypes = morphotypes.map((item) => item.id === updated.id ? updated : item);
      const nextLayers = layers.map((layer) => ({
        ...layer,
        title: defaultLayerTitle(layer.region, nextMorphotypes),
      }));
      setMorphotypes(nextMorphotypes);
      onMorphotypesChange(nextMorphotypes);
      refreshLayerCanvases(nextLayers, selectedLayer.region.id);
      setLastSavedMessage("Morfotipo actualizado.");
      setBusy(null);
    } catch {
      setBusy(null);
      setError("No se pudo editar el morfotipo.");
    }
  };

  const deleteLayer = async (layer: StudioLayer) => {
    if (busy || !window.confirm(`¿Eliminar la capa “${layer.title}” y su máscara guardada?`)) return;
    if (isTrunkLayer(layer)) cancelColorAnalysis(true);
    setBusy("delete");
    let cleanupPending = false;
    try {
      await deleteRegionWithStorage(layer.region);
    } catch (reason) {
      cleanupPending = reason instanceof RegionPersistenceError && reason.cleanupPending;
      if (reason instanceof RegionPersistenceError && reason.cleanupPending && reason.storagePath) {
        setPendingCleanupPaths((current) => [...new Set([...current, reason.storagePath as string])]);
      }
      if (!cleanupPending) {
        setBusy(null);
        setError(reason instanceof Error ? sanitizeMessage(reason.message) : "No se pudo eliminar la capa.");
        return;
      }
    }
    try {
      layerMasksRef.current.delete(layer.region.id);
      const next = layers.filter((item) => item.region.id !== layer.region.id);
      setSelectedLayerId(null);
      refreshLayerCanvases(next, null);
      if (isTrunkLayer(layer)) {
        setCandidateTarget("trunk");
        setStudioState("selecting-trunk");
        fitToScreen();
      } else {
        setLastSavedMessage("Capa eliminada.");
      }
      if (cleanupPending) setError("La capa se eliminó, pero la limpieza del archivo de máscara quedó pendiente.");
      historyRef.current = [];
      redoRef.current = [];
      historyBytesRef.current = 0;
      bumpHistory();
      setBusy(null);
    } catch {
      setBusy(null);
      setError("La capa se eliminó, pero no se pudo actualizar la vista.");
    }
  };

  const retryPendingCleanup = async () => {
    if (busy || pendingCleanupPaths.length === 0) return;
    setBusy("cleanup");
    const results = await Promise.all(pendingCleanupPaths.map(async (storagePath) => {
      try {
        await retryMaskCleanup(storagePath);
        return { storagePath, succeeded: true };
      } catch {
        return { storagePath, succeeded: false };
      }
    }));
    const remaining = results.filter((result) => !result.succeeded).map((result) => result.storagePath);
    setPendingCleanupPaths(remaining);
    setBusy(null);
    if (remaining.length > 0) {
      setError("No se pudo completar toda la limpieza pendiente. Puedes volver a intentarlo.");
    } else {
      setError(null);
      setLastSavedMessage("Borrador guardado");
    }
  };

  const finalizeEvaluation = async () => {
    if (isReadOnly || busy) return;
    setNoPendingImages(false);
    if (pendingCleanupPaths.length > 0) {
      setError("Completa las operaciones de limpieza pendientes antes de finalizar.");
      return;
    }
    if (candidateMetadata || polygonPoints.length > 0 || points.length > 0) {
      setError("Confirma o descarta la región pendiente antes de finalizar.");
      return;
    }
    if (error) {
      setError("Resuelve o descarta el error actual antes de finalizar.");
      return;
    }
    if (selectedLayerHasUnsavedClassification && !await saveSelectedLayerClassification()) return;

    setBusy("complete");
    setError(null);
    try {
      const acceptedLayers = layers.filter((layer) => layer.region.status === "accepted");
      const trunk = acceptedLayers.find(isTrunkLayer) ?? null;
      const trunkMask = trunk ? layerMasksRef.current.get(trunk.region.id) ?? null : null;
      const lichenLayers = acceptedLayers.filter((layer) => layer.region.classification === "lichen");
      const lichenMasks = lichenLayers.map((layer) => layerMasksRef.current.get(layer.region.id) ?? null);
      if ((trunk && !trunkMask) || lichenMasks.some((mask) => !mask)) {
        throw new Error("No se pudieron leer todas las máscaras guardadas. El borrador se conserva.");
      }
      const metricSummary = calculateAnnotationMetricSummary(
        trunkMask,
        lichenMasks.filter((mask): mask is Uint8Array => Boolean(mask)),
      );
      const calculatedMorphotypeIds = new Set(lichenLayers.flatMap((layer) => (
        layer.region.morphotype_id ? [layer.region.morphotype_id] : []
      )));
      const result = await finalizeAnnotationSet(annotationSetId, imageId, {
        annotation_set_id: annotationSetId,
        trunk_area_pixels: metricSummary.trunkAreaPixels,
        lichen_union_area_pixels: metricSummary.lichenUnionInsideTrunkPixels,
        lichen_outside_trunk_pixels: metricSummary.lichenOutsideTrunkPixels,
        overlapping_lichen_pixels: metricSummary.overlappingLichenPixels,
        coverage_percent: metricSummary.coveragePercent,
        accepted_region_count: acceptedLayers.length,
        lichen_region_count: lichenLayers.length,
        morphotype_count: calculatedMorphotypeIds.size,
        calculation_method: "mask_union_intersection",
        calculation_version: "1.1.0",
        quality_flags: metricSummary.qualityFlags,
        calculated_at: new Date().toISOString(),
      });
      const evaluatedRegions = result.regions.filter((region) => region.region_role !== "trunk");
      const lichenRegions = evaluatedRegions.filter((region) => region.classification === "lichen");
      const usedMorphotypeIds = new Set(lichenRegions.flatMap((region) => region.morphotype_id ? [region.morphotype_id] : []));
      setCompletionSummary({
        completedAt: result.annotationSet.completed_at ?? new Date().toISOString(),
        evaluatedRegionCount: evaluatedRegions.length,
        lichenRegionCount: lichenRegions.length,
        morphotypeLabels: result.morphotypes.filter((morphotype) => usedMorphotypeIds.has(morphotype.id)).map((morphotype) => morphotype.label),
        coveragePercent: result.metrics.coverage_percent,
      });
      setStoredMetrics(result.metrics);
      setLastSavedMessage("Evaluación guardada correctamente");
      setStudioState("reviewing-layers");
      setActiveTool("select");
      setBusy(null);
      onAnnotationSetChange(result.annotationSet);
    } catch (reason) {
      setBusy(null);
      setError(reason instanceof Error ? sanitizeMessage(reason.message) : "No se pudo finalizar la evaluación. El borrador se conserva.");
    }
  };

  const reopenEvaluation = async () => {
    if (!isReadOnly || busy) return;
    if (!window.confirm("Esta evaluación está completada. ¿Deseas reabrirla para editar?")) return;
    setBusy("reopen");
    setError(null);
    try {
      const reopened = await reopenAnnotationSet(annotationSetId, imageId);
      setCompletionSummary(null);
      setNoPendingImages(false);
      setLastSavedMessage("Borrador guardado");
      setBusy(null);
      onAnnotationSetChange(reopened);
    } catch (reason) {
      setBusy(null);
      setError(reason instanceof Error ? sanitizeMessage(reason.message) : "No se pudo reabrir la evaluación.");
    }
  };

  const evaluateNextImage = async () => {
    if (busy) return;
    setBusy("loading");
    setNoPendingImages(false);
    try {
      const found = await onEvaluateNext();
      if (!found) {
        setNoPendingImages(true);
        setBusy(null);
      }
    } catch {
      setBusy(null);
      setError("No se pudo buscar la siguiente imagen pendiente.");
    }
  };

  const stageOrigin = workingImage ? {
    x: (stageSize.width - workingImage.width * displayScale) / 2 + view.x,
    y: (stageSize.height - workingImage.height * displayScale) / 2 + view.y,
  } : { x: 0, y: 0 };

  return (
    <div className="annotation-studio space-y-3" style={{ color: "var(--ld-text)" }}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Annotation Studio</h1>
          <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>{imageName}</p>
          {isReadOnly ? <p className="mt-1 text-sm font-semibold text-green-800">Evaluación completada</p> : null}
        </div>
        <button type="button" onClick={() => {
          if (pendingCleanupPaths.length > 0) {
            setError("Completa la limpieza pendiente antes de elegir otra imagen.");
            return;
          }
          if (hasUnsavedChanges && !window.confirm("Hay cambios sin guardar. ¿Deseas elegir otra imagen y conservar solo el borrador ya guardado?")) return;
          cancelColorAnalysis(false);
          onChooseAnotherImage();
        }} className="rounded border px-3 py-2 text-sm focus-visible:outline-2" style={{ borderColor: "var(--ld-border)" }}>
          Elegir otra imagen
        </button>
      </header>

      <section className="sticky top-0 z-30 rounded border bg-white p-3 shadow-md" style={{ borderColor: "var(--ld-border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{isReadOnly ? "Evaluación completada" : hasUnsavedChanges ? "Cambios sin guardar" : "Borrador guardado"}</p>
            {isReadOnly && completedAt ? <p className="text-xs" style={{ color: "var(--ld-text-secondary)" }}>{new Date(completedAt).toLocaleString()}</p> : null}
          </div>
          {isReadOnly ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => void reopenEvaluation()} className="rounded border px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--ld-border)" }}>
              {busy === "reopen" ? "Reabriendo…" : "Editar evaluación"}
            </button>
          ) : (
            <button type="button" aria-busy={busy === "complete"} disabled={Boolean(busy)} onClick={() => void finalizeEvaluation()} className="studio-primary rounded border px-5 py-3 text-sm font-semibold disabled:opacity-50">
              {busy === "complete" ? "Finalizando evaluación…" : "Finalizar y guardar evaluación"}
            </button>
          )}
        </div>
        {pendingCleanupPaths.length > 0 ? (
          <button type="button" disabled={Boolean(busy)} onClick={() => void retryPendingCleanup()} className="mt-2 rounded border px-3 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50" style={{ borderColor: "var(--ld-border)" }}>
            {busy === "cleanup" ? "Reintentando limpieza…" : "Reintentar limpieza pendiente"}
          </button>
        ) : null}
      </section>

      {completionSummary ? (
        <section className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-950" aria-live="polite">
          <h2 className="text-base font-semibold">Evaluación guardada correctamente</h2>
          <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            <dt className="font-semibold">Proyecto</dt><dd>{imageContext.projectName}</dd>
            <dt className="font-semibold">Sitio</dt><dd>{imageContext.siteName}</dd>
            <dt className="font-semibold">Jornada de muestreo</dt><dd>{imageContext.samplingEventName}</dd>
            <dt className="font-semibold">Árbol o muestra</dt><dd>{imageContext.treeCode}</dd>
            <dt className="font-semibold">Nombre de imagen</dt><dd>{imageName}</dd>
            <dt className="font-semibold">Regiones evaluadas</dt><dd>{completionSummary.evaluatedRegionCount}</dd>
            <dt className="font-semibold">Regiones de liquen</dt><dd>{completionSummary.lichenRegionCount}</dd>
            <dt className="font-semibold">Morfotipos</dt><dd>{completionSummary.morphotypeLabels.join(", ") || "Ninguno"}</dd>
            <dt className="font-semibold">Cobertura provisional</dt><dd>{completionSummary.coveragePercent == null ? "Sin datos" : `${completionSummary.coveragePercent.toFixed(1)}%`}</dd>
            <dt className="font-semibold">Fecha de finalización</dt><dd>{new Date(completionSummary.completedAt).toLocaleString()}</dd>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={onViewEvaluated} className="rounded border bg-white px-3 py-2 font-semibold" style={{ borderColor: "var(--ld-border)" }}>Ver imágenes evaluadas</button>
            <button type="button" onClick={onGoToAnalysis} className="rounded border bg-white px-3 py-2 font-semibold" style={{ borderColor: "var(--ld-border)" }}>Ir al análisis</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void evaluateNextImage()} className="studio-primary rounded border px-3 py-2 font-semibold disabled:opacity-50">Evaluar siguiente imagen</button>
          </div>
          {noPendingImages ? <p className="mt-3 font-semibold">No quedan imágenes pendientes en este sitio.</p> : null}
        </section>
      ) : null}

      <fieldset disabled={isReadOnly} className="contents">
      <div className="rounded border bg-white p-3 shadow-sm" style={{ borderColor: "var(--ld-border)" }}>
        <p className="text-base font-semibold">Paso {currentStep} de 4 — {STEP_LABELS[currentStep - 1]}</p>
        <ol className="mt-2 grid gap-2 text-xs sm:grid-cols-4" aria-label="Flujo de trabajo">
          {STEP_LABELS.map((label, index) => {
            const step = index + 1;
            return (
              <li key={label} aria-current={currentStep === step ? "step" : undefined} className="rounded border px-2 py-2 font-medium" style={{
                borderColor: currentStep === step ? "var(--ld-text)" : "var(--ld-border)",
                background: currentStep === step ? "var(--ld-sand)" : "var(--ld-card)",
              }}>
                {step}. {label}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-wrap gap-2 rounded border bg-white p-2" role="toolbar" aria-label="Herramientas de dibujo" style={{ borderColor: "var(--ld-border)" }}>
        {TOOL_LABELS.map((tool) => {
          const disabled = Boolean(busy) || tool.value === "eraser" && !candidateMetadata || tool.value === "similar" && !sampledRgb;
          return (
            <button
              key={tool.value}
              type="button"
              aria-pressed={activeTool === tool.value}
              disabled={disabled}
              onClick={() => {
                cancelColorAnalysis(true);
                setActiveTool(tool.value);
                setColorComponents([]);
                setExcludedComponents(new Set());
                if (tool.value === "ai" || tool.value === "lasso") setCandidateTarget(trunkLayer ? "region" : "trunk");
              }}
              className="rounded border px-3 py-2 text-sm font-medium"
              style={{
                borderColor: activeTool === tool.value ? "var(--ld-text)" : "var(--ld-border)",
                background: activeTool === tool.value ? "var(--ld-sand)" : "#fff",
              }}
            >
              {activeTool === tool.value ? "✓ " : ""}{tool.label}
            </button>
          );
        })}
        <button type="button" disabled={historyCounts.undo === 0 || Boolean(busy)} onClick={() => void handleUndo()} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Deshacer</button>
        <button type="button" disabled={historyCounts.redo === 0 || Boolean(busy)} onClick={() => void handleRedo()} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Rehacer</button>
        <button type="button" onClick={fitToScreen} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Ver imagen completa</button>
        {trunkLayer ? <button type="button" disabled={Boolean(busy)} onClick={editTrunk} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Editar corteza</button> : null}
        <span className="sr-only" aria-live="polite">Deshacer {historyCounts.undo}; rehacer {historyCounts.redo}</span>
      </div>
      <p className="rounded border bg-white px-3 py-2 text-sm font-medium" aria-live="polite" style={{ borderColor: "var(--ld-border)" }}>
        Herramienta activa: {activeTool === "ai" ? (candidateTarget === "trunk" ? "Seleccionar corteza" : "Buscar liquen") : TOOL_LABELS.find((tool) => tool.value === activeTool)?.label}
      </p>

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
                <input type="range" min={0.15} max={0.9} step={0.05} value={candidateOpacity} onChange={(event) => {
                  const nextOpacity = Number(event.target.value);
                  setCandidateOpacity(nextOpacity);
                  renderCandidate(candidateMaskRef.current, nextOpacity);
                }} />
              </label>
            ) : null}
          </div>

          <div
            ref={hostRef}
            className="overflow-hidden rounded bg-slate-900"
            aria-label="Lienzo de anotación"
            style={{ cursor: busy ? "wait" : activeTool === "select" ? "grab" : activeTool === "eraser" ? "cell" : "crosshair" }}
          >
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
                  {clickFeedback ? (
                    <Circle
                      x={clickFeedback.x}
                      y={clickFeedback.y}
                      radius={12 / displayScale}
                      stroke="#facc15"
                      strokeWidth={3 / displayScale}
                      listening={false}
                    />
                  ) : null}
                </Group>
              </Layer>
            </Stage>
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--ld-text-secondary)" }}>
            La IA propone un límite visual; la persona usuaria confirma si representa tronco, liquen u otra categoría.
          </p>
          <p className="mt-2 flex items-center gap-2 rounded border bg-white p-2 text-sm font-medium" aria-live="polite" style={{ borderColor: "var(--ld-border)" }}>
            {busy ? <span className="studio-spinner" aria-hidden="true" /> : null}
            {STATE_STATUS[studioState]}
          </p>
          {lastSavedMessage ? <p className="mt-2 rounded border border-green-200 bg-green-50 p-2 text-sm text-green-800" aria-live="polite">{lastSavedMessage}</p> : null}
          {error ? (
            <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700" role="alert">
              <p>{error}</p>
              {!isReadOnly ? <button type="button" onClick={() => setError(null)} className="mt-2 rounded border border-red-300 bg-white px-2 py-1 text-xs font-semibold">Descartar aviso</button> : null}
            </div>
          ) : null}
        </main>

        <aside className="space-y-3">
          <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
            <h2 className="font-semibold">Qué hacer ahora</h2>
            <p className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>
              {currentStep === 1
                ? candidateMetadata
                  ? "La IA ha propuesto la corteza. Revisa el área naranja y pulsa Confirmar corteza."
                  : "Pulsa un punto de la corteza para que MobileSAM proponga su límite."
                : currentStep === 2
                  ? "Pulsa una zona diferente de la corteza o selecciona uno de los colores encontrados."
                  : currentStep === 3
                    ? "Confirma qué contiene la región y elige un morfotipo si es liquen."
                    : "Revisa las capas guardadas y continúa buscando regiones o finaliza."}
            </p>
          </section>
          {currentStep === 1 ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Confirmar corteza</h2>
              {studioState === "proposing-trunk" ? (
                <p className="mt-3 flex items-center gap-2 text-sm"><span className="studio-spinner" aria-hidden="true" />Analizando la corteza…</p>
              ) : null}

              {candidateMetadata && candidateTarget === "trunk" ? (
                <>
                  <button type="button" aria-busy={busy === "save"} disabled={Boolean(busy)} onClick={() => void persistCandidate()} className="studio-primary mt-3 w-full rounded border px-3 py-2 text-sm font-semibold">
                    {busy === "save" ? "Guardando corteza…" : "Confirmar corteza y continuar"}
                  </button>
                  <button type="button" disabled={Boolean(busy)} onClick={() => setActiveTool("brush")} className="mt-2 w-full rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Corregir selección</button>
                  <button type="button" disabled={Boolean(busy)} onClick={retryTrunkProposal} className="mt-2 w-full rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Volver a intentar</button>
                </>
              ) : (
                <button type="button" disabled={Boolean(busy)} aria-pressed={activeTool === "ai"} onClick={() => { setCandidateTarget("trunk"); setActiveTool("ai"); }} className="studio-primary mt-3 w-full rounded border px-3 py-2 text-sm font-semibold">
                  {busy ? "Analizando la corteza…" : "Seleccionar corteza"}
                </button>
              )}
            </section>
          ) : null}

          {currentStep === 2 ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Buscar líquenes</h2>
              <p className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>La aplicación encontró colores y regiones visualmente diferentes dentro de la corteza. Pulsa una zona para revisarla. Tú decides si realmente es un liquen.</p>
              {!candidateMetadata && layers.some((layer) => !isTrunkLayer(layer)) ? <button type="button" onClick={() => setStudioState("reviewing-layers")} className="studio-primary mt-3 w-full rounded border px-3 py-2 text-sm font-semibold">Revisar capas y guardar</button> : null}
            </section>
          ) : null}

          {currentStep === 4 ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Revisión final</h2>
              <p className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>Las capas mostradas abajo ya están guardadas en este conjunto de anotación.</p>
              <button type="button" onClick={() => { setStudioState("exploring-candidates"); setActiveTool("ai"); }} className="studio-primary mt-3 w-full rounded border px-3 py-2 text-sm font-semibold">Continuar buscando regiones</button>
            </section>
          ) : null}

          {candidates.length > 1 && candidateMetadata ? (
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

          {trunkLayer && currentStep === 2 ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Colores encontrados</h2>
              <p className="mt-1 text-xs" style={{ color: "var(--ld-text-secondary)" }}>Regiones visualmente diferentes; ninguna está identificada automáticamente como liquen.</p>
              {colorAnalysisFeedback.kind === "analyzing" ? (
                <p className="mt-3 flex items-center gap-2 text-sm" aria-live="polite">
                  <span className="studio-spinner" aria-hidden="true" />
                  {colorAnalysisFeedback.message}
                </p>
              ) : colorAnalysisFeedback.message ? (
                <p className="mt-3 text-sm" aria-live="polite">{colorAnalysisFeedback.message}</p>
              ) : null}
              {["empty", "error", "cancelled"].includes(colorAnalysisFeedback.kind) ? (
                <div className="mt-3 space-y-2">
                  <button type="button" onClick={retryColorAnalysis} className="studio-primary w-full rounded border px-3 py-2 text-sm font-semibold">
                    {colorAnalysisFeedback.pixelReadFailure ? "Reintentar colores" : "Reintentar análisis"}
                  </button>
                  <button type="button" onClick={selectLichenDirectly} className="w-full rounded border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--ld-border)" }}>
                    Seleccionar liquen directamente
                  </button>
                  {colorAnalysisFeedback.pixelReadFailure ? (
                    <button type="button" onClick={continueManually} className="w-full rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>
                      Continuar seleccionando manualmente
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-2">
                {colorPalette.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    aria-pressed={sampledRgb ? rgbToHex(sampledRgb) === rgbToHex(candidate.rgb) : false}
                    disabled={Boolean(busy)}
                    onClick={() => selectColorCandidate(candidate)}
                    className="rounded border p-2 text-left text-xs"
                    style={{ borderColor: "var(--ld-border)" }}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-8 w-8 shrink-0 rounded border" style={{ background: rgbToHex(candidate.rgb), borderColor: "var(--ld-border)" }} />
                      <strong>{candidate.percentage.toFixed(1)}% del tronco</strong>
                    </span>
                    <span className="relative mt-2 block h-5 rounded bg-slate-100" aria-label="Ubicación aproximada">
                      <span className="absolute h-2 w-2 rounded-full bg-slate-900" style={{ left: `${candidate.centroidX * 100}%`, top: `${candidate.centroidY * 100}%`, transform: "translate(-50%, -50%)" }} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {sampledRgb && candidateTarget === "region" ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Muestra de color</h2>
              <div className="mt-2 flex items-center gap-3">
                <span className="h-20 w-20 rounded border" aria-label="Color muestreado" style={{ background: rgbToHex(sampledRgb), borderColor: "var(--ld-border)" }} />
                {studioState === "classifying-region" && classification === "lichen" ? (
                  <label className="text-sm">Ajustar color
                    <input className="mt-1 block h-11 w-20" type="color" value={rgbToHex(sampledRgb)} onChange={(event) => { setSampledRgb(hexToRgb(event.target.value)); setSampleConfirmed(true); }} />
                  </label>
                ) : null}
              </div>
              <details className="mt-2 text-xs"><summary>Opciones avanzadas</summary><p className="mt-1">HEX {rgbToHex(sampledRgb)} · RGB {sampledRgb.join(", ")}</p></details>
            </section>
          ) : null}

          {activeTool === "similar" && sampledRgb ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">Regiones candidatas</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" disabled={colorTolerance <= 1 || Boolean(busy)} onClick={() => setColorTolerance((value) => Math.max(1, value - 2))} className="rounded border px-2 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Menos parecido</button>
                <button type="button" disabled={colorTolerance >= 50 || Boolean(busy)} onClick={() => setColorTolerance((value) => Math.min(50, value + 2))} className="rounded border px-2 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>Más parecido</button>
              </div>
              <details className="mt-3 text-xs">
                <summary>Opciones avanzadas</summary>
                <label className="mt-2 block">Delta E: {colorTolerance}<input className="w-full" type="range" min={1} max={50} value={colorTolerance} onChange={(event) => setColorTolerance(Number(event.target.value))} /></label>
                <label className="mt-2 block">Área mínima: {minimumArea} px<input className="w-full" type="range" min={1} max={1000} value={minimumArea} onChange={(event) => setMinimumArea(Number(event.target.value))} /></label>
                <p className="mt-2">CIELAB D65 · Delta E 1976</p>
              </details>
              <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                {colorComponents.map((component, index) => (
                  <label key={component.id} className="flex items-center justify-between gap-2 text-sm">
                    <span><input type="checkbox" checked={!excludedComponents.has(component.id)} onChange={() => toggleColorComponent(component.id)} /> Componente {index + 1}</span>
                    <span>{component.areaPixels} px</span>
                  </label>
                ))}
              </div>
              {candidateMetadata?.source === "color_assisted" ? <button type="button" disabled={Boolean(busy)} onClick={() => setStudioState("reviewing-region")} className="studio-primary mt-3 w-full rounded border px-3 py-2 text-sm font-semibold">Revisar esta región</button> : null}
            </section>
          ) : null}

          {candidateMetadata && candidateTarget === "region" && studioState === "reviewing-region" ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">¿Esta región corresponde a un liquen?</h2>
              <p className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>MobileSAM y el color solo proponen el límite. Tú decides qué contiene.</p>
              <button type="button" disabled={Boolean(busy)} onClick={() => { setClassification("lichen"); setStudioState("classifying-region"); setActiveTool("select"); }} className="studio-primary mt-3 w-full rounded border px-3 py-2 text-sm font-semibold">Sí, clasificar</button>
              <button type="button" disabled={Boolean(busy)} onClick={discardRegionCandidate} className="mt-2 w-full rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>No, descartar</button>
            </section>
          ) : null}

          {candidateMetadata && candidateTarget === "region" && ["classifying-region", "saving-region"].includes(studioState) ? (
            <section className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
              <h2 className="font-semibold">¿Qué encontraste?</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {ANNOTATION_REGION_CLASSES.map((item) => (
                  <button key={item} type="button" aria-pressed={classification === item} onClick={() => setClassification(item)} className="rounded border px-2 py-3 text-sm font-medium" style={{ borderColor: classification === item ? "var(--ld-text)" : "var(--ld-border)" }}>{classification === item ? "✓ " : ""}{CLASS_LABELS[item]}</button>
                ))}
              </div>
              {classification === "lichen" ? (
                <div className="mt-3 space-y-2">
                  <h3 className="text-sm font-semibold">Morfotipo</h3>
                  <div className="space-y-2">
                    {morphotypes.map((item) => (
                      <button key={item.id} type="button" disabled={showNewMorphotype} aria-pressed={morphotypeId === item.id && !showNewMorphotype} onClick={() => setMorphotypeId(item.id)} className="flex w-full items-center gap-3 rounded border p-2 text-left text-sm" style={{ borderColor: morphotypeId === item.id && !showNewMorphotype ? "var(--ld-text)" : "var(--ld-border)" }}>
                        <span className="h-9 w-9 shrink-0 rounded border" style={{ background: item.color_hex ?? "#d1d5db", borderColor: "var(--ld-border)" }} />
                        <span><strong>{item.label}</strong><span className="block text-xs" style={{ color: "var(--ld-text-secondary)" }}>{item.growth_form}</span></span>
                      </button>
                    ))}
                  </div>
                  <button type="button" aria-pressed={showNewMorphotype} onClick={() => setShowNewMorphotype((value) => !value)} className="w-full rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>{showNewMorphotype ? "✓ " : ""}Crear nuevo morfotipo</button>
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
              <label className="mt-3 block text-sm">Notas de la región<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded border px-3 py-2" style={{ borderColor: "var(--ld-border)" }} /></label>
              <button type="button" aria-busy={busy === "save"} disabled={Boolean(busy)} onClick={() => void persistCandidate()} className="studio-primary mt-3 w-full rounded border px-3 py-2 text-sm font-semibold">{busy === "save" ? "Guardando región…" : "Guardar región"}</button>
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
                    {!isTrunkLayer(layer) ? <button type="button" disabled={Boolean(busy)} onClick={() => void renameLayer(layer)} className="rounded border px-2 py-1 disabled:opacity-40" style={{ borderColor: "var(--ld-border)" }}>Renombrar</button> : null}
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
                <>
                  <select value={morphotypeId ?? ""} onChange={(event) => setMorphotypeId(event.target.value || null)} className="mt-2 w-full rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)" }}>
                    <option value="">Selecciona morfotipo</option>
                    {morphotypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                  {selectedLayer.region.morphotype_id ? <button type="button" disabled={Boolean(busy)} onClick={() => void editSelectedMorphotype()} className="mt-2 w-full rounded border px-3 py-2 text-sm disabled:opacity-40" style={{ borderColor: "var(--ld-border)" }}>Editar morfotipo</button> : null}
                </>
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
            <p className="mt-2 text-xs font-semibold">Los resultados son descriptivos y provisionales. No constituyen por sí solos una clasificación de calidad ambiental.</p>
          </section>
        </aside>
      </div>
      </fieldset>
      {isReadOnly ? (
        <section className="rounded border bg-white p-4" style={{ borderColor: "var(--ld-border)" }}>
          <h2 className="font-semibold">Capas de la evaluación</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ld-text-secondary)" }}>Puedes inspeccionar las capas sin modificar los datos guardados.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {layers.map((layer) => {
              const morphotype = morphotypes.find((item) => item.id === layer.region.morphotype_id);
              return (
                <div key={layer.region.id} className="rounded border p-3 text-sm" style={{ borderColor: selectedLayerId === layer.region.id ? "var(--ld-text)" : "var(--ld-border)" }}>
                  <button type="button" onClick={() => selectLayer(layer)} className="w-full text-left font-semibold">{layer.title}</button>
                  <p className="mt-1">{CLASS_LABELS[layer.region.classification]}{morphotype ? ` · ${morphotype.label}` : ""}</p>
                  {layer.region.representative_color_hex ? (
                    <p className="mt-1 flex items-center gap-2">
                      <span className="h-4 w-4 rounded border" style={{ background: layer.region.representative_color_hex, borderColor: "var(--ld-border)" }} />
                      Color representativo
                    </p>
                  ) : null}
                  <div className="mt-2 flex items-center gap-3">
                    <button type="button" onClick={() => {
                      const next = layers.map((item) => item.region.id === layer.region.id ? { ...item, visible: !item.visible } : item);
                      refreshLayerCanvases(next);
                    }} className="rounded border px-2 py-1" style={{ borderColor: "var(--ld-border)" }}>{layer.visible ? "Ocultar" : "Mostrar"}</button>
                    <label className="flex-1 text-xs">Opacidad
                      <input className="w-full" type="range" min={0.1} max={0.9} step={0.05} value={layer.opacity} onChange={(event) => updateLayerOpacity(layer.region.id, Number(event.target.value))} />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-sm font-semibold">Cobertura provisional: {coverage.coveragePercent == null ? "Sin datos" : `${coverage.coveragePercent.toFixed(1)}%`}</p>
          {storedMetrics ? (
            <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="font-semibold">Método del cálculo</dt><dd>{storedMetrics.calculation_method}</dd>
              <dt className="font-semibold">Versión del cálculo</dt><dd>{storedMetrics.calculation_version}</dd>
              <dt className="font-semibold">Fecha del cálculo</dt><dd>{new Date(storedMetrics.calculated_at).toLocaleString()}</dd>
            </dl>
          ) : <p className="mt-3 text-sm font-semibold text-amber-800">Resumen pendiente de cálculo</p>}
          <p className="mt-3 text-xs font-semibold">Los resultados son descriptivos y provisionales. No constituyen por sí solos una clasificación de calidad ambiental.</p>
        </section>
      ) : null}
    </div>
  );
}

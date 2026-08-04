"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Rect, Stage } from "react-konva";
import type {
  AcceptedMask,
  BackendPreference,
  ImageAsset,
  PointPrompt,
  RuntimeBackend,
  SegmentationCandidate,
  WorkerErrorStage,
  WorkerMessage,
  WorkerRequest,
} from "./types";
import { countMaskPixels } from "./mask-utils";
import { clampPointToImageBounds, mapStagePointToImagePoint } from "./geometry";

const WORKER_URL = new URL("./sam.worker.ts", import.meta.url);
const MAX_ANALYSIS_DIMENSION = 1024;
const REQUEST_TIMEOUT_MS = 45000;
const MODEL_SESSION_ID = "model-session";

const CLASS_OPTIONS = [
  { value: "liquen", label: "Liquen" },
  { value: "corteza", label: "Corteza" },
  { value: "musgo", label: "Musgo" },
  { value: "alga", label: "Alga" },
  { value: "sombra", label: "Sombra" },
  { value: "reflejo", label: "Reflejo" },
  { value: "desconocido", label: "Desconocido" },
] as const;

type LabPhase = "idle" | "loading-model" | "model-ready" | "preparing-image" | "image-ready" | "segmenting" | "mask-ready" | "error";
type PromptMode = "include" | "exclude";
type RetryOperation = "load-model" | "prepare-image" | "segment";
type RequestKind = "load" | "prepare" | "segment";

interface UiState {
  phase: LabPhase;
  status: string;
  error: string | null;
  errorStage: WorkerErrorStage | null;
  errorName: string | null;
  errorOperation: RetryOperation | null;
  backendStatus: string | null;
}

interface RequestMeta {
  kind: RequestKind;
  sessionId: string;
}

const PHASE_STATUS: Record<LabPhase, string> = {
  idle: "Esperando inicializacion...",
  "loading-model": "Preparando motor de IA...",
  "model-ready": "Modelo listo. Selecciona una imagen.",
  "preparing-image": "Preparando imagen...",
  "image-ready": "Imagen lista: haz clic sobre la region que deseas incluir.",
  segmenting: "Generando mascara...",
  "mask-ready": "Mascara lista.",
  error: "Ocurrio un error.",
};

function sanitizeMessage(message: string) {
  return message.replace(/[\r\n\t]/g, " ").slice(0, 240);
}

function toRequestLabel(kind: RequestKind): RetryOperation {
  if (kind === "prepare") {
    return "prepare-image";
  }

  if (kind === "segment") {
    return "segment";
  }

  return "load-model";
}

function isBrowserSafari() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const agent = navigator.userAgent.toLowerCase();
  const isSafari = agent.includes("safari");
  const isChromium = agent.includes("chrome") || agent.includes("crios") || agent.includes("edg") || agent.includes("android");
  return isSafari && !isChromium;
}

async function buildAnalysisBlob(file: File, inferenceWidth: number, inferenceHeight: number, mimeType: string) {
  const sourceBitmap = await createImageBitmap(file);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = inferenceWidth;
    canvas.height = inferenceHeight;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("No se pudo crear el contexto 2D.");
    }

    context.drawImage(sourceBitmap, 0, 0, inferenceWidth, inferenceHeight);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) {
          reject(new Error("No fue posible preparar la imagen para analisis."));
          return;
        }
        resolve(result);
      }, mimeType, 0.92);
    });

    return blob;
  } finally {
    sourceBitmap.close();
  }
}

function revokeBlobUrl(url: string | null) {
  if (url && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

export default function VisionLab() {
  const [asset, setAsset] = useState<ImageAsset | null>(null);
  const [points, setPoints] = useState<PointPrompt[]>([]);
  const [candidates, setCandidates] = useState<SegmentationCandidate[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [acceptedMasks, setAcceptedMasks] = useState<AcceptedMask[]>([]);
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [visibleMaskIds, setVisibleMaskIds] = useState<string[]>([]);
  const [maskOpacity, setMaskOpacity] = useState(0.35);
  const [selectedClass, setSelectedClass] = useState<AcceptedMask["className"]>("liquen");
  const [morphotypeName, setMorphotypeName] = useState("");
  const [promptMode, setPromptMode] = useState<PromptMode>("include");
  const [viewScale, setViewScale] = useState(1);
  const [viewX, setViewX] = useState(0);
  const [viewY, setViewY] = useState(0);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [backendPreference, setBackendPreference] = useState<BackendPreference>("auto");
  const [selectedBackend, setSelectedBackend] = useState<RuntimeBackend | null>(null);
  const [uiState, setUiState] = useState<UiState>({
    phase: "idle",
    status: PHASE_STATUS.idle,
    error: null,
    errorStage: null,
    errorName: null,
    errorOperation: null,
    backendStatus: null,
  });

  const workerRef = useRef<Worker | null>(null);
  const sessionCounterRef = useRef(0);
  const requestCounterRef = useRef(0);
  const activeImageSessionRef = useRef<string>("session-0");
  const requestMapRef = useRef<Map<number, RequestMeta>>(new Map());
  const requestTimeoutRef = useRef<Map<number, number>>(new Map());
  const loadRequestIdRef = useRef<number | null>(null);
  const prepareRequestIdRef = useRef<number | null>(null);
  const segmentRequestIdRef = useRef<number | null>(null);
  const latestDisplayUrlRef = useRef<string | null>(null);
  const initialBackendPreferenceRef = useRef<BackendPreference>(isBrowserSafari() ? "auto" : "auto");

  const transitionPhase = useCallback((phase: LabPhase, patch?: Partial<UiState>) => {
    setUiState((previous) => ({
      ...previous,
      phase,
      status: patch?.status ?? PHASE_STATUS[phase],
      error: patch?.error ?? (phase === "error" ? previous.error : null),
      errorStage: patch?.errorStage ?? (phase === "error" ? previous.errorStage : null),
      errorName: patch?.errorName ?? (phase === "error" ? previous.errorName : null),
      errorOperation: patch?.errorOperation ?? (phase === "error" ? previous.errorOperation : null),
      backendStatus: patch?.backendStatus ?? previous.backendStatus,
    }));
  }, []);

  const clearRequestTimeout = useCallback((requestId: number) => {
    const timeoutId = requestTimeoutRef.current.get(requestId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      requestTimeoutRef.current.delete(requestId);
    }
  }, []);

  const completeRequest = useCallback((requestId: number) => {
    const meta = requestMapRef.current.get(requestId);
    requestMapRef.current.delete(requestId);
    clearRequestTimeout(requestId);

    if (!meta) {
      return;
    }

    if (meta.kind === "load" && loadRequestIdRef.current === requestId) {
      loadRequestIdRef.current = null;
    }

    if (meta.kind === "prepare" && prepareRequestIdRef.current === requestId) {
      prepareRequestIdRef.current = null;
    }

    if (meta.kind === "segment" && segmentRequestIdRef.current === requestId) {
      segmentRequestIdRef.current = null;
    }
  }, [clearRequestTimeout]);

  const registerRequest = useCallback((kind: RequestKind, sessionId: string) => {
    requestCounterRef.current += 1;
    const requestId = requestCounterRef.current;

    requestMapRef.current.set(requestId, { kind, sessionId });

    const timeoutId = window.setTimeout(() => {
      const meta = requestMapRef.current.get(requestId);
      if (!meta) {
        return;
      }

      completeRequest(requestId);
      transitionPhase("error", {
        status: "Tiempo de espera agotado.",
        error: "La operacion supero el tiempo de espera.",
        errorStage: "postprocess-mask",
        errorName: "TimeoutError",
        errorOperation: toRequestLabel(meta.kind),
      });
    }, REQUEST_TIMEOUT_MS);

    requestTimeoutRef.current.set(requestId, timeoutId);
    return requestId;
  }, [completeRequest, transitionPhase]);

  const clearRequestsBySession = useCallback((sessionId: string) => {
    const entries = Array.from(requestMapRef.current.entries());

    entries.forEach(([requestId, meta]) => {
      if (meta.sessionId === sessionId) {
        completeRequest(requestId);
      }
    });
  }, [completeRequest]);

  const clearLoadRequests = useCallback(() => {
    const entries = Array.from(requestMapRef.current.entries());

    entries.forEach(([requestId, meta]) => {
      if (meta.kind === "load") {
        completeRequest(requestId);
      }
    });
  }, [completeRequest]);

  const postToWorker = useCallback((request: WorkerRequest) => {
    workerRef.current?.postMessage(request);
  }, []);

  const requestModelLoad = useCallback((preference: BackendPreference) => {
    if (!workerRef.current) {
      return;
    }

    clearLoadRequests();

    const requestId = registerRequest("load", MODEL_SESSION_ID);
    loadRequestIdRef.current = requestId;

    transitionPhase("loading-model", {
      status: PHASE_STATUS["loading-model"],
      error: null,
      errorStage: null,
      errorName: null,
      errorOperation: null,
    });

    postToWorker({
      type: "load",
      sessionId: MODEL_SESSION_ID,
      requestId,
      backendPreference: preference,
    });
  }, [clearLoadRequests, postToWorker, registerRequest, transitionPhase]);

  const requestPrepareImage = useCallback((nextAsset: ImageAsset, sessionId: string) => {
    if (!workerRef.current || !nextAsset.blob || !nextAsset.imageKey || !nextAsset.mimeType) {
      return;
    }

    const requestId = registerRequest("prepare", sessionId);
    prepareRequestIdRef.current = requestId;

    transitionPhase("preparing-image", {
      status: PHASE_STATUS["preparing-image"],
      error: null,
      errorStage: null,
      errorName: null,
      errorOperation: null,
    });

    postToWorker({
      type: "prepare-image",
      sessionId,
      requestId,
      image: {
        imageKey: nextAsset.imageKey,
        blob: nextAsset.blob,
        mimeType: nextAsset.mimeType,
        width: nextAsset.width,
        height: nextAsset.height,
        inferenceWidth: nextAsset.inferenceWidth,
        inferenceHeight: nextAsset.inferenceHeight,
      },
    });
  }, [postToWorker, registerRequest, transitionPhase]);

  const requestSegmentation = useCallback((nextPoints: PointPrompt[]) => {
    if (!asset || !asset.blob || !asset.imageKey || !asset.mimeType || !workerRef.current) {
      return;
    }

    if (nextPoints.length === 0) {
      return;
    }

    const sessionId = activeImageSessionRef.current;
    const currentPhase = uiState.phase;
    if (currentPhase !== "image-ready" && currentPhase !== "mask-ready") {
      return;
    }

    if (segmentRequestIdRef.current) {
      completeRequest(segmentRequestIdRef.current);
    }

    const requestId = registerRequest("segment", sessionId);
    segmentRequestIdRef.current = requestId;

    transitionPhase("segmenting", {
      status: PHASE_STATUS.segmenting,
      error: null,
      errorStage: null,
      errorName: null,
      errorOperation: null,
    });

    postToWorker({
      type: "segment",
      sessionId,
      requestId,
      image: {
        imageKey: asset.imageKey,
        blob: asset.blob,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        inferenceWidth: asset.inferenceWidth,
        inferenceHeight: asset.inferenceHeight,
      },
      points: nextPoints,
    });
  }, [asset, completeRequest, postToWorker, registerRequest, transitionPhase, uiState.phase]);

  useEffect(() => {
    const worker = new Worker(WORKER_URL, { type: "module" });
    workerRef.current = worker;
    const requestTimeouts = requestTimeoutRef.current;
    const requestMap = requestMapRef.current;

    const handleMessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      const meta = requestMapRef.current.get(message.requestId);

      if (!meta || meta.sessionId !== message.sessionId) {
        return;
      }

      if (message.type === "progress") {
        setUiState((previous) => ({ ...previous, status: message.message }));
        return;
      }

      if (message.type === "loading") {
        transitionPhase("loading-model", {
          status: message.message,
          error: null,
          errorStage: null,
          errorName: null,
          errorOperation: null,
        });
        return;
      }

      if (message.type === "ready") {
        completeRequest(message.requestId);
        setSelectedBackend(message.backend);
        transitionPhase("model-ready", {
          status: PHASE_STATUS["model-ready"],
          backendStatus: message.message,
          error: null,
          errorStage: null,
          errorName: null,
          errorOperation: null,
        });
        return;
      }

      if (message.type === "image-processing") {
        if (message.operation === "preparing-image") {
          transitionPhase("preparing-image", { status: "Preparando imagen..." });
        } else {
          transitionPhase("segmenting", { status: "Generando mascara..." });
        }
        return;
      }

      if (message.type === "image-ready") {
        completeRequest(message.requestId);
        setCandidates([]);
        setCandidateIndex(0);
        transitionPhase("image-ready", { status: PHASE_STATUS["image-ready"] });
        return;
      }

      if (message.type === "mask-ready") {
        completeRequest(message.requestId);
        setCandidates(message.masks);
        setCandidateIndex(0);
        transitionPhase("mask-ready", { status: PHASE_STATUS["mask-ready"] });
        return;
      }

      if (message.type === "error") {
        completeRequest(message.requestId);
        transitionPhase("error", {
          status: "Error en el flujo de segmentacion.",
          error: sanitizeMessage(message.message),
          errorStage: message.stage,
          errorName: sanitizeMessage(message.name),
          errorOperation: toRequestLabel(meta.kind),
        });
      }
    };

    worker.addEventListener("message", handleMessage);
    requestModelLoad(initialBackendPreferenceRef.current);

    return () => {
      worker.removeEventListener("message", handleMessage);
      worker.terminate();
      workerRef.current = null;

      requestTimeouts.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      requestTimeouts.clear();
      requestMap.clear();

      revokeBlobUrl(latestDisplayUrlRef.current);
      latestDisplayUrlRef.current = null;
    };
  }, [completeRequest, requestModelLoad, transitionPhase]);

  const resetView = useCallback(() => {
    setViewScale(1);
    setViewX(0);
    setViewY(0);
  }, []);

  const fitToScreen = useCallback(() => {
    setViewScale(1);
    setViewX(0);
    setViewY(0);
  }, []);

  const activeCandidate = candidates[candidateIndex] ?? null;

  const summary = useMemo(() => {
    const evaluable = acceptedMasks.filter((mask) => ["liquen", "corteza", "musgo", "alga"].includes(mask.className)).length;
    const excluded = acceptedMasks.filter((mask) => ["sombra", "reflejo", "desconocido"].includes(mask.className)).length;
    const liquenPixels = acceptedMasks.filter((mask) => mask.className === "liquen").reduce((sum, mask) => sum + mask.pixels, 0);
    const cover = evaluable > 0 ? Math.round((liquenPixels / Math.max(1, evaluable)) * 100) : 0;

    return { evaluable, excluded, liquenPixels, cover };
  }, [acceptedMasks]);

  const handleFileSelection = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!acceptedTypes.includes(file.type) && file.type !== "image/heic") {
      transitionPhase("error", {
        status: "Formato no compatible.",
        error: "Formato no compatible. Por favor use JPEG, PNG o WebP.",
        errorStage: "decode-image",
        errorName: "ValidationError",
        errorOperation: "prepare-image",
      });
      return;
    }

    if (file.type === "image/heic") {
      transitionPhase("error", {
        status: "No se pudo decodificar HEIC.",
        error: "Este navegador no pudo decodificar HEIC. Por favor use JPEG.",
        errorStage: "decode-image",
        errorName: "DecodeError",
        errorOperation: "prepare-image",
      });
      return;
    }

    const previousSession = activeImageSessionRef.current;
    if (previousSession) {
      postToWorker({ type: "abort-session", sessionId: previousSession, requestId: -1 });
      clearRequestsBySession(previousSession);
    }

    sessionCounterRef.current += 1;
    const nextSessionId = `session-${sessionCounterRef.current}`;
    activeImageSessionRef.current = nextSessionId;

    setPoints([]);
    setCandidates([]);
    setAcceptedMasks([]);
    setSelectedMaskId(null);
    setVisibleMaskIds([]);
    setCandidateIndex(0);

    transitionPhase("preparing-image", {
      status: PHASE_STATUS["preparing-image"],
      error: null,
      errorStage: null,
      errorName: null,
      errorOperation: null,
    });

    revokeBlobUrl(latestDisplayUrlRef.current);
    latestDisplayUrlRef.current = null;

    const displayUrl = URL.createObjectURL(file);
    latestDisplayUrlRef.current = displayUrl;

    const image = new window.Image();
    image.onload = async () => {
      if (activeImageSessionRef.current !== nextSessionId) {
        return;
      }

      try {
        const maxDimension = Math.max(image.width, image.height);
        const scale = maxDimension > MAX_ANALYSIS_DIMENSION ? MAX_ANALYSIS_DIMENSION / maxDimension : 1;
        const inferenceWidth = Math.max(1, Math.round(image.width * scale));
        const inferenceHeight = Math.max(1, Math.round(image.height * scale));
        const mimeType = file.type || "image/jpeg";

        const analysisBlob = await buildAnalysisBlob(file, inferenceWidth, inferenceHeight, mimeType);

        const nextAsset: ImageAsset = {
          src: displayUrl,
          blob: analysisBlob,
          mimeType,
          imageKey: `${file.name}:${file.size}:${file.lastModified}:${image.width}:${image.height}:${inferenceWidth}:${inferenceHeight}`,
          width: image.width,
          height: image.height,
          naturalWidth: image.width,
          naturalHeight: image.height,
          inferenceWidth,
          inferenceHeight,
          orientation: 1,
        };

        setAsset(nextAsset);
        setImageElement(image);
        requestPrepareImage(nextAsset, nextSessionId);
      } catch {
        transitionPhase("error", {
          status: "Fallo en la preparacion de imagen.",
          error: "No fue posible preparar la imagen para analisis.",
          errorStage: "preprocess-image",
          errorName: "PrepareImageError",
          errorOperation: "prepare-image",
        });
      }
    };

    image.onerror = () => {
      transitionPhase("error", {
        status: "Fallo la decodificacion.",
        error: "Fallo la decodificacion de la imagen.",
        errorStage: "decode-image",
        errorName: "DecodeError",
        errorOperation: "prepare-image",
      });
    };

    image.src = displayUrl;
  }, [clearRequestsBySession, postToWorker, requestPrepareImage, transitionPhase]);

  const stageWidth = asset ? Math.min(760, asset.width) : 760;
  const stageHeight = asset ? Math.max(320, Math.min(520, Math.round((asset.height / Math.max(asset.width, 1)) * stageWidth))) : 520;

  const canPlacePoint = uiState.phase === "image-ready" || uiState.phase === "mask-ready";

  const addPointFromImageClick = useCallback((x: number, y: number) => {
    if (!canPlacePoint) {
      return;
    }

    const label: PointPrompt["label"] = promptMode === "include" ? 1 : 0;
    const point: PointPrompt = { x, y, label };

    setPoints((previous) => {
      const nextPoints = [...previous, point];
      requestSegmentation(nextPoints);
      return nextPoints;
    });
  }, [canPlacePoint, promptMode, requestSegmentation]);

  const handleStageClick = useCallback((event: { target?: { getStage?: () => { getPointerPosition?: () => { x: number; y: number } | null } | null } }) => {
    if (!asset || !canPlacePoint) {
      return;
    }

    const stage = event.target?.getStage?.();
    const pointerPosition = stage?.getPointerPosition?.();
    if (!pointerPosition) {
      return;
    }

    const imagePoint = mapStagePointToImagePoint(pointerPosition, stageWidth, stageHeight, viewScale, viewX, viewY, asset.width, asset.height);
    const clampedPoint = clampPointToImageBounds(imagePoint, asset.width, asset.height);

    addPointFromImageClick(clampedPoint.x, clampedPoint.y);
  }, [addPointFromImageClick, asset, canPlacePoint, stageHeight, stageWidth, viewScale, viewX, viewY]);

  const retryCurrentTask = useCallback(() => {
    if (uiState.errorOperation === "load-model") {
      requestModelLoad(backendPreference);
      return;
    }

    if (uiState.errorOperation === "prepare-image" && asset) {
      requestPrepareImage(asset, activeImageSessionRef.current);
      return;
    }

    if (uiState.errorOperation === "segment" && points.length > 0) {
      requestSegmentation(points);
      return;
    }

    requestModelLoad(backendPreference);
  }, [asset, backendPreference, points, requestModelLoad, requestPrepareImage, requestSegmentation, uiState.errorOperation]);

  const handleWheel = useCallback((event: { evt: { preventDefault: () => void; deltaY: number } }) => {
    event.evt.preventDefault();
    const direction = event.evt.deltaY > 0 ? -0.1 : 0.1;
    setViewScale((value) => Math.max(0.75, Math.min(2.6, value + direction)));
  }, []);

  const removeLastPoint = useCallback(() => {
    setPoints((previous) => {
      const nextPoints = previous.slice(0, -1);
      if (nextPoints.length === 0) {
        setCandidates([]);
        transitionPhase("image-ready", { status: PHASE_STATUS["image-ready"] });
        return nextPoints;
      }

      if (canPlacePoint) {
        requestSegmentation(nextPoints);
      }

      return nextPoints;
    });
  }, [canPlacePoint, requestSegmentation, transitionPhase]);

  const clearPoints = useCallback(() => {
    setPoints([]);
    setCandidates([]);

    if (asset) {
      transitionPhase("image-ready", { status: PHASE_STATUS["image-ready"] });
    }
  }, [asset, transitionPhase]);

  const handleAcceptMask = useCallback(() => {
    if (!activeCandidate) {
      return;
    }

    const nextMask: AcceptedMask = {
      id: `${activeCandidate.id}-${acceptedMasks.length}`,
      className: selectedClass,
      morphotypeName: selectedClass === "liquen" && morphotypeName.trim() ? morphotypeName.trim() : undefined,
      pixels: countMaskPixels(activeCandidate.mask),
      score: activeCandidate.score,
      model: "SlimSAM",
      createdAt: new Date().toISOString(),
      width: activeCandidate.width,
      height: activeCandidate.height,
      mask: activeCandidate.mask,
    };

    setAcceptedMasks((value) => [...value, nextMask]);
    setVisibleMaskIds((value) => [...value, nextMask.id]);
    setSelectedMaskId(nextMask.id);
  }, [acceptedMasks.length, activeCandidate, morphotypeName, selectedClass]);

  const handleDeleteMask = useCallback((maskId: string) => {
    setAcceptedMasks((value) => value.filter((mask) => mask.id !== maskId));
    setVisibleMaskIds((value) => value.filter((id) => id !== maskId));
    if (selectedMaskId === maskId) {
      setSelectedMaskId(null);
    }
  }, [selectedMaskId]);

  const toggleMaskVisibility = useCallback((maskId: string) => {
    setVisibleMaskIds((value) => (value.includes(maskId) ? value.filter((id) => id !== maskId) : [...value, maskId]));
  }, []);

  const renderMaskOverlay = useMemo(() => {
    if (!activeCandidate) {
      return null;
    }

    const cellWidth = stageWidth / Math.max(activeCandidate.width, 1);
    const cellHeight = stageHeight / Math.max(activeCandidate.height, 1);

    return activeCandidate.mask.flatMap((row, rowIndex) => row.flatMap((value, columnIndex) => (value === 1 ? [
      <Rect
        key={`${rowIndex}-${columnIndex}`}
        x={columnIndex * cellWidth}
        y={rowIndex * cellHeight}
        width={cellWidth}
        height={cellHeight}
        fill="#4F7C5B"
        opacity={maskOpacity}
      />,
    ] : [])));
  }, [activeCandidate, maskOpacity, stageHeight, stageWidth]);

  const isPreparing = uiState.phase === "preparing-image";
  const isSegmenting = uiState.phase === "segmenting";
  const promptButtonsDisabled = !asset || isPreparing || isSegmenting;
  const stagePointerEnabled = canPlacePoint;

  const retryButtonLabel = uiState.errorOperation === "segment"
    ? "Reintentar mascara"
    : uiState.errorOperation === "prepare-image"
      ? "Reintentar preparar imagen"
      : "Reintentar cargar modelo";

  return (
    <div style={{ background: "var(--ld-background)", color: "var(--ld-text)" }} className="min-h-screen p-4 lg:p-6">
      <div className="rounded-2xl border border-[var(--ld-border)] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: "var(--ld-text)" }}>Laboratorio de segmentacion asistida</h1>
            <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Prueba experimental: la IA sugiere regiones; el usuario confirma su significado.</p>
          </div>
          <div className="rounded-xl border border-[var(--ld-border)] bg-[var(--ld-background)] p-3 text-sm" style={{ color: "var(--ld-text-secondary)" }}>
            Este modelo no identifica especies ni confirma que una region sea un liquen. Solamente propone limites visuales a partir de los clics del usuario.
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-[var(--ld-border)] bg-[var(--ld-background)] p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-medium">Backend de inferencia</div>
            <div className="flex items-center gap-2">
              <select
                className="rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2 text-sm"
                value={backendPreference}
                onChange={(event) => setBackendPreference(event.target.value as BackendPreference)}
                disabled={uiState.phase === "loading-model"}
              >
                <option value="auto">Automatico</option>
                <option value="webgpu">WebGPU</option>
                <option value="wasm">Compatible (WASM)</option>
              </select>
              <button
                className="rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2 text-sm"
                onClick={() => requestModelLoad(backendPreference)}
                disabled={uiState.phase === "loading-model"}
              >
                Aplicar
              </button>
            </div>
          </div>
          <div className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>
            Modo activo: {selectedBackend ? selectedBackend.toUpperCase() : "sin inicializar"}
            {backendStatusSuffix(uiState.backendStatus)}
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_0.8fr]">
          <div className="rounded-2xl border border-[var(--ld-border)] bg-[var(--ld-background)] p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2 font-medium" style={{ color: "var(--ld-text)" }}>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="mr-2" onChange={handleFileSelection} />
                Seleccionar imagen local
              </label>
              <button className="rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2" onClick={fitToScreen}>Ajustar a pantalla</button>
              <button className="rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2" onClick={resetView}>Restablecer vista</button>
              <button className="rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2" onClick={removeLastPoint} disabled={!canPlacePoint || points.length === 0}>Deshacer</button>
              <button className="rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2" onClick={clearPoints} disabled={points.length === 0}>Limpiar guia</button>
            </div>

            <div className="rounded-2xl border border-[var(--ld-border)] bg-white p-3">
              <div className="mb-2 flex items-center justify-between text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                <span>{uiState.status}</span>
                {isPreparing ? <span className="font-semibold" style={{ color: "var(--ld-green)" }}>Preparando imagen...</span> : null}
                {isSegmenting ? <span className="font-semibold" style={{ color: "var(--ld-green)" }}>Generando mascara...</span> : null}
              </div>
              {uiState.error ? (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <div><strong>stage:</strong> {uiState.errorStage}</div>
                  <div><strong>name:</strong> {uiState.errorName}</div>
                  <div><strong>mensaje:</strong> {uiState.error}</div>
                  <button className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-2 font-semibold" onClick={retryCurrentTask}>{retryButtonLabel}</button>
                </div>
              ) : null}
              {asset ? (
                <div className="overflow-hidden rounded-xl border border-[var(--ld-border)] bg-[#F4F7F5] p-2">
                  <Stage
                    width={stageWidth}
                    height={stageHeight}
                    scaleX={viewScale}
                    scaleY={viewScale}
                    x={viewX}
                    y={viewY}
                    onWheel={handleWheel}
                    onClick={handleStageClick}
                    onTap={handleStageClick}
                    listening={stagePointerEnabled}
                  >
                    <Layer>
                      <Group>
                        {imageElement ? <KonvaImage image={imageElement} width={stageWidth} height={stageHeight} /> : null}
                        {renderMaskOverlay}
                        {points.map((point, index) => (
                          <Circle
                            key={`${point.x}-${point.y}-${index}`}
                            x={(point.x / Math.max(asset.width, 1)) * stageWidth}
                            y={(point.y / Math.max(asset.height, 1)) * stageHeight}
                            radius={6}
                            fill={point.label === 1 ? "#4F7C5B" : "#C2410C"}
                            stroke="#FFFFFF"
                            strokeWidth={2}
                          />
                        ))}
                        {acceptedMasks.filter((mask) => visibleMaskIds.includes(mask.id)).map((mask) => {
                          const cellWidth = stageWidth / Math.max(mask.width, 1);
                          const cellHeight = stageHeight / Math.max(mask.height, 1);
                          return (
                            <Group key={mask.id}>
                              {mask.mask.flatMap((row, rowIndex) => row.flatMap((value, columnIndex) => (value === 1 ? [
                                <Rect
                                  key={`${mask.id}-${rowIndex}-${columnIndex}`}
                                  x={columnIndex * cellWidth}
                                  y={rowIndex * cellHeight}
                                  width={cellWidth}
                                  height={cellHeight}
                                  fill={mask.className === "liquen" ? "#4F7C5B" : "#D9BD67"}
                                  opacity={maskOpacity}
                                />,
                              ] : [])))}
                            </Group>
                          );
                        })}
                      </Group>
                    </Layer>
                  </Stage>
                </div>
              ) : (
                <div className="flex h-96 items-center justify-center rounded-xl border border-dashed border-[var(--ld-border)] bg-[var(--ld-background)] text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                  Seleccione una fotografia para iniciar la prueba.
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-[var(--ld-border)] bg-white p-4">
              <h2 className="text-lg font-semibold">Guia de puntos</h2>
              <div className="mt-3 space-y-2 text-sm">
                <div className="rounded-lg border border-[var(--ld-border)] p-3">
                  <div className="font-medium">Puntos positivos</div>
                  <div className="text-[var(--ld-text-secondary)]">Verdes - indican la region objetivo.</div>
                </div>
                <div className="rounded-lg border border-[var(--ld-border)] p-3">
                  <div className="font-medium">Puntos negativos</div>
                  <div className="text-[var(--ld-text-secondary)]">Rojos - indican lo que no es el objetivo.</div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  className="flex-1 rounded-lg bg-[var(--ld-green)] px-3 py-2 font-semibold text-white"
                  disabled={promptButtonsDisabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPromptMode("include");
                  }}
                >
                  Añadir area
                </button>
                <button
                  className="flex-1 rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2 font-semibold"
                  disabled={promptButtonsDisabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPromptMode("exclude");
                  }}
                >
                  Excluir area
                </button>
              </div>
              <div className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                Modo activo: {promptMode === "include" ? "punto positivo" : "punto negativo"}.
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--ld-border)] bg-white p-4">
              <h2 className="text-lg font-semibold">Mascara activa</h2>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2"
                  onClick={() => setCandidateIndex((value) => Math.max(0, value - 1))}
                  disabled={candidates.length === 0 || candidateIndex === 0}
                >
                  Mascara anterior
                </button>
                <button
                  className="rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2"
                  onClick={() => setCandidateIndex((value) => Math.min(Math.max(candidates.length - 1, 0), value + 1))}
                  disabled={candidates.length === 0 || candidateIndex >= candidates.length - 1}
                >
                  Mascara siguiente
                </button>
              </div>
              <div className="mt-3 rounded-lg border border-[var(--ld-border)] bg-[var(--ld-background)] p-3 text-sm">
                {activeCandidate ? <div>Confianza geometrica experimental: {(activeCandidate.score * 100).toFixed(1)}%</div> : <div>Sin mascara aun</div>}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <label className="text-sm">Opacidad</label>
                <input type="range" min="0.1" max="0.9" step="0.05" value={maskOpacity} onChange={(event) => setMaskOpacity(Number(event.target.value))} />
              </div>
              <div className="mt-3 flex gap-2">
                <button className="flex-1 rounded-lg bg-[var(--ld-green)] px-3 py-2 font-semibold text-white" onClick={handleAcceptMask} disabled={!activeCandidate}>Aceptar mascara</button>
                <button className="flex-1 rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2 font-semibold" onClick={() => setCandidates([])} disabled={candidates.length === 0}>Descartar mascara</button>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--ld-border)] bg-white p-4">
              <h2 className="text-lg font-semibold">Clase y morfotipo</h2>
              <select className="mt-2 w-full rounded-lg border border-[var(--ld-border)] p-2" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value as AcceptedMask["className"])}>
                {CLASS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {selectedClass === "liquen" ? (
                <input className="mt-2 w-full rounded-lg border border-[var(--ld-border)] p-2" value={morphotypeName} onChange={(event) => setMorphotypeName(event.target.value)} placeholder="Nombre de morfotipo" />
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
          <div className="rounded-2xl border border-[var(--ld-border)] bg-white p-4">
            <h2 className="text-lg font-semibold">Mascaras aceptadas</h2>
            <div className="mt-3 space-y-2">
              {acceptedMasks.length === 0 ? <div className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Aun no hay mascaras aceptadas.</div> : acceptedMasks.map((mask) => (
                <div key={mask.id} className="rounded-lg border border-[var(--ld-border)] p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{mask.className}</span>
                    <span style={{ color: "var(--ld-text-secondary)" }}>{mask.pixels} px</span>
                  </div>
                  <div className="mt-1 text-xs" style={{ color: "var(--ld-text-secondary)" }}>{mask.morphotypeName ?? "Sin morfotipo"}</div>
                  <div className="mt-2 flex gap-2">
                    <button className="rounded-lg border border-[var(--ld-border)] bg-white px-2 py-1 text-xs" onClick={() => toggleMaskVisibility(mask.id)}>{visibleMaskIds.includes(mask.id) ? "Ocultar" : "Mostrar"}</button>
                    <button className="rounded-lg border border-[var(--ld-border)] bg-white px-2 py-1 text-xs" onClick={() => handleDeleteMask(mask.id)}>Eliminar</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--ld-border)] bg-white p-4">
            <h2 className="text-lg font-semibold">Resumen</h2>
            <div className="mt-3 space-y-2 text-sm">
              <div>Mascaras aceptadas: {acceptedMasks.length}</div>
              <div>Pixeles evaluables: {summary.evaluable}</div>
              <div>Pixeles excluidos: {summary.excluded}</div>
              <div>Pixeles de liquen: {summary.liquenPixels}</div>
              <div>Cobertura preliminar: {summary.cover}%</div>
              {summary.evaluable === 0 ? <div>Datos insuficientes</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function backendStatusSuffix(value: string | null) {
  if (!value) {
    return "";
  }

  return ` | ${value}`;
}

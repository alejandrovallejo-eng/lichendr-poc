"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Rect, Stage } from "react-konva";
import type { AcceptedMask, ImageAsset, PointPrompt, SegmentationCandidate } from "./types";
import { countMaskPixels } from "./mask-utils";
import { clampPointToImageBounds, mapStagePointToImagePoint } from "./geometry";

const MAX_ANALYSIS_DIMENSION = 1024;
const DEBOUNCE_MS = 250;

const CLASS_OPTIONS = [
  { value: "liquen", label: "Liquen" },
  { value: "corteza", label: "Corteza" },
  { value: "musgo", label: "Musgo" },
  { value: "alga", label: "Alga" },
  { value: "sombra", label: "Sombra" },
  { value: "reflejo", label: "Reflejo" },
  { value: "desconocido", label: "Desconocido" },
] as const;

type LabPhase =
  | "idle"
  | "connecting"
  | "service-ready"
  | "preparing-image"
  | "image-ready"
  | "segmenting"
  | "mask-ready"
  | "error";

type PromptMode = "include" | "exclude";
type RetryOperation = "connect" | "prepare-image" | "segment";

interface UiState {
  phase: LabPhase;
  status: string;
  error: string | null;
  errorOperation: RetryOperation | null;
}

const PHASE_STATUS: Record<LabPhase, string> = {
  idle: "Iniciando...",
  connecting: "Conectando con el servicio de vision...",
  "service-ready": "Servicio listo. Selecciona una imagen.",
  "preparing-image": "Preparando imagen...",
  "image-ready": "Imagen lista: haz clic sobre la region que deseas incluir.",
  segmenting: "Generando mascara...",
  "mask-ready": "Mascara lista.",
  error: "Ocurrio un error.",
};

function sanitize(message: string) {
  return message.replace(/[\r\n\t]/g, " ").slice(0, 240);
}

function revokeBlobUrl(url: string | null) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

async function scaleImageBlob(file: File): Promise<{ blob: Blob; width: number; height: number; inferenceWidth: number; inferenceHeight: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const maxDim = Math.max(width, height);
  const scale = maxDim > MAX_ANALYSIS_DIMENSION ? MAX_ANALYSIS_DIMENSION / maxDim : 1;
  const iw = Math.max(1, Math.round(width * scale));
  const ih = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = iw;
  canvas.height = ih;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("No se pudo crear el contexto 2D.");
  ctx.drawImage(bitmap, 0, 0, iw, ih);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) reject(new Error("No fue posible preparar la imagen para analisis."));
      else resolve(b);
    }, "image/jpeg", 0.92);
  });

  return { blob, width, height, inferenceWidth: iw, inferenceHeight: ih };
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
  const [uiState, setUiState] = useState<UiState>({
    phase: "connecting",
    status: PHASE_STATUS.connecting,
    error: null,
    errorOperation: null,
  });

  // Refs
  const activeSessionIdRef = useRef<string | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);
  const segmentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRequestIdRef = useRef(0);
  const latestDisplayUrlRef = useRef<string | null>(null);

  const transition = useCallback((phase: LabPhase, patch?: Partial<UiState>) => {
    setUiState((prev) => ({
      ...prev,
      phase,
      status: patch?.status ?? PHASE_STATUS[phase],
      error: patch?.error ?? (phase === "error" ? prev.error : null),
      errorOperation: patch?.errorOperation ?? (phase === "error" ? prev.errorOperation : null),
    }));
  }, []);

  const abortActive = useCallback(() => {
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
  }, []);

  // ── Check service health on mount ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/vision/health", { signal: ctrl.signal });
        if (cancelled) return;
        if (!res.ok) {
          transition("error", {
            status: "El servicio de vision no esta disponible.",
            error: "GET /api/vision/health devolvio " + res.status,
            errorOperation: "connect",
          });
          return;
        }
        transition("service-ready");
      } catch (err) {
        if (cancelled) return;
        if ((err as { name?: string }).name === "AbortError") return;
        transition("error", {
          status: "No se pudo conectar con el servicio de vision.",
          error: sanitize(String(err)),
          errorOperation: "connect",
        });
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [transition]);

  // ── Delete session on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const sid = activeSessionIdRef.current;
      if (sid) {
        fetch(`/api/vision/sessions/${encodeURIComponent(sid)}`, { method: "DELETE" }).catch(() => undefined);
      }
      revokeBlobUrl(latestDisplayUrlRef.current);
    };
  }, []);

  // ── API helpers ───────────────────────────────────────────────────────────
  const callPrepare = useCallback(async (file: File, sessionTag: string) => {
    abortActive();
    const ctrl = new AbortController();
    activeAbortRef.current = ctrl;

    latestRequestIdRef.current += 1;
    const requestId = latestRequestIdRef.current;

    transition("preparing-image");

    try {
      const { blob, width, height, inferenceWidth, inferenceHeight } = await scaleImageBlob(file);

      if (requestId !== latestRequestIdRef.current) return;

      const form = new FormData();
      form.append("image", blob, file.name || "image.jpg");

      const res = await fetch("/api/vision/prepare", {
        method: "POST",
        body: form,
        signal: ctrl.signal,
      });

      if (requestId !== latestRequestIdRef.current) return;

      if (!res.ok) {
        const detail = await res.json().catch(() => ({ error: "Error desconocido." }));
        throw new Error(detail.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as { sessionId: string; width: number; height: number };

      if (requestId !== latestRequestIdRef.current) return;

      // Delete previous session
      const prevSid = activeSessionIdRef.current;
      if (prevSid && prevSid !== data.sessionId) {
        fetch(`/api/vision/sessions/${encodeURIComponent(prevSid)}`, { method: "DELETE" }).catch(() => undefined);
      }
      activeSessionIdRef.current = data.sessionId;

      // Build display image element
      const displayUrl = latestDisplayUrlRef.current ?? "";
      const img = new window.Image();
      img.src = displayUrl;
      await new Promise<void>((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); });

      if (requestId !== latestRequestIdRef.current) return;

      setImageElement(img);
      setAsset({
        src: displayUrl,
        blob,
        mimeType: "image/jpeg",
        imageKey: sessionTag,
        width,
        height,
        naturalWidth: width,
        naturalHeight: height,
        inferenceWidth,
        inferenceHeight,
        orientation: 1,
      });
      setPoints([]);
      setCandidates([]);
      setCandidateIndex(0);

      transition("image-ready");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      transition("error", {
        status: "Fallo la preparacion de la imagen.",
        error: sanitize(String(err)),
        errorOperation: "prepare-image",
      });
    }
  }, [abortActive, transition]);

  const callSegment = useCallback(async (pts: PointPrompt[], sessionId: string) => {
    abortActive();
    const ctrl = new AbortController();
    activeAbortRef.current = ctrl;

    latestRequestIdRef.current += 1;
    const requestId = latestRequestIdRef.current;

    transition("segmenting");

    try {
      const res = await fetch("/api/vision/segment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, points: pts }),
        signal: ctrl.signal,
      });

      if (requestId !== latestRequestIdRef.current) return;

      if (!res.ok) {
        const detail = await res.json().catch(() => ({ error: "Error desconocido." }));
        throw new Error(detail.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as {
        sessionId: string;
        recommendedIndex: number;
        candidates: Array<{ id: string; score: number; maskDataUrl: string; width: number; height: number }>;
        segmentMs: number;
      };

      if (requestId !== latestRequestIdRef.current) return;

      // Convert server candidates to local SegmentationCandidate shape
      const mapped: SegmentationCandidate[] = data.candidates.map((c) => ({
        id: c.id,
        score: c.score,
        mask: [],  // Not used for rendering — we render via maskDataUrl
        maskDataUrl: c.maskDataUrl,
        width: c.width,
        height: c.height,
      }));

      setCandidates(mapped);
      setCandidateIndex(data.recommendedIndex);
      transition("mask-ready");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      transition("error", {
        status: "Fallo la generacion de mascara.",
        error: sanitize(String(err)),
        errorOperation: "segment",
      });
    }
  }, [abortActive, transition]);

  // ── Debounced segment trigger ─────────────────────────────────────────────
  const scheduleSegment = useCallback((pts: PointPrompt[]) => {
    if (segmentDebounceRef.current) clearTimeout(segmentDebounceRef.current);
    if (pts.length === 0 || !activeSessionIdRef.current) return;

    const sessionId = activeSessionIdRef.current;
    segmentDebounceRef.current = setTimeout(() => {
      callSegment(pts, sessionId);
    }, DEBOUNCE_MS);
  }, [callSegment]);

  // ── File selection ────────────────────────────────────────────────────────
  const handleFileSelection = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const accepted = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!accepted.includes(file.type)) {
      transition("error", {
        status: "Formato no compatible.",
        error: "Formato no compatible. Por favor use JPEG, PNG o WebP.",
        errorOperation: "prepare-image",
      });
      return;
    }

    if (segmentDebounceRef.current) clearTimeout(segmentDebounceRef.current);
    setPoints([]);
    setCandidates([]);
    setCandidateIndex(0);
    setAcceptedMasks([]);
    setSelectedMaskId(null);
    setVisibleMaskIds([]);

    revokeBlobUrl(latestDisplayUrlRef.current);
    const displayUrl = URL.createObjectURL(file);
    latestDisplayUrlRef.current = displayUrl;

    const sessionTag = `${file.name}:${file.size}:${file.lastModified}`;
    callPrepare(file, sessionTag);
  }, [callPrepare, transition]);

  // ── Canvas interaction ────────────────────────────────────────────────────
  const stageWidth = asset ? Math.min(760, asset.width) : 760;
  const stageHeight = asset
    ? Math.max(320, Math.min(520, Math.round((asset.height / Math.max(asset.width, 1)) * stageWidth)))
    : 520;

  const canPlacePoint = uiState.phase === "image-ready" || uiState.phase === "mask-ready";

  const handleStageClick = useCallback((event: { target?: { getStage?: () => { getPointerPosition?: () => { x: number; y: number } | null } | null } }) => {
    if (!asset || !canPlacePoint) return;
    const stage = event.target?.getStage?.();
    const pos = stage?.getPointerPosition?.();
    if (!pos) return;

    const imagePoint = mapStagePointToImagePoint(pos, stageWidth, stageHeight, viewScale, viewX, viewY, asset.width, asset.height);
    const clamped = clampPointToImageBounds(imagePoint, asset.width, asset.height);
    const label: PointPrompt["label"] = promptMode === "include" ? 1 : 0;
    const next: PointPrompt = {
      x: clamped.x / Math.max(asset.width, 1),
      y: clamped.y / Math.max(asset.height, 1),
      label,
    };

    setPoints((prev) => {
      const nextPoints = [...prev, next];
      scheduleSegment(nextPoints);
      return nextPoints;
    });
  }, [asset, canPlacePoint, promptMode, scheduleSegment, stageHeight, stageWidth, viewScale, viewX, viewY]);

  const handlePointDragStart = useCallback(() => {
    if (segmentDebounceRef.current) clearTimeout(segmentDebounceRef.current);
    latestRequestIdRef.current += 1;
    abortActive();
  }, [abortActive]);

  const handlePointDragEnd = useCallback((index: number, event: { target: { x: () => number; y: () => number } }) => {
    const x = Math.min(stageWidth, Math.max(0, event.target.x())) / Math.max(stageWidth, 1);
    const y = Math.min(stageHeight, Math.max(0, event.target.y())) / Math.max(stageHeight, 1);

    setPoints((previous) => {
      const next = previous.map((point, pointIndex) => pointIndex === index ? { ...point, x, y } : point);
      scheduleSegment(next);
      return next;
    });
  }, [scheduleSegment, stageHeight, stageWidth]);

  const handleWheel = useCallback((event: { evt: { preventDefault: () => void; deltaY: number } }) => {
    event.evt.preventDefault();
    setViewScale((v) => Math.max(0.75, Math.min(2.6, v + (event.evt.deltaY > 0 ? -0.1 : 0.1))));
  }, []);

  const removeLastPoint = useCallback(() => {
    setPoints((prev) => {
      const next = prev.slice(0, -1);
      if (next.length === 0) {
        setCandidates([]);
        if (asset) transition("image-ready");
      } else {
        scheduleSegment(next);
      }
      return next;
    });
  }, [asset, scheduleSegment, transition]);

  const clearPoints = useCallback(() => {
    setPoints([]);
    setCandidates([]);
    if (asset) transition("image-ready");
  }, [asset, transition]);

  // ── Accepted masks ────────────────────────────────────────────────────────
  const activeCandidate = candidates[candidateIndex] ?? null;

  const handleAcceptMask = useCallback(() => {
    if (!activeCandidate) return;
    const nextMask: AcceptedMask = {
      id: `${activeCandidate.id}-${acceptedMasks.length}`,
      className: selectedClass,
      morphotypeName: selectedClass === "liquen" && morphotypeName.trim() ? morphotypeName.trim() : undefined,
      pixels: countMaskPixels(activeCandidate.mask),
      score: activeCandidate.score,
      model: "MobileSAM",
      createdAt: new Date().toISOString(),
      width: activeCandidate.width,
      height: activeCandidate.height,
      mask: activeCandidate.mask,
    };
    setAcceptedMasks((v) => [...v, nextMask]);
    setVisibleMaskIds((v) => [...v, nextMask.id]);
    setSelectedMaskId(nextMask.id);
  }, [acceptedMasks.length, activeCandidate, morphotypeName, selectedClass]);

  const handleDeleteMask = useCallback((maskId: string) => {
    setAcceptedMasks((v) => v.filter((m) => m.id !== maskId));
    setVisibleMaskIds((v) => v.filter((id) => id !== maskId));
    if (selectedMaskId === maskId) setSelectedMaskId(null);
  }, [selectedMaskId]);

  const toggleMaskVisibility = useCallback((maskId: string) => {
    setVisibleMaskIds((v) => v.includes(maskId) ? v.filter((id) => id !== maskId) : [...v, maskId]);
  }, []);

  // ── Mask overlay rendered via data URL image ──────────────────────────────
  const [maskImageEl, setMaskImageEl] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const url = activeCandidate?.maskDataUrl;
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => { if (!cancelled) setMaskImageEl(img); };
    img.onerror = () => { if (!cancelled) setMaskImageEl(null); };
    if (url) {
      img.src = url;
    } else {
      img.onerror(new Event("error"));
    }
    return () => { cancelled = true; };
  }, [activeCandidate?.maskDataUrl]);

  // ── Retry logic ───────────────────────────────────────────────────────────
  const retryCurrentTask = useCallback(() => {
    if (uiState.errorOperation === "connect") {
      transition("connecting");
      fetch("/api/vision/health").then((r) => {
        if (r.ok) transition("service-ready");
        else transition("error", { status: "Servicio no disponible.", error: "HTTP " + r.status, errorOperation: "connect" });
      }).catch(() => transition("error", { status: "No se pudo conectar.", error: "Timeout.", errorOperation: "connect" }));
      return;
    }
    if (uiState.errorOperation === "prepare-image" && asset) {
      // We don't have the original File anymore; just reset to service-ready
      transition("service-ready", { status: "Selecciona la imagen nuevamente para reintentarlo." });
      return;
    }
    if (uiState.errorOperation === "segment" && points.length > 0 && activeSessionIdRef.current) {
      callSegment(points, activeSessionIdRef.current);
    }
  }, [asset, callSegment, points, transition, uiState.errorOperation]);

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const evaluable = acceptedMasks.filter((m) => ["liquen", "corteza", "musgo", "alga"].includes(m.className)).length;
    const excluded = acceptedMasks.filter((m) => ["sombra", "reflejo", "desconocido"].includes(m.className)).length;
    const liquenPixels = acceptedMasks.filter((m) => m.className === "liquen").reduce((s, m) => s + m.pixels, 0);
    const cover = evaluable > 0 ? Math.round((liquenPixels / Math.max(1, evaluable)) * 100) : 0;
    return { evaluable, excluded, liquenPixels, cover };
  }, [acceptedMasks]);

  const isPreparing = uiState.phase === "preparing-image";
  const isSegmenting = uiState.phase === "segmenting";
  const promptButtonsDisabled = !asset || isPreparing || isSegmenting;
  const retryButtonLabel =
    uiState.errorOperation === "segment" ? "Reintentar mascara" :
    uiState.errorOperation === "prepare-image" ? "Reintentar preparar imagen" :
    "Reintentar conexion";

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
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Backend:</span>
            <span>MobileSAM vit_t · CPU · Servidor</span>
            <span className="ml-auto rounded-full px-2 py-0.5 text-xs font-semibold" style={{
              background: uiState.phase === "service-ready" || uiState.phase === "image-ready" || uiState.phase === "mask-ready" ? "var(--ld-green)" : "var(--ld-text-secondary)",
              color: "white",
            }}>
              {uiState.phase === "connecting" ? "conectando" :
               uiState.phase === "error" ? "error" :
               uiState.phase === "idle" ? "iniciando" : "activo"}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_0.8fr]">
          <div className="rounded-2xl border border-[var(--ld-border)] bg-[var(--ld-background)] p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2 font-medium" style={{ color: "var(--ld-text)" }}>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="mr-2" onChange={handleFileSelection} />
                Seleccionar imagen local
              </label>
              <button className="rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2" onClick={() => { setViewScale(1); setViewX(0); setViewY(0); }}>Ajustar a pantalla</button>
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
                    listening={canPlacePoint}
                  >
                    <Layer>
                      <Group>
                        {imageElement ? <KonvaImage image={imageElement} width={stageWidth} height={stageHeight} /> : null}
                        {maskImageEl ? (
                          <KonvaImage
                            image={maskImageEl}
                            width={stageWidth}
                            height={stageHeight}
                            opacity={maskOpacity}
                            globalCompositeOperation="multiply"
                          />
                        ) : null}
                        {points.map((point, index) => (
                          <Circle
                            key={index}
                            x={point.x * stageWidth}
                            y={point.y * stageHeight}
                            radius={6}
                            fill={point.label === 1 ? "#4F7C5B" : "#C2410C"}
                            stroke="#FFFFFF"
                            strokeWidth={2}
                            draggable={canPlacePoint}
                            dragBoundFunc={(position) => ({
                              x: Math.min(stageWidth, Math.max(0, position.x)),
                              y: Math.min(stageHeight, Math.max(0, position.y)),
                            })}
                            onDragStart={handlePointDragStart}
                            onDragEnd={(event) => handlePointDragEnd(index, event)}
                          />
                        ))}
                        {acceptedMasks.filter((m) => visibleMaskIds.includes(m.id)).map((mask) => {
                          const cellWidth = stageWidth / Math.max(mask.width, 1);
                          const cellHeight = stageHeight / Math.max(mask.height, 1);
                          return (
                            <Group key={mask.id}>
                              {mask.mask.flatMap((row, ri) => row.flatMap((v, ci) => (v === 1 ? [
                                <Rect
                                  key={`${mask.id}-${ri}-${ci}`}
                                  x={ci * cellWidth}
                                  y={ri * cellHeight}
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
                  <div className="text-[var(--ld-text-secondary)]">Verdes — indican la region objetivo.</div>
                </div>
                <div className="rounded-lg border border-[var(--ld-border)] p-3">
                  <div className="font-medium">Puntos negativos</div>
                  <div className="text-[var(--ld-text-secondary)]">Rojos — indican lo que no es el objetivo.</div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  className="flex-1 rounded-lg px-3 py-2 font-semibold text-white"
                  style={{ background: promptMode === "include" ? "var(--ld-green)" : "#9CA3AF" }}
                  disabled={promptButtonsDisabled}
                  onClick={() => setPromptMode("include")}
                >
                  Añadir area
                </button>
                <button
                  className="flex-1 rounded-lg border border-[var(--ld-border)] px-3 py-2 font-semibold"
                  style={{ background: promptMode === "exclude" ? "#FEE2E2" : "white", color: promptMode === "exclude" ? "#B91C1C" : "inherit" }}
                  disabled={promptButtonsDisabled}
                  onClick={() => setPromptMode("exclude")}
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
                  onClick={() => setCandidateIndex((v) => Math.max(0, v - 1))}
                  disabled={candidates.length === 0 || candidateIndex === 0}
                >
                  Anterior
                </button>
                <span className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                  {candidates.length > 0 ? `${candidateIndex + 1} / ${candidates.length}` : "—"}
                </span>
                <button
                  className="rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2"
                  onClick={() => setCandidateIndex((v) => Math.min(Math.max(candidates.length - 1, 0), v + 1))}
                  disabled={candidates.length === 0 || candidateIndex >= candidates.length - 1}
                >
                  Siguiente
                </button>
              </div>
              <div className="mt-3 rounded-lg border border-[var(--ld-border)] bg-[var(--ld-background)] p-3 text-sm">
                {activeCandidate
                  ? <div>Confianza: {(activeCandidate.score * 100).toFixed(1)}%</div>
                  : <div>Sin mascara aun</div>}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <label className="text-sm">Opacidad</label>
                <input type="range" min="0.1" max="0.9" step="0.05" value={maskOpacity} onChange={(e) => setMaskOpacity(Number(e.target.value))} />
              </div>
              <div className="mt-3 flex gap-2">
                <button className="flex-1 rounded-lg bg-[var(--ld-green)] px-3 py-2 font-semibold text-white" onClick={handleAcceptMask} disabled={!activeCandidate}>Aceptar mascara</button>
                <button className="flex-1 rounded-lg border border-[var(--ld-border)] bg-white px-3 py-2 font-semibold" onClick={() => { setCandidates([]); if (asset) transition("image-ready"); }} disabled={candidates.length === 0}>Descartar</button>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--ld-border)] bg-white p-4">
              <h2 className="text-lg font-semibold">Clase y morfotipo</h2>
              <select className="mt-2 w-full rounded-lg border border-[var(--ld-border)] p-2" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value as AcceptedMask["className"])}>
                {CLASS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {selectedClass === "liquen" ? (
                <input className="mt-2 w-full rounded-lg border border-[var(--ld-border)] p-2" value={morphotypeName} onChange={(e) => setMorphotypeName(e.target.value)} placeholder="Nombre de morfotipo" />
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
          <div className="rounded-2xl border border-[var(--ld-border)] bg-white p-4">
            <h2 className="text-lg font-semibold">Mascaras aceptadas</h2>
            <div className="mt-3 space-y-2">
              {acceptedMasks.length === 0
                ? <div className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Aun no hay mascaras aceptadas.</div>
                : acceptedMasks.map((mask) => (
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

"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import PageHeader from "@/components/PageHeader";
import { fetchProjects } from "@/modules/projects/client";
import { fetchSitesByProject } from "@/modules/sites/client";
import { fetchSamplingEventsBySite } from "@/modules/sampling-events/client";
import { fetchTreesBySite } from "@/modules/trees/client";
import type { Project, SamplingEvent, Site, Tree } from "@/types/domain";
import {
  analyzeFourViewFile,
  confirmSeries,
  ensureTreeSampleForTree,
  finalizeSeries,
  getOrCreateCaptureSeries,
  loadSeriesResults,
  listEvaluatedTrees,
  saveProcessedView,
  type CaptureSeriesRow,
  type EvaluatedTreeRow,
} from "./client";
import { classificationLabel, detectionMessage, reprojectionLabel } from "./assistance";
import { aggregateFourViewMetrics } from "./metrics";
import {
  DIRECTIONS,
  DIRECTION_LABELS,
  type CornerPoint,
  type Direction,
  type VisionViewResult,
} from "./types";

type SlotState = {
  file: File | null;
  requestKey: string;
  status:
    | "empty"
    | "ready"
    | "processing"
    | "needs_confirmation"
    | "confirming"
    | "rectification_review"
    | "analyzing"
    | "saved"
    | "repeat"
    | "error";
  error: string | null;
  result: VisionViewResult | null;
  corners: CornerPoint[] | null;
  initialCorners: CornerPoint[] | null;
};

const EMPTY_SLOT = (): SlotState => ({
  file: null,
  requestKey: crypto.randomUUID(),
  status: "empty",
  error: null,
  result: null,
  corners: null,
  initialCorners: null,
});
const EMPTY_SLOTS = (): Record<Direction, SlotState> => ({
  N: EMPTY_SLOT(), E: EMPTY_SLOT(), S: EMPTY_SLOT(), W: EMPTY_SLOT(),
});
const CAPTURE_INSTRUCTIONS = [
  "Coloca el borde inferior de la plantilla a 1 m sobre la base del árbol.",
  "Colócate aproximadamente a 1 m del tronco.",
  "Usa lente 1× sin zoom digital.",
  "Mantén la cámara perpendicular.",
  "Incluye los cuatro marcadores.",
  "Evita reflejos fuertes, movimiento y desenfoque.",
  "Fotografía Norte, Este, Sur y Oeste.",
];

function suggestedDirection(heading: number | null): Direction | null {
  if (heading === null) return null;
  if (heading >= 315 || heading < 45) return "N";
  if (heading < 135) return "E";
  if (heading < 225) return "S";
  return "W";
}

function statusLabel(slot: SlotState): string {
  if (slot.status === "empty") return "Sin fotografía";
  if (slot.status === "ready") return "Lista para procesar";
  if (slot.status === "processing") return "Validando y analizando…";
  if (slot.status === "needs_confirmation") return "Área propuesta · necesita confirmación";
  if (slot.status === "confirming") return "Validando las cuatro esquinas…";
  if (slot.status === "rectification_review") return "Rectificación lista para revisión";
  if (slot.status === "analyzing") return "Analizando el área confirmada…";
  if (slot.status === "saved") return "Procesada por IA · pendiente de revisión";
  if (slot.status === "repeat") return "Repetir fotografía";
  return "Error";
}

function CornerEditor({
  file,
  corners,
  onChange,
}: {
  file: File;
  corners: CornerPoint[];
  onChange: (corners: CornerPoint[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const source = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(source), [source]);

  const moveCorner = (index: number, clientX: number, clientY: number) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const next = corners.map((point) => ({ ...point }));
    next[index] = {
      x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)),
    };
    onChange(next);
  };
  const handleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current === null) return;
    event.preventDefault();
    moveCorner(dragging.current, event.clientX, event.clientY);
  };

  return (
    <div
      ref={containerRef}
      className="relative mt-3 w-full touch-none overflow-hidden rounded border bg-slate-100"
      style={{ borderColor: "var(--ld-border)" }}
      onPointerMove={handleMove}
      onPointerUp={() => { dragging.current = null; }}
      onPointerCancel={() => { dragging.current = null; }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={source} alt="Fotografía con la abertura propuesta" className="block h-auto w-full" />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
      >
        <polygon
          points={corners.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="rgba(16, 185, 129, 0.14)"
          stroke="#047857"
          strokeWidth="0.006"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {corners.map((point, index) => (
        <button
          key={index}
          type="button"
          aria-label={`Mover esquina ${index + 1}`}
          className="absolute h-11 w-11 touch-none rounded-full border-4 border-white bg-emerald-700 text-sm font-bold text-white shadow"
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, transform: "translate(-50%, -50%)" }}
          onPointerDown={(event) => {
            dragging.current = index;
            event.currentTarget.setPointerCapture(event.pointerId);
            moveCorner(index, event.clientX, event.clientY);
          }}
        >
          {index + 1}
        </button>
      ))}
    </div>
  );
}

function ResultVisual({ slot, layer }: { slot: SlotState; layer: string }) {
  if (!slot.result) return null;
  const original = slot.file ? URL.createObjectURL(slot.file) : slot.result.rectified_image_data_url;
  const rectified = slot.result.rectified_image_data_url;
  const mask = slot.result.metrics?.lichen_union_mask_data_url;
  const source = layer === "original" ? original : rectified;
  if (!source) return null;
  return (
    <div className="relative mt-3 h-72 overflow-hidden rounded border bg-slate-100" style={{ borderColor: "var(--ld-border)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={source}
        alt={slot.file ? `Vista ${slot.file.name}` : "Vista rectificada"}
        className={`h-full w-full object-contain ${layer !== "original" && layer !== "grid" ? "saturate-50 opacity-70" : ""}`}
        onLoad={() => { if (slot.file && original) URL.revokeObjectURL(original); }}
      />
      {mask && (layer === "lichen" || layer === "morphotypes") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mask}
          alt="Máscara provisional"
          className={`absolute inset-0 h-full w-full object-contain opacity-15 ${layer === "morphotypes" ? "sepia hue-rotate-90" : ""}`}
          style={{ filter: layer === "morphotypes" ? "sepia(1) saturate(5) hue-rotate(70deg)" : "drop-shadow(1px 0 white) drop-shadow(-1px 0 black)" }}
        />
      ) : null}
      {layer === "grid" ? (
        <div className="pointer-events-none absolute inset-0 grid grid-rows-5">
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="border border-white/80" />)}
        </div>
      ) : null}
    </div>
  );
}

export default function FourViewWorkflow() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [events, setEvents] = useState<SamplingEvent[]>([]);
  const [trees, setTrees] = useState<Tree[]>([]);
  const [projectId, setProjectId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [eventId, setEventId] = useState("");
  const [treeId, setTreeId] = useState("");
  const [slots, setSlots] = useState<Record<Direction, SlotState>>(EMPTY_SLOTS);
  const [series, setSeries] = useState<CaptureSeriesRow | null>(null);
  const [contextConfirmed, setContextConfirmed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [layer, setLayer] = useState("lichen");
  const [heading, setHeading] = useState<number | null>(null);
  const [evaluated, setEvaluated] = useState<EvaluatedTreeRow[]>([]);
  const assistedOperation = useRef(false);
  const operationTokens = useRef<Partial<Record<Direction, string>>>({});

  const resetCapture = () => {
    operationTokens.current = {};
    setSlots(EMPTY_SLOTS());
    setSeries(null);
    setContextConfirmed(false);
  };

  useEffect(() => {
    void fetchProjects().then(({ projects: rows, error }) => {
      if (error) setGlobalError(error);
      setProjects(rows);
      setProjectId((current) => rows.some((item) => item.id === current) ? current : (rows[0]?.id ?? ""));
    });
    void listEvaluatedTrees().then(setEvaluated).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!projectId) return;
    void fetchSitesByProject(projectId).then(({ sites: rows, error }) => {
      if (error) setGlobalError(error);
      setSites(rows);
      setSiteId((current) => rows.some((item) => item.id === current) ? current : (rows[0]?.id ?? ""));
    });
  }, [projectId]);
  useEffect(() => {
    if (!siteId) return;
    void Promise.all([fetchSamplingEventsBySite(siteId), fetchTreesBySite(siteId)]).then(([eventResult, treeResult]) => {
      if (eventResult.error || treeResult.error) setGlobalError(eventResult.error ?? treeResult.error);
      setEvents(eventResult.samplingEvents);
      setTrees(treeResult.trees);
      setEventId((current) => eventResult.samplingEvents.some((item) => item.id === current)
        ? current
        : (eventResult.samplingEvents[0]?.id ?? ""));
      setTreeId((current) => treeResult.trees.some((item) => item.id === current)
        ? current
        : (treeResult.trees[0]?.id ?? ""));
    });
  }, [siteId]);
  useEffect(() => {
    const listener = (event: DeviceOrientationEvent) => {
      const withCompass = event as DeviceOrientationEvent & { webkitCompassHeading?: number };
      const value = withCompass.webkitCompassHeading ?? (event.alpha == null ? null : (360 - event.alpha) % 360);
      if (value !== null && Number.isFinite(value)) setHeading(value);
    };
    window.addEventListener("deviceorientationabsolute", listener as EventListener);
    window.addEventListener("deviceorientation", listener);
    return () => {
      window.removeEventListener("deviceorientationabsolute", listener as EventListener);
      window.removeEventListener("deviceorientation", listener);
    };
  }, []);

  const selectedTree = trees.find((tree) => tree.id === treeId);
  const selectedEvent = events.find((event) => event.id === eventId);
  const capturedCount = DIRECTIONS.filter((direction) => slots[direction].file || slots[direction].result).length;
  const summary = useMemo(() => aggregateFourViewMetrics(DIRECTIONS.map((direction) => slots[direction].result)), [slots]);
  const suggestion = suggestedDirection(heading);
  const assistedBusy = DIRECTIONS.some((direction) => (
    ["processing", "confirming", "analyzing"].includes(slots[direction].status)
  ));
  const operationLocked = processing || assistedBusy;
  const captureLocked = operationLocked || series?.status === "confirmed";
  const canProcess = contextConfirmed
    && series?.status !== "confirmed"
    && DIRECTIONS.every((direction) => slots[direction].file || slots[direction].result?.status === "provisional_ai")
    && DIRECTIONS.some((direction) => slots[direction].file && ["ready", "error"].includes(slots[direction].status));

  const chooseFile = (direction: Direction, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    operationTokens.current[direction] = crypto.randomUUID();
    setSlots((current) => ({
      ...current,
      [direction]: file ? {
        file,
        requestKey: crypto.randomUUID(),
        status: "ready",
        error: null,
        result: null,
        corners: null,
        initialCorners: null,
      } : EMPTY_SLOT(),
    }));
    event.currentTarget.value = "";
  };

  const processAll = async () => {
    if (!projectId || !siteId || !eventId || !treeId || !canProcess) {
      setGlobalError("Confirma el árbol y la jornada, y completa las cuatro vistas.");
      return;
    }
    setProcessing(true);
    setGlobalError(null);
    try {
      const treeSampleId = await ensureTreeSampleForTree(siteId, eventId, treeId);
      const activeSeries = await getOrCreateCaptureSeries(treeSampleId);
      setSeries(activeSeries);
      const completed = Object.fromEntries(DIRECTIONS.map((direction) => {
        const result = slots[direction].result;
        return [direction, result?.status === "provisional_ai" ? result : null];
      })) as Record<Direction, VisionViewResult | null>;
      for (const direction of DIRECTIONS) {
        const slot = slots[direction];
        const file = slot.file;
        if (!file || !["ready", "error"].includes(slot.status)) continue;
        setSlots((current) => ({ ...current, [direction]: { ...current[direction], status: "processing", error: null } }));
        try {
          const result = await analyzeFourViewFile(file);
          if (result.status === "needs_confirmation") {
            setSlots((current) => ({
              ...current,
              [direction]: {
                ...current[direction],
                result,
                status: "needs_confirmation",
                error: null,
                corners: result.corner_proposal?.map((point) => ({ ...point })) ?? null,
                initialCorners: result.corner_proposal?.map((point) => ({ ...point })) ?? null,
              },
            }));
            continue;
          }
          await saveProcessedView({
            file,
            direction,
            result,
            series: activeSeries,
            requestKey: slot.requestKey,
            context: { projectId, siteId, eventId, treeSampleId },
          });
          completed[direction] = result;
          setSlots((current) => ({
            ...current,
            [direction]: {
              ...current[direction],
              result,
              status: result.status === "repeat_photo" ? "repeat" : "saved",
              error: result.critical_errors.length ? result.critical_errors.join(", ") : null,
              corners: null,
              initialCorners: null,
            },
          }));
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "No se pudo procesar la vista.";
          setSlots((current) => ({ ...current, [direction]: { ...current[direction], status: "error", error: message } }));
        }
      }
      const updatedSeries = await finalizeSeries(activeSeries.id, DIRECTIONS.map((direction) => completed[direction]));
      setSeries(updatedSeries);
      setEvaluated(await listEvaluatedTrees());
    } catch (reason) {
      setGlobalError(reason instanceof Error ? reason.message : "No se pudo completar la serie.");
    } finally {
      setProcessing(false);
    }
  };

  const saveSingleResult = async (
    direction: Direction,
    result: VisionViewResult,
    file: File,
    requestKey: string,
    operationToken: string,
  ) => {
    if (operationTokens.current[direction] !== operationToken) return;
    if (!projectId || !siteId || !eventId || !treeId) {
      throw new Error("No se conserva la imagen o el contexto necesario para guardar esta vista.");
    }
    const treeSampleId = await ensureTreeSampleForTree(siteId, eventId, treeId);
    const activeSeries = series ?? await getOrCreateCaptureSeries(treeSampleId);
    if (!series) setSeries(activeSeries);
    await saveProcessedView({
      file,
      direction,
      result,
      series: activeSeries,
      requestKey,
      context: { projectId, siteId, eventId, treeSampleId },
    });
    if (operationTokens.current[direction] !== operationToken) return;
    setSlots((current) => ({
      ...current,
      [direction]: current[direction].requestKey === requestKey ? {
        ...current[direction],
        result,
        status: result.status === "repeat_photo" ? "repeat" : "saved",
        error: result.critical_errors.length ? result.critical_errors.join(", ") : null,
        corners: null,
        initialCorners: null,
      } : current[direction],
    }));
    const storedResults = await loadSeriesResults(activeSeries.id);
    const updatedSeries = await finalizeSeries(
      activeSeries.id,
      DIRECTIONS.map((item) => storedResults[item] ?? null),
    );
    setSeries(updatedSeries);
    setEvaluated(await listEvaluatedTrees());
  };

  const updateCorners = (direction: Direction, corners: CornerPoint[]) => {
    setSlots((current) => ({
      ...current,
      [direction]: { ...current[direction], corners },
    }));
  };

  const confirmArea = async (direction: Direction) => {
    const slot = slots[direction];
    if (!slot.file || !slot.corners || assistedOperation.current) return;
    assistedOperation.current = true;
    const operationToken = crypto.randomUUID();
    operationTokens.current[direction] = operationToken;
    setSlots((current) => ({
      ...current,
      [direction]: { ...current[direction], status: "confirming", error: null },
    }));
    try {
      const result = await analyzeFourViewFile(slot.file, "confirm_corners", slot.corners);
      if (operationTokens.current[direction] !== operationToken) return;
      setSlots((current) => ({
        ...current,
        [direction]: {
          ...current[direction],
          result,
          status: "rectification_review",
          error: result.critical_errors.length ? result.critical_errors.join(", ") : null,
        },
      }));
    } catch (reason) {
      if (operationTokens.current[direction] !== operationToken) return;
      setSlots((current) => ({
        ...current,
        [direction]: {
          ...current[direction],
          status: "needs_confirmation",
          error: reason instanceof Error ? reason.message : "No se pudieron validar las esquinas.",
        },
      }));
    } finally {
      if (operationTokens.current[direction] === operationToken) {
        delete operationTokens.current[direction];
      }
      assistedOperation.current = false;
    }
  };

  const analyzeConfirmedArea = async (direction: Direction) => {
    const slot = slots[direction];
    if (!slot.file || !slot.corners || assistedOperation.current) return;
    assistedOperation.current = true;
    const operationToken = crypto.randomUUID();
    operationTokens.current[direction] = operationToken;
    setSlots((current) => ({
      ...current,
      [direction]: { ...current[direction], status: "analyzing", error: null },
    }));
    try {
      const result = await analyzeFourViewFile(slot.file, "analyze_confirmed", slot.corners);
      if (operationTokens.current[direction] !== operationToken) return;
      await saveSingleResult(direction, result, slot.file, slot.requestKey, operationToken);
    } catch (reason) {
      if (operationTokens.current[direction] !== operationToken) return;
      setSlots((current) => ({
        ...current,
        [direction]: {
          ...current[direction],
          status: "rectification_review",
          error: reason instanceof Error ? reason.message : "No se pudo analizar el área confirmada.",
        },
      }));
    } finally {
      if (operationTokens.current[direction] === operationToken) {
        delete operationTokens.current[direction];
      }
      assistedOperation.current = false;
    }
  };

  const retryDetection = async (direction: Direction) => {
    const slot = slots[direction];
    if (!slot.file || assistedOperation.current) return;
    assistedOperation.current = true;
    const operationToken = crypto.randomUUID();
    operationTokens.current[direction] = operationToken;
    setSlots((current) => ({
      ...current,
      [direction]: { ...current[direction], status: "processing", error: null },
    }));
    try {
      const result = await analyzeFourViewFile(slot.file);
      if (operationTokens.current[direction] !== operationToken) return;
      if (result.status === "needs_confirmation") {
        setSlots((current) => ({
          ...current,
          [direction]: {
            ...current[direction],
            result,
            status: "needs_confirmation",
            corners: result.corner_proposal?.map((point) => ({ ...point })) ?? null,
            initialCorners: result.corner_proposal?.map((point) => ({ ...point })) ?? null,
          },
        }));
      } else {
        await saveSingleResult(direction, result, slot.file, slot.requestKey, operationToken);
      }
    } catch (reason) {
      if (operationTokens.current[direction] !== operationToken) return;
      setSlots((current) => ({
        ...current,
        [direction]: {
          ...current[direction],
          status: "error",
          error: reason instanceof Error ? reason.message : "No se pudo reintentar la detección.",
        },
      }));
    } finally {
      if (operationTokens.current[direction] === operationToken) {
        delete operationTokens.current[direction];
      }
      assistedOperation.current = false;
    }
  };

  const confirm = async () => {
    if (!series || summary.validViews !== 4) return;
    try {
      await confirmSeries(series.id);
      setSeries({ ...series, status: "confirmed", review_status: "confirmed", confirmed_at: new Date().toISOString() });
      setEvaluated(await listEvaluatedTrees());
    } catch (reason) {
      setGlobalError(reason instanceof Error ? reason.message : "No se pudo confirmar la evaluación.");
    }
  };

  const repeat = (direction: Direction) => {
    setSlots((current) => ({ ...current, [direction]: EMPTY_SLOT() }));
  };

  const openEvaluation = async (row: EvaluatedTreeRow) => {
    try {
      const stored = await loadSeriesResults(row.series.id);
      setProjectId(row.projectId);
      setSiteId(row.siteId);
      setEventId(row.eventId);
      setTreeId(row.treeId);
      setSlots(Object.fromEntries(DIRECTIONS.map((direction) => {
        const result = stored[direction] ?? null;
        return [direction, {
          file: null,
          requestKey: crypto.randomUUID(),
          result,
          status: result?.status === "provisional_ai" ? "saved" : result ? "repeat" : "empty",
          error: result?.critical_errors.join(", ") || null,
          corners: null,
          initialCorners: null,
        }];
      })) as Record<Direction, SlotState>);
      setSeries(row.series);
      setContextConfirmed(true);
    } catch {
      setGlobalError("No se pudo abrir la evaluación guardada.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Captura científica de cuatro vistas"
        subtitle="Flujo automático con plantilla LICHENDR-FRAME-0.2. MobileSAM propone regiones visuales; no identifica especies."
      />
      <div className="flex justify-end">
        <Link href="/images/advanced" className="text-sm underline">Abrir carga manual avanzada</Link>
      </div>

      <section className="rounded-lg border p-5" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <div className="grid gap-4 md:grid-cols-4">
          <label className="text-sm">Proyecto
            <select disabled={operationLocked} className="mt-1 w-full rounded border p-2 disabled:opacity-50" value={projectId} onChange={(event) => {
              resetCapture(); setProjectId(event.target.value); setSiteId(""); setEventId(""); setTreeId(""); setSites([]); setEvents([]); setTrees([]);
            }}>
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Sitio
            <select disabled={operationLocked} className="mt-1 w-full rounded border p-2 disabled:opacity-50" value={siteId} onChange={(event) => {
              resetCapture(); setSiteId(event.target.value); setEventId(""); setTreeId(""); setEvents([]); setTrees([]);
            }}>
              {sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Jornada
            <select disabled={operationLocked} className="mt-1 w-full rounded border p-2 disabled:opacity-50" value={eventId} onChange={(event) => {
              resetCapture(); setEventId(event.target.value);
            }}>
              {events.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Árbol existente
            <select disabled={operationLocked} className="mt-1 w-full rounded border p-2 disabled:opacity-50" value={treeId} onChange={(event) => {
              resetCapture(); setTreeId(event.target.value);
            }}>
              {trees.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-4 grid gap-2 text-sm md:grid-cols-3">
          <strong>Árbol seleccionado: {selectedTree?.code ?? "—"}</strong>
          <strong>Jornada seleccionada: {selectedEvent?.name ?? "—"}</strong>
          <strong>Serie fotográfica: {capturedCount} de 4</strong>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!eventId || !treeId || contextConfirmed || operationLocked}
            onClick={() => setContextConfirmed(true)}
            className="rounded bg-emerald-800 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {contextConfirmed ? "Árbol y jornada confirmados" : "Confirmar árbol y jornada"}
          </button>
          {contextConfirmed ? <span className="text-sm text-emerald-800">Contexto bloqueado para esta serie; cambia un selector para reiniciar.</span> : null}
        </div>
      </section>

      <section className="rounded-lg border p-5" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <h2 className="font-semibold">Protocolo de captura</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          {CAPTURE_INSTRUCTIONS.map((instruction) => <li key={instruction}>{instruction}</li>)}
        </ol>
        <p className="mt-3 text-sm">
          La escala se obtiene de la plantilla, no de la distancia. {suggestion
            ? `La brújula sugiere fotografiar ${DIRECTION_LABELS[suggestion]} ahora.`
            : "Sin orientación disponible: usa el espacio N/E/S/O correspondiente."}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {DIRECTIONS.map((direction) => {
          const slot = slots[direction];
          const fileInputId = `four-view-file-${direction}`;
          const awaitingArea = ["needs_confirmation", "confirming"].includes(slot.status);
          const reviewingArea = ["rectification_review", "analyzing"].includes(slot.status);
          return (
            <article
              key={direction}
              className={`min-h-64 rounded-lg border p-4 ${awaitingArea || reviewingArea ? "xl:col-span-2" : ""}`}
              style={{ background: "var(--ld-card)", borderColor: suggestion === direction ? "#D9BD67" : "var(--ld-border)" }}
            >
              <h2 className="text-xl font-bold">{DIRECTION_LABELS[direction]}</h2>
              <p className="mt-1 text-sm">{statusLabel(slot)}</p>
              <label
                htmlFor={fileInputId}
                className={`mt-5 block rounded bg-emerald-800 px-4 py-3 text-center text-white ${!contextConfirmed || captureLocked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                {series?.status === "confirmed" ? "Evaluación confirmada" : slot.file || slot.result ? "Reemplazar imagen" : "Tomar foto o elegir archivo"}
                <input
                  id={fileInputId}
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
                  capture="environment"
                  disabled={!contextConfirmed || captureLocked}
                  onChange={(event) => chooseFile(direction, event)}
                />
              </label>
              {slot.file ? <p className="mt-3 break-all text-xs">{slot.file.name}</p> : null}
              {slot.error ? <p className="mt-3 text-sm text-red-700">{slot.error}</p> : null}
              {slot.result ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded bg-slate-50 p-3 text-xs">
                  <div><dt className="font-semibold">Método</dt><dd className="break-words">{slot.result.frame_detection.method}</dd></div>
                  <div><dt className="font-semibold">Confianza</dt><dd>{Math.round(slot.result.frame_detection.confidence * 100)}%</dd></div>
                  <div><dt className="font-semibold">Marcadores</dt><dd>{slot.result.frame_detection.detected_marker_ids.join(", ") || "Ninguno"}</dd></div>
                  <div><dt className="font-semibold">Reproyección</dt><dd>{reprojectionLabel(slot.result.reprojection_error_px)}</dd></div>
                  <div className="col-span-2">
                    <dt className="font-semibold">Trazabilidad</dt>
                    <dd>{classificationLabel(slot.result.frame_detection.classification)}</dd>
                  </div>
                </dl>
              ) : null}
              {awaitingArea && slot.file && slot.corners ? (
                <div className="mt-4">
                  <p className="font-medium text-amber-900">{detectionMessage(slot.result!.frame_detection)}</p>
                  <p className="mt-1 text-sm">Encontramos el marco, pero necesitamos tu confirmación.</p>
                  <p className="mt-1 text-sm">Mueve las cuatro esquinas hasta coincidir con la abertura de 10 × 50 cm.</p>
                  <CornerEditor
                    file={slot.file}
                    corners={slot.corners}
                    onChange={(corners) => {
                      if (!operationLocked) updateCorners(direction, corners);
                    }}
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={operationLocked}
                      className="rounded bg-emerald-800 px-4 py-2 text-sm text-white disabled:opacity-50"
                      onClick={() => void confirmArea(direction)}
                    >
                      {slot.status === "confirming" ? "Validando área…" : "Confirmar área"}
                    </button>
                    <button
                      type="button"
                      disabled={operationLocked || !slot.initialCorners}
                      className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                      onClick={() => {
                        if (slot.initialCorners) updateCorners(direction, slot.initialCorners.map((point) => ({ ...point })));
                      }}
                    >
                      Restaurar propuesta automática
                    </button>
                    <button
                      type="button"
                      disabled={operationLocked}
                      className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                      onClick={() => void retryDetection(direction)}
                    >
                      Reintentar detección
                    </button>
                    <label htmlFor={fileInputId} className={`rounded border px-3 py-2 text-sm ${captureLocked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
                      Reemplazar imagen
                    </label>
                  </div>
                </div>
              ) : null}
              {reviewingArea && slot.result?.rectified_image_data_url ? (
                <div className="mt-4">
                  <p className="font-medium">Revisa la rectificación antes de continuar.</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={slot.result.rectified_image_data_url}
                    alt={`Rectificación de la vista ${DIRECTION_LABELS[direction]}`}
                    className="mx-auto mt-3 max-h-[36rem] rounded border object-contain"
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={operationLocked || slot.result.critical_errors.length > 0}
                      className="rounded bg-emerald-800 px-4 py-2 text-sm text-white disabled:opacity-50"
                      onClick={() => void analyzeConfirmedArea(direction)}
                    >
                      {slot.status === "analyzing" ? "Analizando área…" : "Continuar con esta área"}
                    </button>
                    <button
                      type="button"
                      disabled={operationLocked}
                      className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                      onClick={() => setSlots((current) => ({
                        ...current,
                        [direction]: { ...current[direction], status: "needs_confirmation" },
                      }))}
                    >
                      Ajustar esquinas
                    </button>
                    <button
                      type="button"
                      disabled={operationLocked}
                      className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                      onClick={() => void retryDetection(direction)}
                    >
                      Reintentar detección
                    </button>
                    <label htmlFor={fileInputId} className={`rounded border px-3 py-2 text-sm ${captureLocked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
                      Reemplazar imagen
                    </label>
                  </div>
                </div>
              ) : null}
              {slot.status === "repeat" ? (
                <button type="button" disabled={operationLocked} className="mt-3 rounded border px-3 py-2 text-sm disabled:opacity-50" onClick={() => repeat(direction)}>Repetir esta vista</button>
              ) : null}
            </article>
          );
        })}
      </section>

      {globalError ? <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">{globalError}</div> : null}
      <button
        type="button"
        disabled={operationLocked || !canProcess}
        onClick={() => void processAll()}
        className="w-full rounded bg-emerald-800 px-5 py-4 font-semibold text-white disabled:opacity-50"
      >
        {processing ? "Procesando secuencialmente…" : "Procesar las cuatro vistas"}
      </button>

      {series ? (
        <section className="space-y-4 rounded-lg border p-5" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <div className="grid gap-3 md:grid-cols-5">
            <div><strong className="text-2xl">{summary.coveragePercent?.toFixed(1) ?? "—"}%</strong><p className="text-xs">Cobertura liquénica total</p></div>
            <div><strong className="text-2xl">{summary.totalValidAreaCm2.toFixed(0)}</strong><p className="text-xs">Área analizada cm²</p></div>
            <div><strong className="text-2xl">{summary.totalLichenAreaCm2.toFixed(1)}</strong><p className="text-xs">Área estimada de liquen cm²</p></div>
            <div><strong className="text-2xl">{summary.morphotypeRichness}</strong><p className="text-xs">Morfotipos visuales provisionales</p></div>
            <div><strong className="text-2xl">{summary.occupiedCells}/20</strong><p className="text-xs">Celdas ocupadas</p></div>
          </div>
          <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
            Cobertura liquénica estimada por IA · {series.review_status === "confirmed" ? "Confirmada" : "Pendiente de revisión"}.
            Los grupos LQ son morfotipos provisionales, no especies.
          </p>
          <label className="block text-sm">Visualización
            <select className="ml-2 rounded border p-2" value={layer} onChange={(event) => setLayer(event.target.value)}>
              <option value="original">Original</option>
              <option value="lichen">Posibles líquenes</option>
              <option value="morphotypes">Morfotipos</option>
              <option value="grid">Cuadrícula</option>
            </select>
          </label>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {DIRECTIONS.map((direction) => {
              const slot = slots[direction];
              const metrics = slot.result?.metrics;
              return (
                <article key={direction} className="rounded border p-3" style={{ borderColor: "var(--ld-border)" }}>
                  <h3 className="font-semibold">{DIRECTION_LABELS[direction]}</h3>
                  <ResultVisual slot={slot} layer={layer} />
                  <p className="mt-2 text-sm">{metrics ? `${metrics.lichen_coverage_percent.toFixed(1)}% · ${metrics.lichen_union_area_cm2.toFixed(1)} cm²` : "Sin métricas válidas"}</p>
                  <p className="text-xs">Calidad {slot.result ? `${Math.round(slot.result.quality_score * 100)}%` : "—"} · {metrics?.provisional_morphotype_richness ?? 0} morfotipos</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="text-xs underline" onClick={() => setLayer("lichen")}>Solo esta capa</button>
                    <button type="button" className="text-xs underline" onClick={() => setLayer("original")}>Ver original</button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={operationLocked || summary.validViews !== 4 || series.status === "confirmed"} onClick={() => void confirm()} className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50">Confirmar evaluación</button>
            <Link href="/annotations" className="rounded border px-4 py-2">Corregir propuesta</Link>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border p-5" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <h2 className="text-lg font-semibold">Árboles evaluados</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr>{["Proyecto", "Sitio", "Jornada", "Árbol", "Fecha", "Vistas", "Cobertura", "Morfotipos", "Estado", "Calidad", ""].map((title) => <th key={title} className="border-b p-2">{title}</th>)}</tr></thead>
            <tbody>
              {evaluated.map((row) => (
                <tr key={row.series.id}>
                  <td className="p-2">{row.project}</td><td className="p-2">{row.site}</td><td className="p-2">{row.event}</td><td className="p-2">{row.tree}</td>
                  <td className="p-2">{new Date(row.series.created_at).toLocaleDateString("es-DO")}</td>
                  <td className="p-2">{row.series.valid_view_count}/4</td>
                  <td className="p-2">{row.series.tree_lichen_coverage_percent?.toFixed(1) ?? "—"}%</td>
                  <td className="p-2">{row.series.provisional_morphotype_richness ?? "—"}</td>
                  <td className="p-2">{row.series.status}</td>
                  <td className="p-2">{row.series.pending_view_count === 0 ? "Completa" : "Pendiente"}</td>
                  <td className="p-2"><button type="button" disabled={operationLocked} className="underline disabled:opacity-50" onClick={() => void openEvaluation(row)}>Ver evaluación</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

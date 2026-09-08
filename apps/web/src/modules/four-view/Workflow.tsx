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
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { fetchProjects } from "@/modules/projects/client";
import { fetchSitesByProject } from "@/modules/sites/client";
import { fetchSamplingEventsBySite } from "@/modules/sampling-events/client";
import { fetchTreesBySite } from "@/modules/trees/client";
import type { Project, SamplingEvent, Site, Tree } from "@/types/domain";
import { resolveFourViewContext } from "@/modules/prepare-day/client";
import {
  analyzeStoredFourViewImage,
  ensureTreeSampleForTree,
  finalizeSeries,
  getOrCreateCaptureSeries,
  loadSeriesResults,
  loadSeriesViews,
  loadStoredImageFile,
  listEvaluatedTrees,
  prepareStoredFourViewImage,
  saveProcessedView,
  stageCaptureView,
  saveTrunkMeasurement,
  type CaptureSeriesRow,
  type CaptureViewRow,
  type EvaluatedTreeRow,
} from "./client";
import { classificationLabel, detectionMessage, reprojectionLabel } from "./assistance";
import {
  CORNER_LABELS,
  ManualOperationGate,
  cornerGeometryError,
  defaultManualCorners,
  runManualOperation,
} from "./manual-flow";
import { captureToAnnotationsDestination } from "./navigation";
import { combineTrunkEstimates, correctTrunkEdges, summarizeCalibration } from "./science";
import {
  DIRECTIONS,
  DIRECTION_LABELS,
  type CornerPoint,
  type Direction,
  type VisionViewResult,
} from "./types";

type SlotState = {
  file: File | null;
  view: CaptureViewRow | null;
  requestKey: string;
  status:
    | "empty"
    | "ready"
    | "saving_original"
    | "preparing_ai"
    | "processing"
    | "needs_confirmation"
    | "four_points_ready"
    | "analyzing"
    | "saved"
    | "repeat"
    | "error";
  error: string | null;
  result: VisionViewResult | null;
  corners: CornerPoint[] | null;
  initialCorners: CornerPoint[] | null;
  estimatedGeometry: boolean;
  provisionalAcknowledged: boolean;
};

const EMPTY_SLOT = (): SlotState => ({
  file: null,
  view: null,
  requestKey: crypto.randomUUID(),
  status: "empty",
  error: null,
  result: null,
  corners: null,
  initialCorners: null,
  estimatedGeometry: false,
  provisionalAcknowledged: false,
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
  if (slot.status === "saving_original") return "Guardando original";
  if (slot.status === "preparing_ai") return "Preparando imagen para IA";
  if (slot.status === "processing") return "Analizando";
  if (slot.status === "needs_confirmation") return "Necesita confirmación manual";
  if (slot.status === "four_points_ready") return "Cuatro puntos listos";
  if (slot.status === "analyzing") return "Procesando análisis";
  if (slot.status === "saved") return "Rectificada y calibrada";
  return "Error recuperable";
}

function CornerEditor({
  file,
  corners,
  disabled,
  onChange,
}: {
  file: File;
  corners: CornerPoint[];
  disabled: boolean;
  onChange: (corners: CornerPoint[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const [activeCorner, setActiveCorner] = useState<number | null>(null);
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
      onPointerUp={() => { dragging.current = null; setActiveCorner(null); }}
      onPointerCancel={() => { dragging.current = null; setActiveCorner(null); }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={source} alt="Fotografía con la abertura propuesta" className="block h-auto w-full" />
      <p className="absolute inset-x-2 top-2 z-20 rounded bg-slate-950/80 p-2 text-center text-xs font-semibold text-white">
        Coloca los puntos en las cuatro esquinas de la abertura interior de 10 × 50 cm, no sobre los marcadores ArUco.
      </p>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
      >
        <path
          d={`M 0 0 H 1 V 1 H 0 Z M ${corners.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`}
          fill="rgba(15, 23, 42, 0.28)"
          fillRule="evenodd"
        />
        <polygon
          points={corners.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="rgba(16, 185, 129, 0.08)"
          stroke="#047857"
          strokeWidth="0.006"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {corners.map((point, index) => (
        <button
          key={index}
          type="button"
          aria-label={`${index + 1}. ${CORNER_LABELS[index]}`}
          disabled={disabled}
          className="absolute h-11 w-11 touch-none rounded-full border-4 border-white bg-emerald-700 text-sm font-bold text-white shadow"
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, transform: "translate(-50%, -50%)" }}
          onPointerDown={(event) => {
            if (disabled) return;
            dragging.current = index;
            setActiveCorner(index);
            event.currentTarget.setPointerCapture(event.pointerId);
            moveCorner(index, event.clientX, event.clientY);
          }}
        >
          {index + 1}
        </button>
      ))}
      {activeCorner !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-20 z-30 h-32 w-32 rounded-full border-4 border-white shadow-xl"
          style={{
            backgroundImage: `url("${source}")`,
            backgroundPosition: `${corners[activeCorner].x * 100}% ${corners[activeCorner].y * 100}%`,
            backgroundRepeat: "no-repeat",
            backgroundSize: "500%",
          }}
        >
          <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-red-600" />
          <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-red-600" />
        </div>
      ) : null}
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
  const searchParams = useSearchParams();
  const urlContext = useMemo(() => {
    // Snapshot the URL context once on mount. Reading it once and using the
    // snapshot for the whole session prevents an unexpected navigation from
    // silently swapping the selected tree mid-capture.
    return {
      projectId: searchParams?.get("projectId") ?? "",
      siteId: searchParams?.get("siteId") ?? "",
      eventId: searchParams?.get("eventId") ?? "",
      treeSampleId: searchParams?.get("treeSampleId") ?? "",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [events, setEvents] = useState<SamplingEvent[]>([]);
  const [trees, setTrees] = useState<Tree[]>([]);
  const [projectId, setProjectId] = useState(urlContext.projectId);
  const [siteId, setSiteId] = useState(urlContext.siteId);
  const [eventId, setEventId] = useState(urlContext.eventId);
  const [treeId, setTreeId] = useState("");
  const [slots, setSlots] = useState<Record<Direction, SlotState>>(EMPTY_SLOTS);
  const [series, setSeries] = useState<CaptureSeriesRow | null>(null);
  const [contextConfirmed, setContextConfirmed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  // Distinct from globalError so we can render it as an alert AND disable
  // capture. When URL context does not resolve we refuse to select any tree.
  const [contextMismatchError, setContextMismatchError] = useState<string | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [evaluated, setEvaluated] = useState<EvaluatedTreeRow[]>([]);
  const [fieldCircumferenceCm, setFieldCircumferenceCm] = useState("");
  const [reviewingTrunkEdges, setReviewingTrunkEdges] = useState(false);
  const manualOperations = useRef(new ManualOperationGate());
  const operationTokens = useRef<Partial<Record<Direction, string>>>({});

  const resetCapture = () => {
    operationTokens.current = {};
    DIRECTIONS.forEach((direction) => manualOperations.current.invalidate(direction));
    setSlots(EMPTY_SLOTS());
    setSeries(null);
    setFieldCircumferenceCm("");
    setReviewingTrunkEdges(false);
    setContextConfirmed(false);
  };

  // Resolve the URL context once on mount. If a `treeSampleId` was provided,
  // walk the sample → event → site → project hierarchy and seed the four
  // dropdowns with those exact identifiers. If the walk fails we surface an
  // error and refuse to auto-select a different tree. This closes the
  // "wrong tree" bug from the QA validation.
  useEffect(() => {
    if (!urlContext.treeSampleId) return;
    let active = true;
    (async () => {
      const result = await resolveFourViewContext(urlContext.treeSampleId, {
        projectId: urlContext.projectId || undefined,
        siteId: urlContext.siteId || undefined,
        eventId: urlContext.eventId || undefined,
      });
      if (!active) return;
      if (!result.ok) {
        setContextMismatchError(
          result.message ??
            "No se pudo resolver el árbol referenciado en el enlace. Vuelve a la jornada y ábrelo de nuevo.",
        );
        return;
      }
      const resolved = result.resolved!;
      setProjectId(resolved.projectId);
      setSiteId(resolved.siteId);
      setEventId(resolved.eventId);
      setTreeId(resolved.treeId);
    })();
    return () => {
      active = false;
    };
  }, [urlContext]);

  useEffect(() => {
    void fetchProjects().then(({ projects: rows, error }) => {
      if (error) setGlobalError(error);
      setProjects(rows);
      setProjectId((current) => {
        if (current && rows.some((item) => item.id === current)) return current;
        // If the URL asked for a specific project but it is not in the list,
        // surface the error instead of silently swapping to a different
        // project. Otherwise (no URL context), pick the first available row.
        if (urlContext.projectId && current === urlContext.projectId) {
          setContextMismatchError(
            "El proyecto del enlace no está disponible con tu sesión. Vuelve a Preparar jornada y comprueba el contexto.",
          );
          return current;
        }
        return rows[0]?.id ?? "";
      });
    });
    void listEvaluatedTrees().then(setEvaluated).catch(() => undefined);
  }, [urlContext]);
  useEffect(() => {
    if (!projectId) return;
    void fetchSitesByProject(projectId).then(({ sites: rows, error }) => {
      if (error) setGlobalError(error);
      setSites(rows);
      setSiteId((current) => {
        if (current && rows.some((item) => item.id === current)) return current;
        if (urlContext.siteId && current === urlContext.siteId) {
          setContextMismatchError(
            "El sitio del enlace no está disponible en este proyecto. Vuelve a la jornada y abre el árbol de nuevo.",
          );
          return current;
        }
        return rows[0]?.id ?? "";
      });
    });
  }, [projectId, urlContext]);
  useEffect(() => {
    if (!siteId) return;
    void Promise.all([fetchSamplingEventsBySite(siteId), fetchTreesBySite(siteId)]).then(([eventResult, treeResult]) => {
      if (eventResult.error || treeResult.error) setGlobalError(eventResult.error ?? treeResult.error);
      setEvents(eventResult.samplingEvents);
      setTrees(treeResult.trees);
      setEventId((current) => {
        if (current && eventResult.samplingEvents.some((item) => item.id === current)) return current;
        if (urlContext.eventId && current === urlContext.eventId) {
          setContextMismatchError(
            "La jornada del enlace no está disponible. Vuelve a Preparar jornada.",
          );
          return current;
        }
        return eventResult.samplingEvents[0]?.id ?? "";
      });
      setTreeId((current) => {
        if (current && treeResult.trees.some((item) => item.id === current)) return current;
        // If we came from a `treeSampleId` URL and the resolver already picked
        // a `treeId`, don't stomp it here — surface an error if the tree is
        // not in this site (should never happen because the resolver already
        // checks parent-child, but defensive).
        if (urlContext.treeSampleId && current) {
          setContextMismatchError(
            "El árbol referenciado no pertenece a este sitio. Vuelve a la jornada y abre el árbol correcto.",
          );
          return current;
        }
        return treeResult.trees[0]?.id ?? "";
      });
    });
  }, [siteId, urlContext]);
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
  const summary = useMemo(() => summarizeCalibration(DIRECTIONS.map((direction) => slots[direction].result)), [slots]);
  const trunkEstimate = useMemo(() => combineTrunkEstimates(Object.fromEntries(
    DIRECTIONS.map((direction) => [direction, slots[direction].result?.trunk_estimate ?? null]),
  )), [slots]);
  const suggestion = suggestedDirection(heading);
  const assistedBusy = DIRECTIONS.some((direction) => (
    ["saving_original", "preparing_ai", "processing", "analyzing"].includes(slots[direction].status)
  ));
  const operationLocked = processing || assistedBusy;
  const captureLocked = operationLocked || series?.status === "completed";
  const canProcess = contextConfirmed
    && series?.status !== "completed"
    && DIRECTIONS.every((direction) => slots[direction].file || slots[direction].result?.rectified_image_data_url)
    && DIRECTIONS.some((direction) => slots[direction].file && ["ready", "error"].includes(slots[direction].status));

  useEffect(() => {
    if (summary.calibrated && DIRECTIONS.some((direction) => (
      slots[direction].result?.trunk_estimate?.confidence === "low"
    ))) {
      setReviewingTrunkEdges(true);
    }
  }, [slots, summary.calibrated]);

  const chooseFile = (direction: Direction, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    manualOperations.current.invalidate(direction);
    operationTokens.current[direction] = crypto.randomUUID();
    setSlots((current) => ({
      ...current,
      [direction]: file ? {
        file,
        view: null,
        requestKey: crypto.randomUUID(),
        status: "ready",
        error: null,
        result: null,
        corners: null,
        initialCorners: null,
        estimatedGeometry: false,
        provisionalAcknowledged: false,
      } : EMPTY_SLOT(),
    }));
    event.currentTarget.value = "";
  };

  const ensureStoredView = async (
    direction: Direction,
    slot: SlotState,
    activeSeries: CaptureSeriesRow,
    treeSampleId: string,
  ): Promise<CaptureViewRow> => {
    if (slot.view) return slot.view;
    if (!slot.file || !projectId || !siteId || !eventId) {
      throw new Error("No se conserva la fotografía o su contexto para subirla.");
    }
    const view = await stageCaptureView({
      file: slot.file,
      direction,
      series: activeSeries,
      requestKey: slot.requestKey,
      context: { projectId, siteId, eventId, treeSampleId },
    });
    setSlots((current) => ({
      ...current,
      [direction]: current[direction].requestKey === slot.requestKey
        ? { ...current[direction], view }
        : current[direction],
    }));
    return view;
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
        return [direction, result?.rectified_image_data_url ? result : null];
      })) as Record<Direction, VisionViewResult | null>;
      for (const direction of DIRECTIONS) {
        const slot = slots[direction];
        const file = slot.file;
        if (!file || !["ready", "error"].includes(slot.status)) continue;
        setSlots((current) => ({ ...current, [direction]: { ...current[direction], status: "saving_original", error: null } }));
        try {
          const view = await ensureStoredView(direction, slot, activeSeries, treeSampleId);
          setSlots((current) => ({ ...current, [direction]: { ...current[direction], status: "preparing_ai" } }));
          await prepareStoredFourViewImage(view.image_id);
          setSlots((current) => ({ ...current, [direction]: { ...current[direction], status: "processing" } }));
          const result = await analyzeStoredFourViewImage(view.image_id);
          if (result.status === "needs_confirmation") {
            const file = slot.file ?? await loadStoredImageFile(view.image_id);
            const proposedCorners = result.corner_proposal?.map((point) => ({ ...point })) ?? null;
            const geometryError = cornerGeometryError(
              proposedCorners,
              result.source_width,
              result.source_height,
            );
            setSlots((current) => ({
              ...current,
              [direction]: {
                ...current[direction],
                file,
                result,
                status: proposedCorners && !geometryError ? "four_points_ready" : "needs_confirmation",
                error: geometryError,
                corners: proposedCorners,
                initialCorners: proposedCorners?.map((point) => ({ ...point })) ?? null,
                estimatedGeometry: false,
                provisionalAcknowledged: false,
              },
            }));
            continue;
          }
          await saveProcessedView({
            view,
            result,
            series: activeSeries,
            context: { projectId, siteId, eventId, treeSampleId },
          });
          if (result.rectified_image_data_url) completed[direction] = result;
          setSlots((current) => ({
            ...current,
            [direction]: {
              ...current[direction],
              result,
              status: result.status === "repeat_photo" ? "repeat" : "saved",
              error: result.critical_errors.length ? result.critical_errors.join(", ") : null,
              corners: null,
              initialCorners: null,
              estimatedGeometry: false,
              provisionalAcknowledged: false,
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
    view: CaptureViewRow,
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
      view,
      result,
      series: activeSeries,
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
      } : current[direction],
    }));
    try {
      const storedResults = await loadSeriesResults(activeSeries.id);
      const updatedSeries = await finalizeSeries(
        activeSeries.id,
        DIRECTIONS.map((item) => storedResults[item] ?? null),
      );
      setSeries(updatedSeries);
      setEvaluated(await listEvaluatedTrees());
    } catch {
      setGlobalError("La vista quedó analizada y guardada, pero no se pudo actualizar el resumen. Recarga para reintentar la sincronización.");
    }
  };

  const updateCorners = (direction: Direction, corners: CornerPoint[]) => {
    setSlots((current) => ({
      ...current,
      [direction]: {
        ...current[direction],
        corners,
        status: cornerGeometryError(
          corners,
          current[direction].result?.source_width ?? 0,
          current[direction].result?.source_height ?? 0,
        ) ? "needs_confirmation" : "four_points_ready",
        error: null,
      },
    }));
  };

  const startManualSelection = (direction: Direction) => {
    const slot = slots[direction];
    if (!slot.file || !slot.result) return;
    const corners = slot.corners ?? defaultManualCorners(slot.result.source_width, slot.result.source_height);
    const error = cornerGeometryError(corners, slot.result.source_width, slot.result.source_height);
    setSlots((current) => ({
      ...current,
      [direction]: {
        ...current[direction],
        corners,
        initialCorners: current[direction].initialCorners ?? corners.map((point) => ({ ...point })),
        status: error ? "needs_confirmation" : "four_points_ready",
        error,
      },
    }));
  };

  const analyzeManualArea = async (direction: Direction) => {
    const slot = slots[direction];
    if (!slot.file || !slot.view || !slot.corners || !["four_points_ready", "error"].includes(slot.status)) return;
    const geometryError = cornerGeometryError(slot.corners, slot.result?.source_width ?? 0, slot.result?.source_height ?? 0);
    if (geometryError || (slot.estimatedGeometry && !slot.provisionalAcknowledged)) return;
    const mode = slot.estimatedGeometry ? "manual_assisted_provisional" : "manual_confirmed";
    await runManualOperation({
      gate: manualOperations.current,
      key: direction,
      onStart: (operationToken) => {
        operationTokens.current[direction] = operationToken;
        setSlots((current) => ({
          ...current,
          [direction]: { ...current[direction], status: "analyzing", error: null },
        }));
      },
      request: () => analyzeStoredFourViewImage(slot.view!.image_id, "analyze_confirmed", slot.corners!, mode),
      onSuccess: async (result, operationToken) => {
        if (!result.rectified_image_data_url || result.critical_errors.length > 0) {
          throw new Error(result.critical_errors.join(", ") || "La calibración no produjo una rectificación utilizable.");
        }
        await saveSingleResult(direction, result, slot.view!, slot.requestKey, operationToken);
      },
      onError: (error) => {
        setSlots((current) => ({
          ...current,
          [direction]: {
            ...current[direction],
            status: "error",
            error: error.message,
          },
        }));
      },
    });
  };

  const retryDetection = async (direction: Direction) => {
    const slot = slots[direction];
    if ((!slot.file && !slot.view) || ["saving_original", "preparing_ai", "processing", "analyzing"].includes(slot.status)) return;
    const operationToken = crypto.randomUUID();
    operationTokens.current[direction] = operationToken;
    setSlots((current) => ({
      ...current,
      [direction]: { ...current[direction], status: "saving_original", error: null },
    }));
    try {
      if (!projectId || !siteId || !eventId || !treeId) {
        throw new Error("No se conserva el contexto necesario para reintentar.");
      }
      const treeSampleId = await ensureTreeSampleForTree(siteId, eventId, treeId);
      const activeSeries = series ?? await getOrCreateCaptureSeries(treeSampleId);
      if (operationTokens.current[direction] !== operationToken) return;
      if (!series) setSeries(activeSeries);
      const view = await ensureStoredView(direction, slot, activeSeries, treeSampleId);
      if (operationTokens.current[direction] !== operationToken) return;
      setSlots((current) => ({
        ...current,
        [direction]: { ...current[direction], status: "preparing_ai" },
      }));
      await prepareStoredFourViewImage(view.image_id);
      if (operationTokens.current[direction] !== operationToken) return;
      setSlots((current) => ({
        ...current,
        [direction]: { ...current[direction], status: "processing" },
      }));
      const result = await analyzeStoredFourViewImage(view.image_id);
      if (operationTokens.current[direction] !== operationToken) return;
      if (result.status === "needs_confirmation") {
        const file = slot.file ?? await loadStoredImageFile(view.image_id);
        const proposedCorners = result.corner_proposal?.map((point) => ({ ...point })) ?? null;
        const geometryError = cornerGeometryError(proposedCorners, result.source_width, result.source_height);
        setSlots((current) => ({
          ...current,
          [direction]: {
            ...current[direction],
            file,
            result,
            status: proposedCorners && !geometryError ? "four_points_ready" : "needs_confirmation",
            error: geometryError,
            corners: proposedCorners,
            initialCorners: proposedCorners?.map((point) => ({ ...point })) ?? null,
            estimatedGeometry: false,
            provisionalAcknowledged: false,
          },
        }));
      } else {
        await saveSingleResult(direction, result, view, slot.requestKey, operationToken);
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
    }
  };

  const repeat = (direction: Direction) => {
    manualOperations.current.invalidate(direction);
    setSlots((current) => ({ ...current, [direction]: EMPTY_SLOT() }));
  };

  const adjustTrunkEdge = (direction: Direction, edge: "left" | "right", value: number) => {
    setSlots((current) => {
      const result = current[direction].result;
      const estimate = result?.trunk_estimate;
      if (!result || !estimate) return current;
      const left = edge === "left" ? value : estimate.left_x_normalized;
      const right = edge === "right" ? value : estimate.right_x_normalized;
      if (left >= right) return current;
      return {
        ...current,
        [direction]: {
          ...current[direction],
          result: {
            ...result,
            trunk_estimate: correctTrunkEdges(estimate, result.source_width, left, right),
          },
        },
      };
    });
  };

  const acceptTrunkAndContinue = async () => {
    if (!series || !summary.calibrated) return;
    const parsed = fieldCircumferenceCm.trim() ? Number(fieldCircumferenceCm) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setGlobalError("La circunferencia medida debe ser un número positivo.");
      return;
    }
    try {
      const saved = await saveTrunkMeasurement(
        series.id,
        parsed,
        trunkEstimate,
        Object.fromEntries(DIRECTIONS.map((direction) => [
          direction,
          slots[direction].result?.trunk_estimate ?? null,
        ])),
      );
      setSeries(saved);
      window.location.assign(captureToAnnotationsDestination(series.id));
    } catch (reason) {
      setGlobalError(reason instanceof Error ? reason.message : "No se pudo guardar el tamaño del tronco.");
    }
  };

  const openEvaluation = async (row: EvaluatedTreeRow) => {
    try {
      const [stored, views] = await Promise.all([
        loadSeriesResults(row.series.id),
        loadSeriesViews(row.series.id),
      ]);
      const viewsByDirection = new Map(views.map((view) => [view.direction, view]));
      setProjectId(row.projectId);
      setSiteId(row.siteId);
      setEventId(row.eventId);
      setTreeId(row.treeId);
      setSlots(Object.fromEntries(DIRECTIONS.map((direction) => {
        const result = stored[direction] ?? null;
        const view = viewsByDirection.get(direction) ?? null;
        return [direction, {
          file: null,
          view,
          requestKey: crypto.randomUUID(),
          result,
          status: result?.rectified_image_data_url ? "saved" : result ? "repeat" : view ? "error" : "empty",
          error: result?.critical_errors.join(", ")
            || (view ? "La fotografía está guardada y su análisis está pendiente. Puedes reintentar la IA." : null),
          corners: null,
          initialCorners: null,
          estimatedGeometry: result?.frame_detection.classification === "manual_assisted_provisional",
          provisionalAcknowledged: false,
        }];
      })) as Record<Direction, SlotState>);
      setSeries(row.series);
      setFieldCircumferenceCm(row.series.circumference_cm?.toString()
        ?? row.series.field_circumference_cm?.toString()
        ?? "");
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
            disabled={!eventId || !treeId || contextConfirmed || operationLocked || !!contextMismatchError}
            onClick={() => setContextConfirmed(true)}
            className="rounded bg-emerald-800 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {contextConfirmed ? "Árbol y jornada confirmados" : "Confirmar árbol y jornada"}
          </button>
          {contextConfirmed ? <span className="text-sm text-emerald-800">Contexto bloqueado para esta serie; cambia un selector para reiniciar.</span> : null}
        </div>
        {contextMismatchError ? (
          <div
            role="alert"
            className="mt-4 rounded border px-4 py-3 text-sm"
            style={{ background: "#F9DAD6", color: "#842029", borderColor: "#F5C2C7" }}
          >
            <strong className="block mb-1">No se puede iniciar la captura con este enlace.</strong>
            {contextMismatchError}
          </div>
        ) : null}
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
          const editingArea = Boolean(slot.file && slot.corners && [
            "needs_confirmation",
            "four_points_ready",
            "analyzing",
            "error",
          ].includes(slot.status));
          const geometryError = cornerGeometryError(
            slot.corners,
            slot.result?.source_width ?? 0,
            slot.result?.source_height ?? 0,
          );
          const requiresProvisionalConfirmation = slot.estimatedGeometry && !slot.provisionalAcknowledged;
          return (
            <article
              key={direction}
              className={`min-h-64 rounded-lg border p-4 ${editingArea ? "xl:col-span-2" : ""}`}
              style={{ background: "var(--ld-card)", borderColor: suggestion === direction ? "#D9BD67" : "var(--ld-border)" }}
            >
              <h2 className="text-xl font-bold">{DIRECTION_LABELS[direction]}</h2>
              <p className="mt-1 text-sm">{statusLabel(slot)}</p>
              <label
                htmlFor={fileInputId}
                className={`mt-5 block rounded bg-emerald-800 px-4 py-3 text-center text-white ${!contextConfirmed || captureLocked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                {series?.status === "completed" ? "Evaluación completada" : slot.file || slot.result ? "Reemplazar imagen" : "Tomar foto o elegir archivo"}
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
                  <div><dt className="font-semibold">Confianza automática previa</dt><dd>{Math.round(slot.result.frame_detection.confidence * 100)}%</dd></div>
                  <div><dt className="font-semibold">Marcadores</dt><dd>{slot.result.frame_detection.detected_marker_ids.join(", ") || "Ninguno"}</dd></div>
                  <div><dt className="font-semibold">Reproyección</dt><dd>{reprojectionLabel(slot.result.reprojection_error_px)}</dd></div>
                  <div className="col-span-2">
                    <dt className="font-semibold">Trazabilidad</dt>
                    <dd>{classificationLabel(slot.result.frame_detection.classification)}</dd>
                  </div>
                </dl>
              ) : null}
              {slot.file && slot.result && !slot.corners && ["needs_confirmation", "repeat", "error"].includes(slot.status) ? (
                <button
                  type="button"
                  disabled={operationLocked}
                  className="mt-4 w-full rounded border border-emerald-800 px-4 py-3 text-sm font-semibold text-emerald-900 disabled:opacity-50"
                  onClick={() => startManualSelection(direction)}
                >
                  Seleccionar abertura manualmente
                </button>
              ) : null}
              {editingArea && slot.file && slot.corners ? (
                <div className="mt-4">
                  {slot.result ? <p className="font-medium text-amber-900">{detectionMessage(slot.result.frame_detection)}</p> : null}
                  <p className="mt-1 text-sm font-semibold">
                    Coloca los puntos en las cuatro esquinas de la abertura interior de 10 × 50 cm, no sobre los marcadores ArUco.
                  </p>
                  <ol className="mt-2 grid grid-cols-2 gap-1 text-xs">
                    {CORNER_LABELS.map((label, index) => <li key={label}>{index + 1}. {label}</li>)}
                  </ol>
                  <CornerEditor
                    file={slot.file}
                    corners={slot.corners}
                    disabled={operationLocked}
                    onChange={(corners) => {
                      if (!operationLocked) updateCorners(direction, corners);
                    }}
                  />
                  {geometryError ? <p className="mt-2 text-sm text-red-700">{geometryError}</p> : null}
                  <label className="mt-3 flex gap-2 rounded bg-amber-50 p-3 text-sm text-amber-950">
                    <input
                      type="checkbox"
                      checked={slot.estimatedGeometry}
                      disabled={operationLocked}
                      onChange={(event) => setSlots((current) => ({
                        ...current,
                        [direction]: {
                          ...current[direction],
                          estimatedGeometry: event.target.checked,
                          provisionalAcknowledged: false,
                        },
                      }))}
                    />
                    Una esquina o un borde no es visible y tuve que estimar su posición.
                  </label>
                  {slot.estimatedGeometry ? (
                    <label className="mt-2 flex gap-2 rounded border border-amber-300 p-3 text-sm">
                      <input
                        type="checkbox"
                        checked={slot.provisionalAcknowledged}
                        disabled={operationLocked}
                        onChange={(event) => setSlots((current) => ({
                          ...current,
                          [direction]: {
                            ...current[direction],
                            provisionalAcknowledged: event.target.checked,
                          },
                        }))}
                      />
                      Confirmo que esta geometría es estimada, provisional y no equivale a una medición científica validada.
                    </label>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={operationLocked || Boolean(geometryError) || requiresProvisionalConfirmation}
                      className="inline-flex items-center gap-2 rounded bg-emerald-800 px-4 py-2 text-sm text-white disabled:opacity-50"
                      onClick={() => void analyzeManualArea(direction)}
                    >
                      {slot.status === "analyzing" ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Rectificando y analizando…
                        </>
                      ) : slot.status === "error"
                        ? "Corregir puntos y reintentar"
                        : "Confirmar 4 puntos y rectificar esta vista"}
                    </button>
                    <button
                      type="button"
                      disabled={operationLocked || !slot.initialCorners}
                      className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                      onClick={() => {
                        if (slot.initialCorners) updateCorners(direction, slot.initialCorners.map((point) => ({ ...point })));
                      }}
                    >
                      Restaurar puntos iniciales
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
              {slot.view && !slot.result && slot.status === "error" ? (
                <button
                  type="button"
                  disabled={operationLocked}
                  className="mt-3 rounded border border-emerald-800 px-3 py-2 text-sm font-semibold text-emerald-900 disabled:opacity-50"
                  onClick={() => void retryDetection(direction)}
                >
                  Reintentar IA con la fotografía guardada
                </button>
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
        {processing ? "Rectificando secuencialmente…" : "Rectificar y calibrar las cuatro vistas"}
      </button>

      {series ? (
        <section className="space-y-4 rounded-lg border p-5" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
          <h2 className="text-xl font-semibold">
            {summary.calibrated ? "Captura y calibración completadas" : "Captura y calibración en progreso"}
          </h2>
          <div className="grid gap-3 md:grid-cols-4">
            <div><strong className="text-2xl">{summary.validViews}/4</strong><p className="text-xs">Vistas válidas</p></div>
            <div><strong className="text-2xl">500</strong><p className="text-xs">cm² máximos por vista</p></div>
            <div><strong className="text-2xl">{summary.totalCalibratedAreaCm2.toFixed(0)}</strong><p className="text-xs">Área total calibrada cm²</p></div>
            <div><strong className="text-2xl">{summary.provisionalViews}</strong><p className="text-xs">Mediciones provisionales</p></div>
          </div>
          <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
            Esta etapa conserva originales, cuatro puntos, rectificaciones, escala física, área válida y calidad.
            La cobertura liquénica se calculará únicamente después de completar las cuatro anotaciones.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {DIRECTIONS.map((direction) => {
              const slot = slots[direction];
              return (
                <article key={direction} className="rounded border p-3" style={{ borderColor: "var(--ld-border)" }}>
                  <h3 className="font-semibold">{DIRECTION_LABELS[direction]}</h3>
                  <ResultVisual slot={slot} layer="grid" />
                  <p className="mt-2 text-sm">{slot.result?.rectified_image_data_url ? "500 cm² calibrados · 400 × 2000 px" : "Pendiente"}</p>
                  <p className="text-xs">Calidad {slot.result ? `${Math.round(slot.result.quality_score * 100)}%` : "—"}</p>
                  {slot.result?.quality_flags.length ? <p className="mt-1 text-xs">Flags: {slot.result.quality_flags.join(", ")}</p> : null}
                </article>
              );
            })}
          </div>
          <section className="rounded border p-4" style={{ borderColor: "var(--ld-border)" }}>
            <h2 className="text-lg font-semibold">Tamaño del tronco</h2>
            <label className="mt-3 block max-w-md text-sm">
              Circunferencia medida con cinta a 1.3 m (cm, opcional)
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={fieldCircumferenceCm}
                onChange={(event) => setFieldCircumferenceCm(event.target.value)}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
            <dl className="mt-4 grid gap-2 text-sm md:grid-cols-2">
              <div><dt className="font-semibold">Medición con cinta</dt><dd>{fieldCircumferenceCm ? `${fieldCircumferenceCm} cm de circunferencia` : "No registrada"}</dd></div>
              <div><dt className="font-semibold">Estimación IA</dt><dd>{trunkEstimate ? `${trunkEstimate.widthCm.toFixed(1)} cm de ancho a la altura de muestreo` : "No disponible"}</dd></div>
              <div><dt className="font-semibold">Circunferencia estimada a la altura de muestreo</dt><dd>{trunkEstimate ? `${trunkEstimate.circumferenceCm.toFixed(1)} cm` : "—"}</dd></div>
              <div><dt className="font-semibold">Rango probable</dt><dd>{trunkEstimate ? `${trunkEstimate.minCm.toFixed(1)}–${trunkEstimate.maxCm.toFixed(1)} cm` : "—"}</dd></div>
              <div><dt className="font-semibold">Confianza</dt><dd>{trunkEstimate?.confidence ?? "—"}</dd></div>
              <div><dt className="font-semibold">Vistas utilizadas</dt><dd>{trunkEstimate?.viewsUsed.join("/") || "Ninguna"}</dd></div>
            </dl>
            <p className="mt-3 text-xs">Calculado mediante fotografías y marco físico de referencia. La cinta, cuando existe, tiene prioridad y se guarda como field_tape.</p>
            {!trunkEstimate ? (
              <p className="mt-3 rounded bg-amber-50 p-3 text-sm">No fue posible estimar automáticamente el tamaño del tronco. Marca sus dos bordes en una fotografía.</p>
            ) : null}
            <button type="button" className="mt-3 rounded border px-4 py-2" onClick={() => setReviewingTrunkEdges((value) => !value)}>
              Revisar bordes
            </button>
            {reviewingTrunkEdges ? (
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                {DIRECTIONS.map((direction) => {
                  const estimate = slots[direction].result?.trunk_estimate;
                  if (!estimate) return null;
                  return (
                    <div key={direction} className="rounded border p-3 text-sm">
                      <strong>{DIRECTION_LABELS[direction]} · {estimate.width_cm.toFixed(1)} cm</strong>
                      <label className="mt-2 block">Borde izquierdo
                        <input type="range" min="0" max={estimate.right_x_normalized - 0.01} step="0.005" value={estimate.left_x_normalized} onChange={(event) => adjustTrunkEdge(direction, "left", Number(event.target.value))} className="w-full" />
                      </label>
                      <label className="mt-2 block">Borde derecho
                        <input type="range" min={estimate.left_x_normalized + 0.01} max="1" step="0.005" value={estimate.right_x_normalized} onChange={(event) => adjustTrunkEdge(direction, "right", Number(event.target.value))} className="w-full" />
                      </label>
                      <p className="mt-2 text-xs">Las líneas corregidas se combinan automáticamente.</p>
                    </div>
                  );
                })}
                <button type="button" className="rounded border px-4 py-2" onClick={() => setReviewingTrunkEdges(false)}>Confirmar bordes del tronco</button>
              </div>
            ) : null}
          </section>
          <button
            type="button"
            disabled={!summary.calibrated || operationLocked}
            onClick={() => void acceptTrunkAndContinue()}
            className="w-full rounded bg-emerald-800 px-5 py-4 font-semibold text-white disabled:opacity-50"
          >
            Continuar al análisis de líquenes
          </button>
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
                  <td className="p-2">{row.provisional
                    ? "Provisional"
                    : row.series.pending_view_count === 0 ? "Completa validable" : "Pendiente"}</td>
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

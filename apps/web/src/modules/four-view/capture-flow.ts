// Pure logic that drives the simplified four-view capture screen.
//
// Everything here is framework-free so it can be unit tested with `node --test`
// like the rest of the four-view helpers. The React workflow only renders what
// these functions decide: when a photo counts as ready, when the whole series
// may start its scientific analysis, how a failure should be explained to a
// non-technical user and whether a late response still belongs to the photo
// currently shown on screen.

import { DIRECTIONS, DIRECTION_LABELS, type Direction } from "./types";

export type SlotStatus =
  | "empty"
  | "ready"
  | "saving_original"
  | "preparing_ai"
  // The original is already stored on the server and prepared for the AI, but
  // the scientific analysis of the series has not run for it yet.
  | "stored"
  | "processing"
  | "needs_confirmation"
  | "four_points_ready"
  | "analyzing"
  | "saved"
  | "repeat"
  | "error";

export interface SlotSnapshot {
  status: SlotStatus;
  // A photograph exists for this view, either in memory or already stored.
  hasPhoto: boolean;
  // The original is persisted on the server (capture_views row + image).
  hasStoredView: boolean;
  // The view already produced a usable rectified image.
  hasResult: boolean;
}

// Statuses where a background operation is running for that view.
const BUSY_STATUSES: readonly SlotStatus[] = [
  "saving_original",
  "preparing_ai",
  "processing",
  "analyzing",
];

// Statuses that block the series: the view still needs a human decision.
const BLOCKING_STATUSES: readonly SlotStatus[] = [
  "needs_confirmation",
  "four_points_ready",
  "repeat",
  "error",
];

export function isSlotBusy(status: SlotStatus): boolean {
  return BUSY_STATUSES.includes(status);
}

// A view is "ready" for the series run when its photograph exists and is
// neither uploading nor waiting for a manual decision.
export function isSlotReady(slot: SlotSnapshot): boolean {
  if (!slot.hasPhoto) return false;
  if (isSlotBusy(slot.status)) return false;
  if (slot.status === "error" || slot.status === "repeat") return false;
  if (slot.status === "needs_confirmation" || slot.status === "four_points_ready") return false;
  return slot.status === "ready" || slot.status === "stored" || slot.status === "saved" || slot.hasResult;
}

export function readySlotCount(slots: Record<Direction, SlotSnapshot>): number {
  return DIRECTIONS.filter((direction) => isSlotReady(slots[direction])).length;
}

// Separate counters for the four things that can be true at the same time.
// A photograph that is waiting for manual calibration is still selected and
// still stored: it must never disappear from the progress summary.
export interface CaptureProgress {
  // A photograph was chosen or is already stored for that space.
  selected: number;
  // The original is persisted on the server.
  stored: number;
  // The view produced a usable rectified image.
  processed: number;
  // The view needs a human decision (calibration, repeat).
  needsReview: number;
  // The view failed and could not be completed.
  failed: number;
}

export function captureProgress(slots: Record<Direction, SlotSnapshot>): CaptureProgress {
  const snapshots = DIRECTIONS.map((direction) => slots[direction]);
  return {
    selected: snapshots.filter((slot) => slot.hasPhoto).length,
    stored: snapshots.filter((slot) => slot.hasStoredView).length,
    processed: snapshots.filter((slot) => slot.hasResult).length,
    needsReview: snapshots.filter((slot) => (
      slot.status === "needs_confirmation"
      || slot.status === "four_points_ready"
      || slot.status === "repeat"
    )).length,
    failed: snapshots.filter((slot) => slot.status === "error").length,
  };
}

// Plain, non-contradictory summary. No invented percentages or ETAs.
export function captureProgressLabel(progress: CaptureProgress): string {
  const parts = [
    `${progress.selected} de 4 fotografías seleccionadas`,
    `${progress.stored} guardadas`,
    `${progress.processed} analizadas`,
  ];
  if (progress.needsReview > 0) parts.push(`${progress.needsReview} requieren revisión`);
  if (progress.failed > 0) parts.push(`${progress.failed} no se pudieron completar`);
  return parts.join(" · ");
}

export interface SeriesReadiness {
  ready: boolean;
  readyCount: number;
  // Directions that are still not usable for the series analysis.
  missing: Direction[];
  // Short, non-technical explanation of what is missing. `null` when ready.
  reason: string | null;
}

// The series analysis may only start when the four views of the same tree and
// series are loaded and ready. Uploading or preparing a single photo never
// unlocks it, and a view waiting for manual calibration keeps it locked.
export function evaluateSeriesReadiness(slots: Record<Direction, SlotSnapshot>): SeriesReadiness {
  const missing = DIRECTIONS.filter((direction) => !isSlotReady(slots[direction]));
  const readyCount = DIRECTIONS.length - missing.length;
  if (missing.length === 0) {
    return { ready: true, readyCount, missing, reason: null };
  }
  const names = missing.map((direction) => DIRECTION_LABELS[direction]).join(", ");
  const anyBusy = missing.some((direction) => isSlotBusy(slots[direction].status));
  const anyBlocked = missing.some((direction) => BLOCKING_STATUSES.includes(slots[direction].status));
  const reason = anyBusy
    ? `Todavía se están preparando fotografías (${names}). El análisis empieza cuando las cuatro estén listas.`
    : anyBlocked
      ? `Estas vistas necesitan tu revisión antes de analizar: ${names}.`
      : `Faltan fotografías de: ${names}.`;
  return { ready: false, readyCount, missing, reason };
}

// Identity of a concrete attempt: the series plus the exact photograph shown in
// each space. Replacing any photo produces a different signature, so the new
// state can never be overwritten by a previous run.
export function seriesAttemptSignature(
  seriesKey: string,
  requestKeys: Record<Direction, string>,
): string {
  return [seriesKey, ...DIRECTIONS.map((direction) => `${direction}:${requestKeys[direction]}`)].join("|");
}

// Guards the series analysis against duplicated executions caused by double
// clicks, React effects re-running, uploads finishing at the same time,
// retries or a navigation that remounts the screen.
export class SeriesAnalysisGate {
  private running: string | null = null;
  private readonly finished = new Set<string>();

  begin(signature: string): boolean {
    if (this.running !== null || this.finished.has(signature)) return false;
    this.running = signature;
    return true;
  }

  isRunning(signature: string): boolean {
    return this.running === signature;
  }

  // Mark the attempt as finished. `succeeded` keeps it from starting again on
  // its own; a failed attempt may be retried manually with the same photos.
  finish(signature: string, succeeded: boolean): void {
    if (this.running === signature) this.running = null;
    if (succeeded) this.finished.add(signature);
  }

  // Allow an explicit manual retry of an attempt that already ran.
  allowRetry(signature: string): void {
    this.finished.delete(signature);
  }

  reset(): void {
    this.running = null;
    this.finished.clear();
  }
}

// A single gate instance shared by every mount of the capture screen. Keeping
// it outside the component means that unmounting and mounting again (a React
// remount, a client-side navigation back and forth) cannot resurrect an attempt
// that already finished. A full page reload does start a new gate: in that case
// the protection against repeating work comes from the persisted state, because
// views that are already stored are neither uploaded nor analysed again.
let shared: SeriesAnalysisGate | null = null;

export function sharedSeriesAnalysisGate(): SeriesAnalysisGate {
  if (!shared) shared = new SeriesAnalysisGate();
  return shared;
}

export interface StoredViewIdentity {
  viewId: string;
  imageId: string;
  seriesId: string;
}

export interface StoredSeriesCheck {
  ok: boolean;
  missing: Direction[];
  mismatched: Direction[];
  reason: string | null;
}

// Before any inference runs, the four originals must be stored and their
// identities must belong to the series being analysed. A single failed upload
// keeps the whole series out of the analysis phase.
export function verifyStoredSeries(
  views: Partial<Record<Direction, StoredViewIdentity | null>>,
  seriesId: string,
): StoredSeriesCheck {
  const missing = DIRECTIONS.filter((direction) => {
    const view = views[direction];
    return !view || !view.viewId || !view.imageId;
  });
  const mismatched = DIRECTIONS.filter((direction) => {
    const view = views[direction];
    return Boolean(view?.viewId) && view!.seriesId !== seriesId;
  });
  if (missing.length === 0 && mismatched.length === 0) {
    return { ok: true, missing, mismatched, reason: null };
  }
  const names = [...missing, ...mismatched].map((direction) => DIRECTION_LABELS[direction]).join(", ");
  const reason = mismatched.length > 0
    ? `Estas fotografías no pertenecen a esta serie: ${names}. No se analiza nada para no mezclar árboles.`
    : `No se pudieron guardar todas las fotografías (${names}). El análisis no empieza hasta que las cuatro estén guardadas.`;
  return { ok: false, missing, mismatched, reason };
}

export type FailureKind = "upload" | "analysis";

export interface FriendlyFailure {
  // Message shown as the main explanation, in plain Spanish.
  message: string;
  // Whether retrying the very same operation can plausibly succeed.
  retriable: boolean;
  // Raw text preserved for debugging. Never rendered as the main explanation.
  detail: string | null;
}

const PERMANENT_PATTERNS = [
  /permis/i,
  /no autorizad/i,
  /unauthorized/i,
  /forbidden/i,
  /sesión/i,
  /formato/i,
  /incompatible/i,
  /no es válid/i,
  /inválid/i,
  /invalid/i,
  /demasiado pequeñ/i,
  /cuadrilátero/i,
  /geometr/i,
];

const TRANSIENT_PATTERNS = [
  /conexión/i,
  /network/i,
  /timeout/i,
  /tiempo de espera/i,
  /no está disponible/i,
  /temporal/i,
  /503/,
  /memoria/i,
];

// Strip anything that could leak a token or a signed URL before showing or
// storing a diagnostic detail.
export function safeDiagnosticDetail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const withoutUrls = raw.replace(/https?:\/\/\S+/gi, "[enlace omitido]");
  const withoutTokens = withoutUrls.replace(/\b(token|apikey|api_key|bearer|signature|sig)=[^\s&]+/gi, "$1=[omitido]");
  const trimmed = withoutTokens.trim();
  return trimmed ? trimmed.slice(0, 300) : null;
}

// Translate whatever the services returned into an explanation the field user
// can act on, keeping the raw text only as a collapsible diagnostic detail.
export function describeFailure(kind: FailureKind, raw: string | null | undefined): FriendlyFailure {
  const text = raw ?? "";
  const permanent = PERMANENT_PATTERNS.some((pattern) => pattern.test(text));
  const transient = TRANSIENT_PATTERNS.some((pattern) => pattern.test(text));
  const retriable = permanent ? false : transient || text.length === 0 || kind === "analysis";
  const message = permanent
    ? kind === "upload"
      ? "No se pudo guardar esta fotografía y reintentar no lo resolverá. Revisa el archivo o vuelve a tomarla."
      : "Esta vista necesita una corrección antes de volver a analizarla. Reintentar sin cambios no la resolverá."
    : kind === "upload"
      ? "No se pudo terminar de subir esta fotografía. La original sigue en tu dispositivo; puedes reintentar sin volver a tomarla."
      : "La fotografía quedó guardada, pero su análisis no se completó. Puedes reintentar solo esta vista.";
  return { message, retriable, detail: safeDiagnosticDetail(raw) };
}

// A response is stale when the photograph it belongs to is no longer the one
// displayed in that space, e.g. because the user replaced the image meanwhile.
export function isStaleSlotResponse(currentRequestKey: string, responseRequestKey: string): boolean {
  return currentRequestKey !== responseRequestKey;
}

export function slotStatusLabel(slot: SlotSnapshot): string {
  switch (slot.status) {
    case "empty":
      return "Falta fotografía";
    case "ready":
      return "Lista para guardar";
    case "saving_original":
      return "Subiendo";
    case "preparing_ai":
      return "Preparando fotografía";
    case "stored":
      return "Fotografía guardada; falta analizar";
    case "processing":
    case "analyzing":
      return "Analizando";
    case "needs_confirmation":
    case "four_points_ready":
      return "Requiere revisión";
    case "saved":
      return "Completado";
    case "repeat":
      return "Requiere repetir la fotografía";
    default:
      return "No se pudo completar";
  }
}

export interface RestoredViewInput {
  // The capture_views row exists for this direction.
  hasStoredView: boolean;
  // A stored result with a usable rectified image was recovered.
  hasUsableResult: boolean;
  // The stored result asks for a new photograph.
  repeat: boolean;
  // A corner proposal was persisted and can be reviewed without re-uploading.
  hasCornerProposal: boolean;
}

// State of a space when the same series is reopened. A stored photograph is
// never presented as missing, and a view whose analysis never finished is not
// presented as a failure: it is simply pending, with one clear retry.
export function restoredSlotStatus(input: RestoredViewInput): SlotStatus {
  if (!input.hasStoredView) return "empty";
  if (input.repeat) return "repeat";
  if (input.hasUsableResult) return "saved";
  if (input.hasCornerProposal) return "four_points_ready";
  return "stored";
}

export interface ContextEntry {
  label: string;
  value: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only user-readable names reach the screen. If a name is missing we show a
// placeholder instead of the raw identifier.
export function summarizeCaptureContext(input: {
  project?: string | null;
  site?: string | null;
  event?: string | null;
  tree?: string | null;
}): ContextEntry[] {
  const readable = (value: string | null | undefined): string => {
    const text = (value ?? "").trim();
    if (!text || UUID_PATTERN.test(text)) return "Sin nombre disponible";
    return text;
  };
  return [
    { label: "Proyecto", value: readable(input.project) },
    { label: "Sitio", value: readable(input.site) },
    { label: "Jornada", value: readable(input.event) },
    { label: "Árbol", value: readable(input.tree) },
  ];
}

export interface TreeContextIds {
  projectId: string;
  siteId: string;
  eventId: string;
  treeId: string;
  treeSampleId?: string;
}

// Guard against mixing photographs or results between trees: the state loaded
// on screen must belong to exactly the tree currently selected.
export function contextMatchesTree(
  current: TreeContextIds | null,
  incoming: TreeContextIds | null,
): boolean {
  if (!current || !incoming) return false;
  if (current.projectId !== incoming.projectId) return false;
  if (current.siteId !== incoming.siteId) return false;
  if (current.eventId !== incoming.eventId) return false;
  if (current.treeId !== incoming.treeId) return false;
  if (current.treeSampleId && incoming.treeSampleId && current.treeSampleId !== incoming.treeSampleId) {
    return false;
  }
  return true;
}

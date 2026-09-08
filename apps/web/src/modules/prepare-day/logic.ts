// Pure helpers for the "Preparar jornada" and "Árboles de esta jornada" flows.
// Kept side-effect free so they can be unit-tested with node --test.

// ---------------------------------------------------------------------------
// Datetime-local helpers.
//
// Native <input type="datetime-local"> exchanges "YYYY-MM-DDTHH:mm" strings
// interpreted in the user's local timezone. We must convert both directions
// carefully:
//   1. Present a Date as a datetime-local value using LOCAL wall-clock time.
//   2. Convert a datetime-local string BACK to an ISO string that represents
//      the same instant in UTC (which is what the database stores).
// Historically we tried to subtract the timezone offset manually in step (2),
// but the JavaScript Date constructor already interprets "YYYY-MM-DDTHH:mm"
// as local time, so subtracting the offset was applied twice — the resulting
// ISO string was off by the offset (Santo Domingo saw the previous day at
// 20:30 for a 00:30 entry). The simplest correct implementation is to just
// call toISOString() on the parsed date.
// ---------------------------------------------------------------------------

export function formatLocalDatetimeInputValue(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("Fecha inválida para formatear.");
  }
  // Build the "YYYY-MM-DDTHH:mm" value from local components. Using the
  // component-based approach avoids any UTC vs local ambiguity.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Convert a "YYYY-MM-DDTHH:mm" datetime-local input value to an ISO string
// (UTC). The value is interpreted as LOCAL time — matching how the input
// itself behaves in the browser — and Date's ISO output represents the same
// instant in UTC. Any trailing seconds/milliseconds in the input are honored.
export function datetimeLocalToIsoString(localValue: string): string {
  if (typeof localValue !== "string" || localValue.trim() === "") {
    throw new Error("Fecha vacía o inválida.");
  }
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) {
    throw new Error("La fecha no se pudo interpretar.");
  }
  return date.toISOString();
}

export interface NamedRow {
  name: string;
}

export interface TreeCodeRow {
  code: string;
}

export interface EvaluationContext {
  projectId?: string;
  siteId?: string;
  eventId?: string;
  treeSampleId?: string;
}

export type TreeEvaluationStatus =
  | "sin_muestreo"
  | "sin_fotografias"
  | "fotografias_pendientes"
  | "listo_para_revisar"
  | "evaluacion_completada"
  | "requiere_repetir";

export interface TreeEvaluationInputs {
  hasSample: boolean;
  captureSeries?: {
    status?: string | null;
    validViewCount?: number | null;
    pendingViewCount?: number | null;
    confirmedAt?: string | null;
  } | null;
}

// Format a date as "YYYY-MM-DD" using the local timezone. The date input is
// what the user picked in a native date/datetime-local field, so we intentionally
// avoid UTC to prevent off-by-one-day surprises around midnight.
export function formatLocalDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("Fecha inválida para formatear.");
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Suggest a default jornada name based on the sampling date and any existing
// jornadas at the same site. Prefer the ISO date; if it collides, append a
// numeric suffix. The user can always edit the suggestion.
export function suggestSamplingEventName(date: Date, existing: readonly NamedRow[]): string {
  const base = `Jornada ${formatLocalDate(date)}`;
  const existingNames = new Set(
    existing.map((row) => row.name.trim().toLowerCase()).filter((value) => value.length > 0),
  );

  if (!existingNames.has(base.toLowerCase())) {
    return base;
  }

  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base} (${suffix})`;
    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return base;
}

// Suggest a stable next tree code such as "Árbol 001". Only suggested as a
// default; the user can override, and it is never used as an identity — the
// tree UUID is the identifier that persists across jornadas.
export function suggestTreeCode(existing: readonly TreeCodeRow[]): string {
  const pattern = /^árbol\s+(\d+)$/i;
  let maxNumber = 0;
  for (const row of existing) {
    const trimmed = row.code.trim();
    const match = pattern.exec(trimmed);
    if (match) {
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value) && value > maxNumber) {
        maxNumber = value;
      }
    }
  }
  const next = maxNumber + 1;
  return `Árbol ${String(next).padStart(3, "0")}`;
}

// Derive the visible status for a tree within a jornada from real data,
// never from the mere presence of photographs. A tree is only "completada"
// when the capture series has been confirmed by the observer.
export function deriveTreeEvaluationStatus(input: TreeEvaluationInputs): TreeEvaluationStatus {
  if (!input.hasSample) {
    return "sin_muestreo";
  }

  const series = input.captureSeries ?? null;
  if (!series) {
    return "sin_fotografias";
  }

  if (series.status === "needs_retake") {
    return "requiere_repetir";
  }

  if (series.status === "confirmed" || series.confirmedAt) {
    return "evaluacion_completada";
  }

  const valid = series.validViewCount ?? 0;
  const pending = series.pendingViewCount ?? 4;

  if (valid === 0) {
    return "sin_fotografias";
  }

  if (pending > 0 || valid < 4) {
    return "fotografias_pendientes";
  }

  return "listo_para_revisar";
}

// Human-readable label for the evaluation status (Spanish).
export function treeStatusLabel(status: TreeEvaluationStatus): string {
  switch (status) {
    case "sin_muestreo":
      return "Sin muestrear en esta jornada";
    case "sin_fotografias":
      return "Sin fotografías";
    case "fotografias_pendientes":
      return "Fotografías pendientes";
    case "listo_para_revisar":
      return "Listo para revisar";
    case "evaluacion_completada":
      return "Evaluación completada";
    case "requiere_repetir":
      return "Requiere repetir captura";
  }
}

// Build a query string that preserves the current context when the user
// navigates to capture, advanced upload, or annotations pages. Consumers
// should always append this to a URL so identifiers survive the jump.
export function buildContextQuery(ctx: EvaluationContext): string {
  const params = new URLSearchParams();
  if (ctx.projectId) params.set("projectId", ctx.projectId);
  if (ctx.siteId) params.set("siteId", ctx.siteId);
  if (ctx.eventId) params.set("eventId", ctx.eventId);
  if (ctx.treeSampleId) params.set("treeSampleId", ctx.treeSampleId);
  return params.toString();
}

// Compose a URL that preserves the context. Never emits an empty ?.
export function withPreservedContext(basePath: string, ctx: EvaluationContext): string {
  const query = buildContextQuery(ctx);
  if (!query) return basePath;
  const separator = basePath.includes("?") ? "&" : "?";
  return `${basePath}${separator}${query}`;
}

export interface PreparationSelection {
  projectId?: string;
  siteId?: string;
  eventId?: string;
}

// When the user changes the project, the previously-picked site and jornada
// are no longer valid. Same for site → jornada. This resets the incompatible
// selections without dropping the fields the user has not touched yet.
export function resetIncompatibleSelections(
  previous: PreparationSelection,
  changed: "project" | "site" | "event",
  nextValue?: string,
): PreparationSelection {
  if (changed === "project") {
    return { projectId: nextValue, siteId: undefined, eventId: undefined };
  }
  if (changed === "site") {
    return { ...previous, siteId: nextValue, eventId: undefined };
  }
  return { ...previous, eventId: nextValue };
}

export interface DraftState {
  projectId?: string;
  siteId?: string;
  eventId?: string;
}

// Merge a persisted draft (from sessionStorage) with the current selection.
// This is what lets the flow recover from a partial failure: if the project
// or site was already created but the jornada write failed, we keep those
// identifiers so the user can retry without producing duplicates.
//
// Parent-child consistency is enforced: if the caller's current selection
// contradicts the draft at some level, the draft's descendants from that
// level are dropped so we never stitch together an incoherent hierarchy
// (for example project B combined with a site that belongs to project A).
export function mergeDraftWithSelection(
  draft: DraftState | null | undefined,
  current: PreparationSelection,
): PreparationSelection {
  if (!draft) return current;

  const projectId = current.projectId ?? draft.projectId;

  // Any user-supplied projectId that differs from the draft invalidates the
  // draft's descendants because a site (and therefore an event) belongs to a
  // single project.
  const projectMismatch =
    current.projectId !== undefined
    && draft.projectId !== undefined
    && current.projectId !== draft.projectId;

  const siteId = current.siteId ?? (projectMismatch ? undefined : draft.siteId);

  // Same idea for site → event.
  const siteMismatch =
    current.siteId !== undefined
    && draft.siteId !== undefined
    && current.siteId !== draft.siteId;

  const eventId = current.eventId ?? (projectMismatch || siteMismatch ? undefined : draft.eventId);

  return { projectId, siteId, eventId };
}

// Narrow the draft to the given scope. Callers use this when the user
// changes their intent (mode change new/existing, or picking a different
// existing parent), so a stale descendant id from a previous partial-failure
// attempt is not silently reused for an incompatible parent.
export type DraftScope = "keep_all" | "drop_below_project" | "drop_below_site" | "drop_all";

export function narrowDraftScope(
  draft: DraftState | null | undefined,
  scope: DraftScope,
): DraftState | null {
  if (!draft) return null;
  switch (scope) {
    case "keep_all":
      return { ...draft };
    case "drop_below_project":
      return draft.projectId ? { projectId: draft.projectId } : null;
    case "drop_below_site":
      return draft.projectId
        ? { projectId: draft.projectId, siteId: draft.siteId }
        : null;
    case "drop_all":
      return null;
  }
}

// Given a draft plus the newly-created records for this attempt, decide which
// creation calls can be skipped on the next retry to avoid duplicate rows.
// The rule is simple: if a persisted id exists, do NOT create again — reuse.
export function planCreationsForRetry(input: {
  draft: DraftState | null | undefined;
  chosenProjectId?: string;
  chosenSiteId?: string;
  chosenEventId?: string;
}): { createProject: boolean; createSite: boolean; createEvent: boolean } {
  const projectId = input.chosenProjectId ?? input.draft?.projectId;
  const siteId = input.chosenSiteId ?? input.draft?.siteId;
  const eventId = input.chosenEventId ?? input.draft?.eventId;
  return {
    createProject: !projectId,
    createSite: !siteId,
    createEvent: !eventId,
  };
}

// ---------------------------------------------------------------------------
// Hierarchy resolution for the four-view capture screen.
//
// The four-view screen must open exactly on the tree that the user picked in
// the "Árboles de esta jornada" list. The URL carries
// `?projectId=…&siteId=…&eventId=…&treeSampleId=…`. The tree_sample id is the
// truth source; the rest are validated against the persisted hierarchy so the
// screen never silently selects a different tree.
// ---------------------------------------------------------------------------

export interface HierarchyProject { id: string }
export interface HierarchySite { id: string; projectId: string }
export interface HierarchyEvent { id: string; siteId: string }
export interface HierarchyTree { id: string; siteId: string }
export interface HierarchyTreeSample {
  id: string;
  treeId: string;
  samplingEventId: string;
  siteId: string;
}

export interface ResolvedHierarchy {
  projectId: string;
  siteId: string;
  eventId: string;
  treeId: string;
  treeSampleId: string;
}

export interface HierarchyResolutionInput {
  treeSampleId: string;
  treeSamples: readonly HierarchyTreeSample[];
  samplingEvents: readonly HierarchyEvent[];
  sites: readonly HierarchySite[];
  projects: readonly HierarchyProject[];
  trees: readonly HierarchyTree[];
}

export type HierarchyResolutionResult =
  | { ok: true; resolved: ResolvedHierarchy }
  | { ok: false; message: string };

// Pure lookup: given the fixtures, walk the sample → event → site → project
// chain and confirm the tree also belongs to the same site. Any missing link
// or cross-parent inconsistency yields an error string that the caller can
// surface to the user. This never falls back to "the first record" — an
// invalid identifier is an error, not a signal to substitute a different tree.
export function resolveHierarchyFromTreeSample(
  input: HierarchyResolutionInput,
): HierarchyResolutionResult {
  const sample = input.treeSamples.find((row) => row.id === input.treeSampleId);
  if (!sample) {
    return { ok: false, message: "No se encontró la muestra del árbol solicitada." };
  }
  const event = input.samplingEvents.find((row) => row.id === sample.samplingEventId);
  if (!event) {
    return { ok: false, message: "La muestra apunta a una jornada que no existe." };
  }
  const site = input.sites.find((row) => row.id === event.siteId);
  if (!site) {
    return { ok: false, message: "La jornada apunta a un sitio que no existe." };
  }
  const project = input.projects.find((row) => row.id === site.projectId);
  if (!project) {
    return { ok: false, message: "El sitio apunta a un proyecto que no existe." };
  }
  const tree = input.trees.find((row) => row.id === sample.treeId);
  if (!tree) {
    return { ok: false, message: "La muestra apunta a un árbol que no existe." };
  }
  if (tree.siteId !== site.id) {
    return {
      ok: false,
      message: "El árbol no pertenece al sitio de la jornada.",
    };
  }
  if (sample.siteId !== site.id) {
    return {
      ok: false,
      message: "La muestra registra un sitio distinto al de la jornada.",
    };
  }
  return {
    ok: true,
    resolved: {
      projectId: project.id,
      siteId: site.id,
      eventId: event.id,
      treeId: tree.id,
      treeSampleId: sample.id,
    },
  };
}

export interface ExpectedContextIds {
  projectId?: string;
  siteId?: string;
  eventId?: string;
}

// Ensure the caller-provided (URL) context matches the resolved hierarchy.
// If any expected id differs from the resolved one, we return a descriptive
// error so the UI can refuse to enable capture. This is the exact guardrail
// the QA feedback requested: never silently substitute another tree.
export function validateExpectedContext(
  expected: ExpectedContextIds,
  resolved: ResolvedHierarchy,
): { ok: true } | { ok: false; message: string } {
  const mismatched: string[] = [];
  if (expected.projectId && expected.projectId !== resolved.projectId) {
    mismatched.push("proyecto");
  }
  if (expected.siteId && expected.siteId !== resolved.siteId) {
    mismatched.push("sitio");
  }
  if (expected.eventId && expected.eventId !== resolved.eventId) {
    mismatched.push("jornada");
  }
  if (mismatched.length === 0) return { ok: true };
  return {
    ok: false,
    message:
      "El enlace contiene identificadores que no corresponden a la muestra ("
      + mismatched.join(", ")
      + "). Vuelve a \"Árboles de esta jornada\" y abre el árbol de nuevo.",
  };
}

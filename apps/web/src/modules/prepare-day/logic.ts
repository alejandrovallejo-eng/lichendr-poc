// Pure helpers for the "Preparar jornada" and "Árboles de esta jornada" flows.
// Kept side-effect free so they can be unit-tested with node --test.

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
export function mergeDraftWithSelection(
  draft: DraftState | null | undefined,
  current: PreparationSelection,
): PreparationSelection {
  if (!draft) return current;
  return {
    projectId: current.projectId ?? draft.projectId,
    siteId: current.siteId ?? draft.siteId,
    eventId: current.eventId ?? draft.eventId,
  };
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

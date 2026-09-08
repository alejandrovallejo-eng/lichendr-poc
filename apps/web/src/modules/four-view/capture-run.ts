// Orchestration of one run of the four-view series.
//
// The rule this module enforces is the one the field protocol needs: the four
// originals of the same tree and series are stored and prepared FIRST, and only
// when the four stored identities are verified does any inference start. A
// single failed upload keeps the whole series out of the analysis phase.
//
// Every service is injected, so the ordering, the staleness checks and the
// context checks can be tested with simulated services, without a browser,
// without Supabase and without the vision model.

import {
  verifyStoredSeries,
  type SlotStatus,
  type StoredViewIdentity,
} from "./capture-flow";
import { DIRECTIONS, type Direction } from "./types";

export interface RunSlot<TFile> {
  file: TFile | null;
  view: StoredViewIdentity | null;
  requestKey: string;
  status: SlotStatus;
  // A usable result is already stored for this view.
  analyzed: boolean;
}

export interface RunContext {
  treeSampleId: string;
  seriesId: string;
}

// Outcome of analysing a single view, decided by the caller because it owns the
// scientific interpretation of the result.
export type AnalyzedOutcome = "usable" | "needs_review" | "failed";

export interface SeriesRunServices<TFile> {
  // Resolves the tree sample and the capture series without duplicating rows.
  ensureContext(): Promise<RunContext>;
  // Uploads the original and registers the capture view (idempotent by
  // `requestKey` in the existing client).
  storeView(direction: Direction, slot: RunSlot<TFile>, context: RunContext): Promise<StoredViewIdentity>;
  // Builds the private analysis proxy for the stored original.
  prepareView(direction: Direction, view: StoredViewIdentity, context: RunContext): Promise<void>;
  // Runs the inference for one stored view and applies its result. Returns how
  // the caller classified that result.
  analyzeView(direction: Direction, view: StoredViewIdentity, context: RunContext): Promise<AnalyzedOutcome>;
  // Recomputes the series status once the analysis phase is over.
  finalize(context: RunContext): Promise<void>;
}

export interface SeriesRunCallbacks {
  // Applies a status change to the space, ignoring it when the photograph shown
  // there is no longer the one this run is working with.
  onSlotStatus(direction: Direction, requestKey: string, status: SlotStatus, error?: string | null): void;
  onStoredView(direction: Direction, requestKey: string, view: StoredViewIdentity): void;
  // False when the user replaced the photograph of that space meanwhile.
  isCurrentRequest(direction: Direction, requestKey: string): boolean;
  // False when the selected tree, jornada or series changed meanwhile.
  isCurrentContext(context: RunContext | null): boolean;
  onError(message: string): void;
}

export interface SeriesRunResult {
  // The four originals are stored and verified.
  uploadsCompleted: boolean;
  // The analysis phase ran (it may still have produced views needing review).
  analysisStarted: boolean;
  // Directions whose original was (re)prepared for the AI in this run.
  prepared: Direction[];
  // Directions whose inference produced a usable result in this run.
  analyzed: Direction[];
  // Directions whose upload failed in this run.
  uploadFailures: Direction[];
  // True when the run finished without aborting.
  completed: boolean;
  reason: string | null;
}

const EMPTY_RESULT = (): SeriesRunResult => ({
  uploadsCompleted: false,
  analysisStarted: false,
  prepared: [],
  analyzed: [],
  uploadFailures: [],
  completed: false,
  reason: null,
});

function failureMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

interface PreflightOutcome {
  // Set when the run must stop without touching the analysis phase.
  aborted: boolean;
  context: RunContext | null;
  stored: Partial<Record<Direction, StoredViewIdentity | null>>;
}

// Common preflight for every inference path, including the per-view retry: the
// four originals of this series are stored and their private analysis proxies
// revalidated (idempotent, never re-uploading a stored original) before a single
// inference is allowed to start.
async function runSeriesPreflight<TFile>(
  slots: Record<Direction, RunSlot<TFile>>,
  services: SeriesRunServices<TFile>,
  callbacks: SeriesRunCallbacks,
  outcome: SeriesRunResult,
): Promise<PreflightOutcome> {
  const stored: Partial<Record<Direction, StoredViewIdentity | null>> = {};
  let context: RunContext;
  try {
    context = await services.ensureContext();
  } catch (reason) {
    outcome.reason = failureMessage(reason, "No se pudo abrir la serie de este árbol.");
    callbacks.onError(outcome.reason);
    return { aborted: true, context: null, stored };
  }
  // A navigation or a tree change while the series was being opened must not
  // write anything into the newly selected context.
  if (!callbacks.isCurrentContext(context)) {
    outcome.reason = "El contexto cambió antes de empezar; no se guardó nada de este árbol.";
    return { aborted: true, context: null, stored };
  }

  // Store and prepare the four originals. Serial on purpose: the originals are
  // large and the preparation is memory bound.
  //
  // A view whose original is already stored still goes through the preparation
  // step: the derived proxy may never have been built (a previous attempt could
  // have failed exactly there), and the endpoint is idempotent, so revalidating
  // it costs nothing and never re-uploads the original.
  for (const direction of DIRECTIONS) {
    const slot = slots[direction];
    if (!slot.view && !slot.file) {
      stored[direction] = null;
      continue;
    }
    try {
      let view = slot.view;
      if (!view) {
        callbacks.onSlotStatus(direction, slot.requestKey, "saving_original", null);
        view = await services.storeView(direction, slot, context);
        if (!callbacks.isCurrentContext(context)) {
          outcome.reason = "El contexto cambió mientras se guardaban las fotografías.";
          return { aborted: true, context: null, stored };
        }
        if (!callbacks.isCurrentRequest(direction, slot.requestKey)) {
          stored[direction] = null;
          continue;
        }
        callbacks.onStoredView(direction, slot.requestKey, view);
      }
      // Views that already produced a usable result need no new proxy.
      if (slot.analyzed) {
        stored[direction] = view;
        continue;
      }
      callbacks.onSlotStatus(direction, slot.requestKey, "preparing_ai", null);
      await services.prepareView(direction, view, context);
      if (!callbacks.isCurrentContext(context)) {
        outcome.reason = "El contexto cambió mientras se preparaban las fotografías.";
        return { aborted: true, context: null, stored };
      }
      if (!callbacks.isCurrentRequest(direction, slot.requestKey)) {
        stored[direction] = null;
        continue;
      }
      stored[direction] = view;
      outcome.prepared.push(direction);
      callbacks.onSlotStatus(direction, slot.requestKey, "stored", null);
    } catch (reason) {
      // The original is kept: only the preparation or the upload failed, and
      // the next attempt revalidates it without asking for a new photograph.
      stored[direction] = null;
      outcome.uploadFailures.push(direction);
      // A rejection caused by leaving this tree also aborts the run.
      if (!callbacks.isCurrentContext(context)) {
        outcome.reason = "El contexto cambió mientras se guardaban las fotografías.";
        return { aborted: true, context: null, stored };
      }
      if (callbacks.isCurrentRequest(direction, slot.requestKey)) {
        callbacks.onSlotStatus(
          direction,
          slot.requestKey,
          "error",
          failureMessage(reason, "No se pudo guardar ni preparar esta fotografía."),
        );
      }
    }
  }

  const check = verifyStoredSeries(stored, context.seriesId);
  if (!check.ok) {
    outcome.reason = check.reason;
    callbacks.onError(check.reason ?? "Faltan fotografías guardadas para analizar la serie.");
    return { aborted: true, context: null, stored };
  }
  outcome.uploadsCompleted = true;
  if (!callbacks.isCurrentContext(context)) {
    outcome.reason = "El contexto cambió antes del análisis; no se analizó nada.";
    return { aborted: true, context: null, stored };
  }
  return { aborted: false, context, stored };
}

// Runs the inference of the given directions, serially, and recomputes the
// series summary. Returns false when the run was aborted by a context change.
async function runAnalysisPhase<TFile>(
  targets: Direction[],
  slots: Record<Direction, RunSlot<TFile>>,
  stored: Partial<Record<Direction, StoredViewIdentity | null>>,
  context: RunContext,
  services: SeriesRunServices<TFile>,
  callbacks: SeriesRunCallbacks,
  outcome: SeriesRunResult,
): Promise<void> {
  outcome.analysisStarted = true;
  const abortReason = "El contexto cambió durante el análisis; no se analizaron las vistas restantes.";
  for (const direction of targets) {
    const slot = slots[direction];
    const view = stored[direction]!;
    // A context change aborts the whole run: no further call is issued.
    if (!callbacks.isCurrentContext(context)) {
      outcome.reason = abortReason;
      return;
    }
    if (!callbacks.isCurrentRequest(direction, slot.requestKey)) continue;
    callbacks.onSlotStatus(direction, slot.requestKey, "processing", null);
    try {
      const result = await services.analyzeView(direction, view, context);
      if (!callbacks.isCurrentContext(context)) {
        outcome.reason = abortReason;
        return;
      }
      if (!callbacks.isCurrentRequest(direction, slot.requestKey)) continue;
      if (result === "usable") outcome.analyzed.push(direction);
    } catch (reason) {
      if (!callbacks.isCurrentContext(context)) {
        outcome.reason = abortReason;
        return;
      }
      if (!callbacks.isCurrentRequest(direction, slot.requestKey)) continue;
      callbacks.onSlotStatus(
        direction,
        slot.requestKey,
        "error",
        failureMessage(reason, "No se pudo analizar esta vista."),
      );
    }
  }

  if (!callbacks.isCurrentContext(context)) {
    outcome.reason = "El contexto cambió durante el análisis.";
    return;
  }
  try {
    await services.finalize(context);
  } catch (reason) {
    outcome.reason = failureMessage(reason, "El análisis terminó, pero no se pudo actualizar el resumen de la serie.");
    callbacks.onError(outcome.reason);
    return;
  }
  outcome.completed = true;
}

export async function runSeriesCapture<TFile>(
  slots: Record<Direction, RunSlot<TFile>>,
  services: SeriesRunServices<TFile>,
  callbacks: SeriesRunCallbacks,
): Promise<SeriesRunResult> {
  const outcome = EMPTY_RESULT();
  const preflight = await runSeriesPreflight(slots, services, callbacks, outcome);
  if (preflight.aborted || !preflight.context) return outcome;
  const targets = DIRECTIONS.filter((direction) => !slots[direction].analyzed);
  await runAnalysisPhase(
    targets,
    slots,
    preflight.stored,
    preflight.context,
    services,
    callbacks,
    outcome,
  );
  return outcome;
}

// Per-view retry. It goes through exactly the same preflight as the full run —
// the four identities and proxies of this series must be valid — but analyses
// only the chosen view, so a valid result or crop proposal of another view is
// never recomputed and no stored original is uploaded again.
export async function runSingleViewRetry<TFile>(
  direction: Direction,
  slots: Record<Direction, RunSlot<TFile>>,
  services: SeriesRunServices<TFile>,
  callbacks: SeriesRunCallbacks,
): Promise<SeriesRunResult> {
  const outcome = EMPTY_RESULT();
  // The chosen view is always re-prepared and re-analysed, even if it already
  // had a result: that is exactly what the user asked for.
  const target: Record<Direction, RunSlot<TFile>> = {
    ...slots,
    [direction]: { ...slots[direction], analyzed: false },
  };
  const preflight = await runSeriesPreflight(target, services, callbacks, outcome);
  if (preflight.aborted || !preflight.context) return outcome;
  await runAnalysisPhase(
    [direction],
    target,
    preflight.stored,
    preflight.context,
    services,
    callbacks,
    outcome,
  );
  return outcome;
}

"use client";

// High-level orchestration for the "Preparar jornada" screen. Everything here
// is a thin wrapper around the existing project/site/sampling-event clients:
// we only add the logic needed to keep the three sections consistent and to
// recover from partial failures without duplicating rows.

import { createProject } from "@/modules/projects/client";
import { createSite } from "@/modules/sites/client";
import { createSamplingEvent } from "@/modules/sampling-events/client";
import { fetchTreeSamplesByEvent, fetchTreesBySite } from "@/modules/trees/client";
import type { Database } from "@/types/supabase";
import { supabase } from "@/lib/supabase/client";
import { ensureAnonymousSession } from "@/modules/auth/client";
import type { SamplingEvent, Site, Tree, TreeSample } from "@/types/domain";
import type {
  ExpectedContextIds,
  ResolvedHierarchy,
  TreeEvaluationStatus,
} from "./logic";
import {
  deriveTreeEvaluationStatus,
  resolveHierarchyFromTreeSample,
  validateExpectedContext,
} from "./logic";

export interface PrepareDayInput {
  project:
    | { mode: "existing"; id: string }
    | { mode: "new"; name: string; description?: string };
  site:
    | { mode: "existing"; id: string }
    | {
        mode: "new";
        name: string;
        description?: string;
        province?: string;
        municipality?: string;
        latitude?: number;
        longitude?: number;
        gpsAccuracyM?: number;
        locationSource?: "unknown" | "manual" | "gps";
        radiusM?: number;
        notes?: string;
      };
  event:
    | { mode: "existing"; id: string }
    | {
        mode: "new";
        name: string;
        sampledAt: string; // ISO datetime
        observerNames?: string;
        notes?: string;
      };
  // Identifiers already persisted from a previous partial attempt. When set,
  // we do NOT create the corresponding row again; we reuse it. This keeps
  // the operation idempotent under double clicks, retries and partial failures.
  draft?: {
    projectId?: string;
    siteId?: string;
    eventId?: string;
  };
}

export interface PrepareDayPartialFailure {
  step: "project" | "site" | "event";
  message: string;
  // Whatever was already created before the step that failed. Callers should
  // persist this to sessionStorage so the retry can skip these steps.
  persisted: {
    projectId?: string;
    siteId?: string;
    eventId?: string;
  };
}

export type PrepareDayResult =
  | {
      ok: true;
      projectId: string;
      siteId: string;
      eventId: string;
    }
  | {
      ok: false;
      failure: PrepareDayPartialFailure;
    };

// Orchestrate the create-or-select flow for the three sections. If a step
// fails we return the identifiers that were already created so the caller can
// retry without duplicates. This function is intentionally strictly ordered:
// the site depends on the project, the jornada depends on the site.
//
// Precedence when the user changes their mind between attempts: an explicit
// `mode: "existing"` selection always wins over a `draft` identifier that came
// from a previous partial failure. This prevents a stale draft (e.g. from a
// crashed create-new attempt) from silently overriding a fresh pick.
export async function preparaJornada(input: PrepareDayInput): Promise<PrepareDayResult> {
  const persisted: PrepareDayPartialFailure["persisted"] = { ...input.draft };

  // If the user explicitly picked an existing entity, that pick always wins
  // over the draft. This also invalidates any descendants that belonged to a
  // different parent — the draft site/event would be nonsense against a
  // different project.
  if (input.project.mode === "existing") {
    if (persisted.projectId && persisted.projectId !== input.project.id) {
      persisted.siteId = undefined;
      persisted.eventId = undefined;
    }
    persisted.projectId = input.project.id;
  }
  if (input.site.mode === "existing") {
    if (persisted.siteId && persisted.siteId !== input.site.id) {
      persisted.eventId = undefined;
    }
    persisted.siteId = input.site.id;
  }
  if (input.event.mode === "existing") {
    persisted.eventId = input.event.id;
  }

  // ---- Project ----
  let projectId = persisted.projectId;
  if (!projectId) {
    if (input.project.mode === "existing") {
      projectId = input.project.id;
    } else {
      const { project, error } = await createProject(input.project.name, input.project.description);
      if (error || !project) {
        return {
          ok: false,
          failure: {
            step: "project",
            message: error ?? "No se pudo crear el proyecto.",
            persisted,
          },
        };
      }
      projectId = project.id;
    }
  }
  persisted.projectId = projectId;

  // ---- Site ----
  let siteId = persisted.siteId;
  if (!siteId) {
    if (input.site.mode === "existing") {
      siteId = input.site.id;
    } else {
      const { site, error } = await createSite({
        projectId,
        name: input.site.name,
        description: input.site.description,
        province: input.site.province,
        municipality: input.site.municipality,
        latitude: input.site.latitude,
        longitude: input.site.longitude,
        gpsAccuracyM: input.site.gpsAccuracyM,
        locationSource: input.site.locationSource,
        radiusM: input.site.radiusM,
        notes: input.site.notes,
      });
      if (error || !site) {
        return {
          ok: false,
          failure: {
            step: "site",
            message: error ?? "No se pudo crear el sitio.",
            persisted,
          },
        };
      }
      siteId = site.id;
    }
  }
  persisted.siteId = siteId;

  // ---- Sampling event ("jornada") ----
  let eventId = persisted.eventId;
  if (!eventId) {
    if (input.event.mode === "existing") {
      eventId = input.event.id;
    } else {
      const { samplingEvent, error } = await createSamplingEvent({
        siteId,
        name: input.event.name,
        sampledAt: input.event.sampledAt,
        observerNames: input.event.observerNames,
        notes: input.event.notes,
      });
      if (error || !samplingEvent) {
        return {
          ok: false,
          failure: {
            step: "event",
            message: error ?? "No se pudo crear la jornada.",
            persisted,
          },
        };
      }
      eventId = samplingEvent.id;
    }
  }
  persisted.eventId = eventId;

  return { ok: true, projectId, siteId: siteId!, eventId: eventId! };
}

export interface JornadaContext {
  project: { id: string; name: string; description: string | null };
  site: { id: string; name: string; province: string | null; municipality: string | null };
  event: SamplingEvent;
}

// Load the full context (project → site → jornada) from just an eventId.
// Used by the "Árboles de esta jornada" screen so the user always sees where
// they are working.
export async function fetchJornadaContext(eventId: string): Promise<JornadaContext | null> {
  const { error: authError } = await ensureAnonymousSession();
  if (authError) throw new Error(authError);

  const { data: eventRow, error: eventError } = await supabase
    .from("sampling_events")
    .select(
      "id, site_id, name, sampled_at, observer_names, weather_notes, protocol_version, status, notes, created_at, updated_at",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) throw new Error(eventError.message);
  if (!eventRow) return null;

  const { data: siteRow, error: siteError } = await supabase
    .from("sites")
    .select("id, project_id, name, province, municipality")
    .eq("id", eventRow.site_id)
    .maybeSingle();

  if (siteError) throw new Error(siteError.message);
  if (!siteRow) return null;

  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("id, name, description")
    .eq("id", siteRow.project_id)
    .maybeSingle();

  if (projectError) throw new Error(projectError.message);
  if (!projectRow) return null;

  return {
    project: { id: projectRow.id, name: projectRow.name, description: projectRow.description },
    site: {
      id: siteRow.id,
      name: siteRow.name,
      province: siteRow.province,
      municipality: siteRow.municipality,
    },
    event: {
      id: eventRow.id,
      siteId: eventRow.site_id,
      name: eventRow.name,
      sampledAt: eventRow.sampled_at,
      observerNames: eventRow.observer_names ?? undefined,
      weatherNotes: eventRow.weather_notes ?? undefined,
      protocolVersion: eventRow.protocol_version,
      status: eventRow.status as SamplingEvent["status"],
      notes: eventRow.notes ?? undefined,
      createdAt: eventRow.created_at,
      updatedAt: eventRow.updated_at,
    },
  };
}

export interface JornadaTreeRow {
  tree: Tree;
  sample: TreeSample | null;
  status: TreeEvaluationStatus;
  captureSeriesId: string | null;
}

type CaptureSeriesRow = Database["public"]["Tables"]["capture_series"]["Row"];

// Fetch the trees that belong to the jornada's site plus the derived status
// for each one. A tree is included when it has a sample in this event OR when
// it exists at the site and is available for evaluation. Only trees WITH a
// sample in this event are marked as part of the jornada.
export async function fetchJornadaTreesWithStatus(
  siteId: string,
  eventId: string,
): Promise<JornadaTreeRow[]> {
  const [{ trees, error: treesError }, { treeSamples, error: samplesError }] = await Promise.all([
    fetchTreesBySite(siteId),
    fetchTreeSamplesByEvent(eventId),
  ]);
  if (treesError) throw new Error(treesError);
  if (samplesError) throw new Error(samplesError);

  const samplesByTreeId = new Map<string, TreeSample>();
  for (const sample of treeSamples) {
    samplesByTreeId.set(sample.treeId, sample);
  }

  let capturesByTreeSampleId = new Map<string, CaptureSeriesRow>();
  if (treeSamples.length > 0) {
    const { data: captures, error: captureError } = await supabase
      .from("capture_series")
      .select("*")
      .in(
        "tree_sample_id",
        treeSamples.map((sample) => sample.id),
      );
    if (captureError) throw new Error(captureError.message);
    // If there is more than one capture series per tree sample (defensive),
    // keep the latest updated_at so we surface the freshest state.
    for (const row of captures ?? []) {
      const existing = capturesByTreeSampleId.get(row.tree_sample_id);
      if (!existing || (row.updated_at ?? "") > (existing.updated_at ?? "")) {
        capturesByTreeSampleId.set(row.tree_sample_id, row);
      }
    }
  } else {
    capturesByTreeSampleId = new Map();
  }

  return trees.map<JornadaTreeRow>((tree) => {
    const sample = samplesByTreeId.get(tree.id) ?? null;
    const captureSeries = sample ? capturesByTreeSampleId.get(sample.id) ?? null : null;
    const status = deriveTreeEvaluationStatus({
      hasSample: sample != null,
      captureSeries: captureSeries
        ? {
            status: captureSeries.status,
            validViewCount: captureSeries.valid_view_count,
            pendingViewCount: captureSeries.pending_view_count,
            confirmedAt: captureSeries.confirmed_at,
          }
        : null,
    });
    return {
      tree,
      sample,
      status,
      captureSeriesId: captureSeries?.id ?? null,
    };
  });
}

export type { Site };

// -----------------------------------------------------------------------------
// Context resolution for the "Captura 4 vistas" / "Carga avanzada" / "Anotaciones"
// entry points.
// -----------------------------------------------------------------------------

export interface FourViewContextResolution {
  ok: boolean;
  // Populated when the tree sample and its ancestry all exist AND, if the URL
  // provided expected identifiers, the ancestry matches those. The caller can
  // use this to preselect all four dropdowns instead of falling back to the
  // first record on the site.
  resolved?: ResolvedHierarchy;
  // Human-readable message describing why we could not resolve. Presented to
  // the user so they never see a silent tree swap.
  message?: string;
}

// Resolve a treeSampleId to its full project → site → sampling event → tree
// hierarchy. This is what the four-view / advanced-load / annotations screens
// call on mount so they preselect the tree the user actually clicked on
// instead of the first row in the loaded list.
//
// The function is defensive: it validates that the ancestry is internally
// consistent (tree.site_id must match the sample's site) and, if the caller
// passed expected identifiers from the URL, it also validates that each level
// matches. If either check fails we return `ok: false` with a message; the
// caller must NOT silently swap in a different tree.
export async function resolveFourViewContext(
  treeSampleId: string,
  expected: ExpectedContextIds = {},
): Promise<FourViewContextResolution> {
  if (!treeSampleId) {
    return { ok: false, message: "No se proporcionó un identificador de muestra." };
  }

  const { error: authError } = await ensureAnonymousSession();
  if (authError) {
    return { ok: false, message: authError };
  }

  const { data: sampleRow, error: sampleError } = await supabase
    .from("tree_samples")
    .select("id, tree_id, sampling_event_id, site_id")
    .eq("id", treeSampleId)
    .maybeSingle();
  if (sampleError) {
    return { ok: false, message: sampleError.message };
  }
  if (!sampleRow) {
    return {
      ok: false,
      message:
        "La muestra referenciada no existe o no es accesible. Vuelve a la jornada y abre el árbol de nuevo.",
    };
  }

  const [
    { data: eventRow, error: eventError },
    { data: siteRow, error: siteError },
    { data: treeRow, error: treeError },
  ] = await Promise.all([
    supabase
      .from("sampling_events")
      .select("id, site_id, name, sampled_at")
      .eq("id", sampleRow.sampling_event_id)
      .maybeSingle(),
    supabase
      .from("sites")
      .select("id, project_id, name")
      .eq("id", sampleRow.site_id)
      .maybeSingle(),
    supabase
      .from("trees")
      .select("id, site_id, code")
      .eq("id", sampleRow.tree_id)
      .maybeSingle(),
  ]);

  if (eventError) return { ok: false, message: eventError.message };
  if (siteError) return { ok: false, message: siteError.message };
  if (treeError) return { ok: false, message: treeError.message };
  if (!eventRow || !siteRow || !treeRow) {
    return {
      ok: false,
      message:
        "No se pudo reconstruir la jerarquía completa de la muestra. Falta el sitio, la jornada o el árbol.",
    };
  }

  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", siteRow.project_id)
    .maybeSingle();
  if (projectError) return { ok: false, message: projectError.message };
  if (!projectRow) {
    return { ok: false, message: "El proyecto asociado a la muestra no está disponible." };
  }

  const resolution = resolveHierarchyFromTreeSample({
    treeSampleId,
    treeSamples: [
      {
        id: sampleRow.id,
        treeId: sampleRow.tree_id,
        samplingEventId: sampleRow.sampling_event_id,
        siteId: sampleRow.site_id,
      },
    ],
    samplingEvents: [
      {
        id: eventRow.id,
        siteId: eventRow.site_id,
      },
    ],
    sites: [{ id: siteRow.id, projectId: siteRow.project_id }],
    projects: [{ id: projectRow.id }],
    trees: [{ id: treeRow.id, siteId: treeRow.site_id }],
  });

  if (!resolution.ok) {
    return { ok: false, message: resolution.message };
  }

  const validation = validateExpectedContext(expected, resolution.resolved);
  if (!validation.ok) {
    return {
      ok: false,
      resolved: resolution.resolved,
      message:
        validation.message ??
        "La jerarquía cargada no coincide con la referenciada en el enlace.",
    };
  }

  return { ok: true, resolved: resolution.resolved };
}

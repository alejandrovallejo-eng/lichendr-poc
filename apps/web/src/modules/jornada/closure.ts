import type { GuidedTreeResult } from "../four-view/guided-results";
import { DIRECTIONS } from "../four-view/types";

export interface ClosureEvent {
  id: string; site_id: string; name: string; status: "draft" | "completed"; updated_at: string;
}
export interface ClosureSnapshot { event: ClosureEvent; rows: GuidedTreeResult[] }

export function closureSummary(rows: GuidedTreeResult[]) {
  const states = rows.flatMap(row => DIRECTIONS.map(d => row.views[d].state));
  const saved = states.filter(s => s === "saved").length;
  return { trees: new Set(rows.map(r => r.tree.id)).size,
    complete: rows.filter(r => DIRECTIONS.every(d => r.views[d].state === "saved")).length,
    saved, total: states.length, pending: states.length - saved,
    missing: states.filter(s => s === "missing").length,
    unsaved: states.filter(s => s === "pending").length,
    invalid: states.filter(s => s === "invalid").length };
}

// A read error, filtered-out sample or wrong hierarchy must never look complete.
export function validateClosureSnapshot(snapshot: ClosureSnapshot, sampleIds: string[]) {
  const { event, rows } = snapshot;
  if (!event.id || !event.updated_at || !["draft", "completed"].includes(event.status)
    || rows.length !== sampleIds.length || new Set(sampleIds).size !== sampleIds.length
    || new Set(rows.map(r => r.sampleId)).size !== rows.length
    || new Set(rows.map(r => r.tree.id)).size !== rows.length
    || rows.some(r => !sampleIds.includes(r.sampleId) || r.event.id !== event.id
      || r.site.id !== event.site_id || r.tree.site_id !== event.site_id
      || r.event.site_id !== event.site_id || r.project.id !== r.site.project_id)) {
    throw new Error("No se pudo verificar toda la jornada. Actualiza la revisión antes de continuar.");
  }
  return snapshot;
}

// Includes image identity and saved result, not just the count of saved views.
export function closureFingerprint(snapshot: ClosureSnapshot) {
  return JSON.stringify([snapshot.event, [...snapshot.rows].sort((a, b) => a.sampleId.localeCompare(b.sampleId))
    .map(row => [row.sampleId, row.tree.id, row.tree.code, DIRECTIONS.map(d => row.views[d])])]);
}

export function closureBlock(snapshot: ClosureSnapshot, acknowledged: boolean): string | null {
  const summary = closureSummary(snapshot.rows);
  if (!summary.trees) return "Añade al menos un árbol antes de cerrar la jornada.";
  if (summary.pending && !acknowledged) return "Confirma que quieres cerrar con las vistas pendientes indicadas.";
  return null;
}

"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadGuidedResults, readResultPages } from "../four-view/guided-results-client";
import { closureBlock, closureFingerprint, validateClosureSnapshot, type ClosureEvent, type ClosureSnapshot } from "./closure";

export async function readClosure(db: SupabaseClient, eventId: string): Promise<ClosureSnapshot> {
  // Require the current session; never create a new anonymous owner during closure.
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) throw new Error("No se pudo recuperar tu sesión. Vuelve a abrir la jornada con la misma cuenta o navegador.");
  const { data: event, error } = await db.from("sampling_events")
    .select("id,site_id,name,status,updated_at").eq("id", eventId).maybeSingle();
  if (error || !event) throw new Error("No se pudo leer esta jornada. No se ha cambiado su estado.");
  const [rows, samples] = await Promise.all([
    loadGuidedResults(db, eventId),
    readResultPages<{ id: string }>((from, to) => db.from("tree_samples").select("id")
      .eq("sampling_event_id", eventId).order("id").range(from, to)),
  ]);
  return validateClosureSnapshot({ event: event as ClosureEvent, rows }, samples.map(s => s.id));
}

export type ClosureChange = { changed: boolean; snapshot: ClosureSnapshot };
export async function changeClosure(db: SupabaseClient, expected: ClosureSnapshot,
  target: ClosureEvent["status"], acknowledged: boolean,
  read = readClosure): Promise<ClosureChange> {
  if (target !== "draft" && target !== "completed") throw new Error("Estado de jornada no válido.");
  // Reread before every action, including retry. Never trust stale UI completeness.
  const fresh = await read(db, expected.event.id);
  if (closureFingerprint(fresh) !== closureFingerprint(expected)) return { changed: false, snapshot: fresh };
  if (target === fresh.event.status) return { changed: false, snapshot: fresh };
  const block = target === "completed" ? closureBlock(fresh, acknowledged) : null;
  if (block) throw new Error(block);
  const { data, error } = await db.from("sampling_events").update({ status: target })
    .eq("id", fresh.event.id).eq("site_id", fresh.event.site_id)
    .eq("status", fresh.event.status).eq("updated_at", fresh.event.updated_at)
    .select("id,site_id,name,status,updated_at").maybeSingle();
  if (error || !data || data.status !== target) {
    throw new Error("No se pudo confirmar el cambio. Actualiza la revisión para comprobar el estado antes de volver a intentarlo.");
  }
  // Owner RLS applies; this writes ONLY status, not captures, masks or metrics.
  // Administrative closure is not an immutable snapshot or an edit lock.
  return { changed: true, snapshot: { ...fresh, event: data as ClosureEvent } };
}

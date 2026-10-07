"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase/client";
type Share = { project_id: string; projects: { name: string } };
export default function ReviewAccess({ ownerId }: { ownerId: string }) {
  const [shares, setShares] = useState<Share[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      const db = supabase as SupabaseClient;
      const { data, error: failed } = await db.from("project_review_access").select("project_id,projects(name)").eq("created_by", ownerId).neq("reviewer_id", ownerId);
      if (!active) return;
      // Older databases have no sharing table; keep the account usable until
      // the migration is installed instead of pretending there are shares.
      if (failed) { setError("No se pudo consultar el acceso compartido. Reintenta la página antes de cambiar permisos."); return; }
      setShares((data ?? []) as unknown as Share[]);
    })();
    return () => { active = false; };
  }, [ownerId]);
  async function revoke(id: string) {
    setBusy(id); setError("");
    const db = supabase as SupabaseClient;
    const { data, error: failed } = await db.from("project_review_access").delete().eq("project_id", id).eq("created_by", ownerId).select("project_id");
    if (failed || !data?.length) setError("No se pudo retirar el acceso. Actualiza esta página y reintenta.");
    else setShares(rows => rows.filter(r => r.project_id !== id));
    setBusy("");
  }
  return <section className="rounded-2xl border p-5 space-y-3"><h2 className="font-semibold">Acceso de revisión del administrador</h2><p className="text-sm">Solo los proyectos creados como espacios compartidos permiten al administrador consultar tus cargas. Puedes retirar ese acceso sin borrar tu trabajo.</p>{error ? <p role="alert">{error}</p> : null}{shares.length ? <ul className="space-y-3">{shares.map(s => <li key={s.project_id} className="flex justify-between items-center gap-3"><span>{s.projects?.name ?? "Espacio compartido"}</span><button disabled={Boolean(busy)} className="ld-button ld-button-outline" onClick={() => void revoke(s.project_id)}>Retirar acceso</button></li>)}</ul> : !error ? <p className="text-sm">No compartes ningún proyecto para revisión.</p> : null}</section>;
}

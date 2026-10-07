"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { DIRECTIONS, DIRECTION_LABELS } from "../four-view/types";
import { listReviewProjects, readReviewProject, type ReviewProject } from "./client";
import OriginalPhoto from "./OriginalPhoto";

const TreeSummary = dynamic(() => import("../four-view/TreeSummary").then(module => module.TreeSummary), { ssr: false });
const noEdit = () => {};
export default function ReviewDashboard() {
  const [projects, setProjects] = useState<ReviewProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof readReviewProject>> | null>(null);
  const [sampleId, setSampleId] = useState("");
  const [photoId, setPhotoId] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { supabase } = await import("../../lib/supabase/client");
        const auth = await supabase.auth.getUser();
        if (!active) return;
        const google = auth.data.user && !auth.data.user.is_anonymous && auth.data.user.identities?.some(i => i.provider === "google");
        setConnected(Boolean(google));
        if (!google) { setProjects([]); return; }
        const list = await listReviewProjects(supabase);
        if (active) { setProjects(list); setError(""); }
      } catch (e) { if (active) { setProjects([]); setError(e instanceof Error ? e.message : "No se pudieron consultar los espacios."); } }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    let active = true;
    if (!projectId) return;
    void (async () => {
      try {
        const { supabase } = await import("../../lib/supabase/client");
        const loaded = await readReviewProject(supabase, projectId);
        if (active) { setResult(loaded); setSampleId(loaded.rows[0]?.sampleId ?? ""); setError(""); }
      } catch (e) { if (active) { setResult(null); setError(e instanceof Error ? e.message : "No se pudo leer el proyecto."); } }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [projectId, attempt]);
  const selected = projects.find(p => p.id === projectId);
  const row = result?.rows.find(r => r.sampleId === sampleId);
  const photo = result?.source.images.find(i => i.id === photoId);
  const loadOriginal = useCallback(async () => {
    if (!result || !photoId) throw new Error("Foto no disponible");
    return result.originalPhoto(photoId);
  }, [result, photoId]);
  function refresh() { setLoading(true); setResult(null); setError(""); setAttempt(n => n + 1); }
  function open(id: string) { setResult(null); setSampleId(""); setLoading(true); setProjectId(id); }
  return <div className="space-y-5">
    <header><h1 className="text-3xl font-semibold">Espacios compartidos</h1><p className="mt-2">Consulta las fotografías y revisiones que otras personas comparten contigo. La edición permanece en la cuenta que creó el proyecto.</p></header>
    <div className="flex gap-4 items-center"><button className="ld-button ld-button-outline" disabled={loading} onClick={refresh}>{loading ? "Consultando…" : "Actualizar cargas"}</button><Link className="ld-text-link" href="/demo">Abrir ejemplo público</Link><Link className="ld-text-link" href="/cuenta">Mi cuenta</Link></div>
    {error ? <p role="alert">{error}</p> : null}
    {!loading && !connected ? <p>Entra con tu Google para ver los espacios compartidos contigo. <Link className="ld-text-link" href="/cuenta?returnTo=/compartidos">Entrar con Google</Link></p> : null}
    {!loading && connected && !projects.length && !error ? <p role="status">Todavía no hay espacios compartidos contigo. Las cargas aparecerán aquí cuando un participante cree su espacio desde el ejemplo público.</p> : null}
    {projects.length ? <label className="block">Proyecto de un participante<select className="block mt-2 w-full rounded border p-3" value={projectId} onChange={e => open(e.target.value)}><option value="">Selecciona un espacio</option>{projects.map(p => <option key={p.id} value={p.id}>{p.contributor_name} · {p.name} · {p.photo_count} fotos</option>)}</select></label> : null}
    {selected && result ? <section className="space-y-4"><h2 className="text-xl font-semibold">{selected.contributor_name} · {selected.name}</h2><p>{result.source.images.length} fotografías guardadas · acceso de consulta.</p>
      {result.rows.length ? <label className="block">Árbol y jornada<select className="block mt-2 w-full rounded border p-3" value={sampleId} onChange={e => setSampleId(e.target.value)}>{result.rows.map(r => <option key={r.sampleId} value={r.sampleId}>{r.site.name} · {r.event.name} · {r.tree.code} · {r.savedCount}/4 vistas guardadas</option>)}</select></label> : <p>El participante todavía no ha añadido un árbol a una jornada.</p>}
      {row ? <TreeSummary key={`${projectId}:${row.sampleId}:${attempt}`} readOnly onEdit={noEdit} services={result.services} session={{ ownerId: row.project.owner_id, treeSampleId: row.sampleId, completed: false, views: Object.fromEntries(DIRECTIONS.filter(d => row.views[d].imageId).map(d => [d, row.views[d].imageId!] )) }} /> : null}
      <details><summary>Fotografías registradas en este espacio</summary><ul>{result.source.images.map(i => {
        const view = result.source.captures.find(v => v.image_id === i.id && v.active);
        return <li key={i.id}>{i.original_filename} · {view ? DIRECTION_LABELS[view.direction as keyof typeof DIRECTION_LABELS] : "Sin orientación activa"} · {new Date(i.created_at).toLocaleDateString("es-DO")} · <button className="ld-text-link" onClick={() => setPhotoId(i.id)}>Abrir foto original</button></li>;
      })}</ul></details>
      {photo ? <OriginalPhoto key={photo.id} filename={photo.original_filename} load={loadOriginal} /> : null}
    </section> : null}
  </div>;
}

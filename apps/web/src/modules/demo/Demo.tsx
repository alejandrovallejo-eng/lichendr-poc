"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { DEMO_NOTICE, demoServices, demoSession, loadDemo } from "./template";
import type { GuidedServices } from "../four-view/guided-flow";

const TreeSummary = dynamic(() => import("../four-view/TreeSummary").then(module => module.TreeSummary),
  { loading: () => <p role="status">Abriendo las cuatro vistas…</p>, ssr: false });
const noEdit = () => {};
export default function Demo() {
  const router = useRouter();
  const [example, setExample] = useState<Awaited<ReturnType<typeof loadDemo>> & { services: GuidedServices } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState("");
  const creating = useRef(false);
  useEffect(() => {
    let active = true;
    void loadDemo().then(result => {
      if (active) { setExample({ ...result, services: demoServices(result.template, result.photo) }); setError(""); }
    }).catch(() => { if (active) setError("No se pudo cargar el ejemplo. Puedes reintentar o comenzar tu propio proyecto."); });
    return () => { active = false; };
  }, [attempt]);
  async function copy() {
    if (!example || creating.current) return;
    creating.current = true; setError(""); setProgress("Abriendo tu sesión…");
    try {
      const [{ ensureAnonymousSession }, { supabase }, { createDemoCopy, demoCopyUrl }] = await Promise.all([
        import("../auth/client"), import("../../lib/supabase/client"), import("./copy"),
      ]);
      const auth = await ensureAnonymousSession();
      if (auth.error || !auth.session) throw new Error("No se pudo abrir tu sesión. Reintenta.");
      const result = await createDemoCopy(supabase, example.template, example.photo, setProgress);
      router.push(demoCopyUrl(result));
      setProgress("Copia guardada. Abriendo tu árbol…");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la copia. Reintenta.");
      setProgress(""); creating.current = false;
    }
  }
  return <div className="ld-demo">
    <style>{`.ld-demo{display:grid;gap:20px}.ld-demo-intro{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;flex-wrap:wrap}.ld-demo-intro h1{font-size:clamp(28px,4vw,42px);margin:0 0 10px}.ld-demo-intro p{max-width:680px;line-height:1.6}.ld-demo-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.ld-demo-notice{padding:16px 20px;background:#fbf5e6;border:1px solid #e3d4ae;border-radius:12px;font-size:14px;line-height:1.6}.ld-demo-foot{font-size:14px;line-height:1.6}.ld-demo .tree-summary{padding:0}.ld-demo .tree-summary-info p{margin:0}.ld-demo-error{color:#9c341f}`}</style>
    <header className="ld-demo-intro"><div><p className="ld-eyebrow">Explora LichenDR</p><h1>Del registro al análisis.</h1><p>Abre las fotos, observa la selección de líquenes, consulta qué revisó BioCLIP y explora el montaje 360°. Este ejemplo se puede ver sin iniciar sesión.</p></div></header>
    <div className="ld-demo-actions"><button className="ld-button ld-button-sand" disabled={!example || Boolean(progress)} onClick={copy}>Crear mi copia editable</button><Link className="ld-button ld-button-outline" href="/preparar-jornada">Crear un proyecto propio</Link><Link className="ld-text-link" href="/cuenta">Guardar mi trabajo con Google</Link></div>
    <aside className="ld-demo-notice" aria-label="Alcance del ejemplo"><strong>Ejemplo de uso.</strong> {DEMO_NOTICE}</aside>
    {progress ? <p role="status" aria-live="polite">{progress}</p> : null}
    {error ? <div role="alert" className="ld-demo-error"><p>{error}</p>{!example ? <button onClick={() => setAttempt(n => n + 1)}>Reintentar carga</button> : null}</div> : null}
    {example ? <TreeSummary session={demoSession} services={example.services} onEdit={noEdit} readOnly /> : !error ? <p role="status">Cargando fotografía y revisión del ejemplo…</p> : null}
    <p className="ld-demo-foot">Tu copia editable tendrá las cuatro fotografías y la revisión por color en un proyecto separado. Para obtener una revisión nueva de IA, abre «Revisar / editar» y ejecuta el análisis. Puedes cargar tus propias imágenes, revisar el resultado y descargar tus datos desde la aplicación. <Link className="ld-text-link" href="/cuenta">Conecta tu cuenta</Link> para recuperar el trabajo en otro dispositivo.</p>
  </div>;
}

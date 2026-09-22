"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { authMessage, type AccountUser } from "./google-policy";

export default function AccountPanel() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const status = new URL(window.location.href).searchParams.get("status");
      try {
        const result = await supabase.auth.getUser();
        if (result.error && result.error.name !== "AuthSessionMissingError") throw result.error;
        if (!active) return;
        setUser(result.data.user);
        const verifiedGoogle = result.data.user && !result.data.user.is_anonymous && result.data.user.identities?.some(identity => identity.provider === "google");
        setMessage(authMessage(status === "connected" && !verifiedGoogle ? null : status));
        if (result.data.user) {
          const projects = await supabase.from("projects").select("id", { head: true, count: "exact" }).eq("owner_id", result.data.user.id);
          if (active && !projects.error) setCount(projects.count);
        }
      } catch { if (active) setFailed(true); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const restore = () => setBusy(false);
    window.addEventListener("pageshow", restore);
    return () => { active = false; window.removeEventListener("pageshow", restore); };
  }, []);
  const connected = user && !user.is_anonymous;
  return <section className="mx-auto max-w-2xl space-y-5">
    <div><h1 className="text-2xl font-semibold">Mi cuenta</h1><p className="mt-2 text-sm">Vuelve a tus proyectos desde otro dispositivo con tu cuenta de Google.</p></div>
    {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">{message}</p>}
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
      {loading ? <p role="status">Comprobando tu cuenta…</p> : failed ? <p role="alert">No pudimos comprobar tu sesión. Recarga esta página; no hemos cerrado ni cambiado tu cuenta.</p> : <>
        <h2 className="text-lg font-semibold">{connected ? "Tu cuenta está conectada" : "Conserva el acceso a tu trabajo"}</h2>
        {connected ? <p>{user.email}</p> : <p className="text-sm">{user ? "Tus proyectos están guardados en la nube, pero por ahora dependen de la sesión de este navegador. Vincula Google para poder recuperarlos." : "Entra con Google para recuperar tus proyectos o comenzar con una cuenta permanente."}</p>}
        {count !== null && <p className="text-sm">Proyectos disponibles en esta cuenta: <strong>{count}</strong></p>}
        {!connected && <form method="post" action="/auth/google" onSubmit={() => setBusy(true)}>
          <input type="hidden" name="action" value="connect" />
          <button disabled={busy} className="w-full rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Abriendo Google…" : user ? "Vincular mis proyectos con Google" : "Entrar con Google"}</button>
        </form>}
        {!connected && user && <p className="text-sm text-slate-600">Usa la cuenta con la que quieras recuperar este trabajo. No se eliminan, duplican ni transfieren tus proyectos.</p>}
        {!connected && user && count === 0 && <details className="text-sm"><summary className="cursor-pointer">Ya tengo una cuenta de LichenDR en otro dispositivo</summary><p className="my-3">Esta sesión no contiene proyectos guardados. Puedes entrar a tu cuenta existente. Guarda primero cualquier edición pendiente.</p><form method="post" action="/auth/google" onSubmit={() => setBusy(true)}><input type="hidden" name="action" value="recover" /><button disabled={busy} className="rounded-lg border px-4 py-2">Recuperar mi cuenta de Google</button></form></details>}
        <Link href="/projects" className="inline-block font-medium text-emerald-800 underline">Ver mis proyectos</Link>
        {connected && <details className="text-sm text-slate-500"><summary className="cursor-pointer">Identificador de mi cuenta</summary><p className="mt-2 break-all font-mono">{user.id}</p></details>}
      </>}
    </div>
    <p className="text-sm text-slate-600">Entrar con Google protege el acceso, pero no sustituye una copia de seguridad. Guarda tus cambios antes de salir y conserva exportaciones de tu trabajo importante.</p>
  </section>;
}

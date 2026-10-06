"use client";
import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { reviewFingerprint } from "../four-view/guided-cloud";
import { backupArchive } from "./backup";
import type { DataExport } from "./data";
export default function ExportWorkspace() {
  const [dataset, setDataset] = useState("views"), [busy, setBusy] = useState(""), [error, setError] = useState(""), [success, setSuccess] = useState("");
  async function download(format: "json" | "csv" | "backup") {
    setBusy(format); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/exports?${new URLSearchParams({ format: format === "backup" ? "json" : format, dataset })}`, { cache: "no-store" });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || "No se pudo descargar."); }
      let blob: Blob, filename: string;
      if (format === "backup") {
        const snapshot: DataExport = await response.json();
        blob = await backupArchive(supabase, snapshot, setSuccess);
        const check = await fetch("/api/exports?format=json", { cache: "no-store" });
        if (!check.ok || reviewFingerprint((await check.json()).tables) !== reviewFingerprint(snapshot.tables)) throw new Error("Tus datos cambiaron durante la copia. Guarda las revisiones y genera una nueva copia.");
        filename = `lichendr-copia-${snapshot.generatedAt.slice(0, 10)}.tar`;
      } else { blob = await response.blob(); filename = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || `lichendr.${format}`; }
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setSuccess(format === "backup" ? "Copia descargada con tus registros y archivos privados. Conserva el archivo en un lugar seguro." : format === "json" ? "Datos descargados. Las fotografías se respaldan por separado." : "Mediciones descargadas en CSV.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo descargar. Reintenta."); }
    finally { setBusy(""); }
  }
  return <section className="mx-auto max-w-4xl">
    <PageHeader title="Exportar datos" subtitle="Conserva tus mediciones y el contexto de cada jornada para revisarlos fuera de LichenDR." />
    <div className="grid gap-8 md:grid-cols-2">
      <section className="ld-surface p-6"><h2 className="text-xl font-semibold">Mediciones en CSV</h2><p className="my-4 text-sm">Una fila por vista o medición. Las vistas ausentes y pendientes conservan su estado; su cobertura queda vacía.</p>
        <label className="block text-sm">Datos a descargar<select className="mt-2 w-full rounded border p-3" value={dataset} onChange={e => setDataset(e.target.value)} disabled={!!busy}>
          <option value="views">Cobertura por orientación</option><option value="pollutant_measurements">Mediciones de contaminantes</option><option value="site_environmental_contexts">Contexto ambiental de sitios</option><option value="tree_sample_scientific_contexts">Contexto de árboles</option><option value="annotation_metrics">Métricas de anotaciones</option>
        </select></label><button className="mt-5 rounded bg-emerald-900 px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={!!busy} onClick={() => void download("csv")}>{busy === "csv" ? "Preparando descarga…" : "Descargar CSV"}</button>
      </section>
      <section className="ld-surface p-6"><h2 className="text-xl font-semibold">Contexto y resultados en JSON</h2><p className="my-4 text-sm">Incluye tus proyectos, jornadas, imágenes, revisiones, anotaciones y metadatos disponibles. Conserva los identificadores y las versiones de las revisiones.</p><p className="text-sm">Incluye metadatos de fotografías, que pueden contener ubicación. El archivo JSON guarda los registros; los archivos de imagen se respaldan por separado.</p><button className="mt-5 rounded border border-emerald-900 px-5 py-3 font-semibold disabled:opacity-50" disabled={!!busy} onClick={() => void download("json")}>{busy === "json" ? "Preparando descarga…" : "Descargar JSON"}</button></section>
    </div>
    <section className="ld-surface mt-8 p-6"><h2 className="text-xl font-semibold">Copia de mis datos y fotografías</h2><p className="my-4 text-sm">Guarda primero tus revisiones. Esta copia incluye los registros de tu cuenta y sus archivos privados, con comprobaciones de integridad. Puede incluir ubicación y fotografías originales. Conserva el archivo en un lugar seguro.</p><p className="text-sm">La copia cubre tu cuenta; la recuperación completa del servicio también necesita las migraciones y la configuración de acceso. El límite de esta descarga es 256 MiB.</p><button className="mt-5 rounded border border-emerald-900 px-5 py-3 font-semibold disabled:opacity-50" disabled={!!busy} onClick={() => void download("backup")}>{busy === "backup" ? "Preparando copia…" : "Descargar copia con fotografías"}</button></section>
    {error ? <p role="alert" className="mt-5 text-red-800">{error}</p> : null}{success ? <p role="status" className="mt-5 text-emerald-900">{success}</p> : null}
    <p className="my-6 text-sm">La cobertura es descriptiva por fotografía. La IA propone etiquetas para revisión; estas mediciones no equivalen a un índice de calidad del aire.</p>
    <Link href="/analysis" className="underline">Revisar resultados antes de exportar</Link>
  </section>;
}

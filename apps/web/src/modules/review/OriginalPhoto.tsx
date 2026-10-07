"use client";
import { useEffect, useState } from "react";

export default function OriginalPhoto({ filename, load }: { filename: string; load: () => Promise<Blob> }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true, objectUrl = "";
    void load().then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (active) setError("No se pudo abrir la foto. Actualiza las cargas para comprobar el acceso."); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [load]);
  return <section className="space-y-3" aria-label="Fotografía original">
    <h3 className="font-semibold">{filename}</h3>
    {error ? <p role="alert">{error}</p> : null}
    {!url && !error ? <p role="status">Abriendo fotografía…</p> : null}
    {url ? <>
      {/* The private blob URL is released when the selected photo changes. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={filename} className="max-h-[36rem] max-w-full rounded object-contain" onError={() => setError("Este formato no se puede mostrar aquí. Puedes descargar la fotografía original.")} />
      <a className="ld-text-link" href={url} download={filename}>Descargar fotografía original</a>
    </> : null}
  </section>;
}

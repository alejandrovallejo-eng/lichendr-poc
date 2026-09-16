"use client";

import { useEffect, useRef, useState } from "react";
import { DIRECTIONS, DIRECTION_LABELS, type Direction } from "./types";
import type { GuidedReview, GuidedServices, GuidedSession } from "./guided-flow";
import { classifyTrunkColors, colorWorkingSize, OVERLAY_RGB } from "../region-suggestions/trunk-colors";
import { TreeOrbit } from "./TreeOrbit";
import { GuidedGroupCoverage } from "./GuidedColorPicker";

type Entry = { review: GuidedReview | null; src: string; loading: boolean; error: string };
const empty = (): Entry => ({ review: null, src: "", loading: false, error: "" });
const detail = (e: unknown) => e instanceof Error ? e.message : "No se pudo abrir esta vista. Reintenta.";

// Only private storage reads and saved review reads. No upload, write, proxy
// preparation or AI request is allowed in this results screen.
export function TreeSummary({ session, services, onEdit }: {
  session: GuidedSession; services: GuidedServices; onEdit: (direction: Direction) => void;
}) {
  const [entries, setEntries] = useState<Record<Direction, Entry>>({ N: empty(), E: empty(), S: empty(), W: empty() });
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<Direction | null>(null);
  const [orbit, setOrbit] = useState(false);
  const [marked, setMarked] = useState(true);
  const [orbitMarked, setOrbitMarked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const viewsKey = JSON.stringify(session.views);
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    for (const direction of DIRECTIONS) {
      const imageId = session.views[direction];
      setEntries(prev => ({ ...prev, [direction]: { ...empty(), loading: Boolean(imageId) } }));
      if (!imageId) continue;
      // A photo failure must not hide a successfully loaded saved percentage.
      void Promise.allSettled([
        services.cloud.read({ ownerId: session.ownerId, treeSampleId: session.treeSampleId, direction, imageId }),
        services.storedPhoto(session.ownerId, imageId),
      ]).then(([row, photo]) => {
        if (!active) return;
        const src = photo.status === "fulfilled" ? URL.createObjectURL(photo.value) : "";
        if (src) urls.push(src);
        setEntries(prev => ({ ...prev, [direction]: {
          review: row.status === "fulfilled" ? row.value?.review ?? null : null, src, loading: false,
          error: [row, photo].filter(v => v.status === "rejected").map(v => detail((v as PromiseRejectedResult).reason)).join(" "),
        } }));
      });
    }
    return () => { active = false; urls.forEach(url => URL.revokeObjectURL(url)); };
    // Stable view identity; changes to unrelated session flags do not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.ownerId, session.treeSampleId, viewsKey, services, attempt]);
  useEffect(() => { heading.current?.focus(); }, [expanded, orbit]);
  const loaded = DIRECTIONS.every(d => !entries[d].loading);
  const savedCount = DIRECTIONS.filter(d => entries[d].review?.savedAt).length;
  return <main className="tree-summary" aria-label="Las cuatro vistas del árbol">
    <style>{`.tree-summary{min-height:0;overflow:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px}.tree-summary-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.tree-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;flex:1;min-height:0}.tree-summary-card{background:white;border:1px solid #d5e3da;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;min-width:0}.tree-summary-card header{display:flex;justify-content:space-between;align-items:center;padding:12px;gap:8px}.tree-summary-card h3{font-size:19px;margin:0}.tree-summary-photo{height:clamp(160px,32vh,340px);background:#e5ece7;position:relative;display:flex;justify-content:center;align-items:center}.tree-summary-photo svg{width:100%;height:100%}.tree-summary-info{padding:12px;display:flex;flex-direction:column;gap:9px;font-size:13px}.tree-summary-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto;padding:0 12px 12px}.tree-summary .tree-summary-expanded{grid-template-columns:1fr;max-width:1000px;width:100%;margin:auto}.tree-summary-expanded .tree-summary-card{display:grid;grid-template-columns:minmax(0,1fr) 270px}.tree-summary-expanded .tree-summary-card header{grid-column:1/-1}.tree-summary-expanded .tree-summary-photo{height:min(53vh,520px);grid-row:2/4}.tree-summary-expanded .tree-summary-actions{align-items:flex-end}.tree-summary-note{font-size:12px;color:#4a6156}@media(max-width:1100px){.tree-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tree-summary-photo{height:220px}}@media(max-width:600px){.tree-summary{padding:10px}.tree-summary-grid{grid-template-columns:1fr}.tree-summary-expanded .tree-summary-card{display:flex}.tree-summary-expanded .tree-summary-photo{height:40vh}}`}</style>
    <div className="tree-summary-top">
      <div><h2 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 20 }}>{orbit ? "Explorar el árbol · 360° aproximado" : expanded ? DIRECTION_LABELS[expanded] : "Un árbol · cuatro vistas"}</h2>
        <p style={{ fontSize: 13 }}>{loaded ? `${savedCount} de 4 vistas con análisis guardado` : "Cargando resultados guardados…"}</p></div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={orbit ? orbitMarked : marked} onChange={e => orbit ? setOrbitMarked(e.target.checked) : setMarked(e.target.checked)} /> {orbit ? "Resaltar áreas seleccionadas" : "Mostrar selección"}</label>
        {!orbit ? <button disabled={!loaded || !DIRECTIONS.some(d => entries[d].src && entries[d].review?.savedAt && entries[d].review?.outline.length)} onClick={() => { setExpanded(null); setOrbitMarked(false); setOrbit(true); }}>Explorar 360°</button> : null}
        {expanded || orbit ? <button onClick={() => { setExpanded(null); setOrbit(false); }}>Ver las cuatro vistas</button> : null}
      </div>
    </div>
    {orbit ? <TreeOrbit entries={entries} marked={orbitMarked} onOpenPhoto={d => { setOrbit(false); setExpanded(d); }} /> : <div className={`tree-summary-grid${expanded ? " tree-summary-expanded" : ""}`}>
      {(expanded ? [expanded] : DIRECTIONS).map(direction => <SummaryCard key={direction}
        direction={direction} entry={entries[direction]} imageId={session.views[direction]} treeSampleId={session.treeSampleId}
        marked={marked} expanded={expanded !== null} onExpand={() => setExpanded(direction)}
        onEdit={() => onEdit(direction)} onRetry={() => setAttempt(n => n + 1)} />)}
    </div>}
    <p className="tree-summary-note">Cada porcentaje corresponde al tronco delimitado en esa foto. BioCLIP revisa ejemplos; no valida toda la selección. Las cuatro vistas no equivalen a una medición de superficie total ni de calidad del aire.</p>
  </main>;
}

function SummaryCard({ direction, entry, imageId, treeSampleId, marked, expanded, onExpand, onEdit, onRetry }: {
  direction: Direction; entry: Entry; imageId?: string; treeSampleId: string; marked: boolean; expanded: boolean;
  onExpand: () => void; onEdit: () => void; onRetry: () => void;
}) {
  const [overlay, setOverlay] = useState("");
  const [maskError, setMaskError] = useState("");
  const [size, setSize] = useState({ width: 1000, height: 1000 });
  const image = useRef<HTMLImageElement>(null);
  const [decoded, setDecoded] = useState(false);
  const a = entry.review?.savedAt ? entry.review.analysis : null;
  useEffect(() => { setDecoded(false); setOverlay(""); setMaskError(""); }, [entry.src]);
  useEffect(() => {
    if (!decoded || !a || !entry.review || !image.current) return;
    const abort = new AbortController();
    const review = entry.review, photo = image.current;
    void (async () => {
      const working = colorWorkingSize(photo.naturalWidth, photo.naturalHeight);
      if (working.width !== a.width || working.height !== a.height) throw new Error("La copia de la foto cambió; abre la vista para revisar su selección.");
      const canvas = document.createElement("canvas"); canvas.width = working.width; canvas.height = working.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("No se pudo dibujar la selección. El porcentaje guardado se conserva.");
      ctx.drawImage(photo, 0, 0, working.width, working.height);
      const result = await classifyTrunkColors(ctx.getImageData(0, 0, working.width, working.height).data,
        working.width, working.height, review.outline, review.config, abort.signal, "lichen-only");
      if (abort.signal.aborted) return;
      if (result.counts.some((count, i) => count !== a.counts[i])) throw new Error("La selección no coincide con el análisis guardado. Abre esta vista para revisarla.");
      const data = ctx.createImageData(working.width, working.height);
      result.labels.forEach((code, i) => { if (code >= 3) data.data.set([...OVERLAY_RGB[code - 1], 125], i * 4); });
      ctx.putImageData(data, 0, 0); setOverlay(canvas.toDataURL());
    })().catch(e => { if (!abort.signal.aborted) setMaskError(detail(e)); });
    return () => abort.abort();
  }, [decoded, a, entry.review, entry.src]);
  const storedAi = a?.ai;
  const ai = storedAi && storedAi.context.imageId === imageId && storedAi.context.treeSampleId === treeSampleId && storedAi.context.direction === direction ? storedAi : null;
  const matches = ai?.suggestions.filter(s => s.ranking?.[0]?.label === "lichen").length ?? 0;
  const name = DIRECTION_LABELS[direction];
  return <article className="tree-summary-card" aria-label={`Resultado de ${name}`}>
    <header><h3>{name}</h3><span style={{ fontSize: 12, color: a ? "#00674d" : "#675d40" }}>{entry.loading ? "Cargando…" : a ? "Guardado ✓" : entry.error ? "Sin confirmar" : imageId ? "Por completar" : "Sin fotografía"}</span></header>
    <div className="tree-summary-photo">
      {entry.src ? <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={image} className="g-hidden" src={entry.src} alt="" onError={() => setMaskError("No se pudo mostrar la fotografía.")}
          onLoad={e => { setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }); setDecoded(true); }} />
        <svg role="img" aria-label={`Fotografía y contorno de ${name}`} viewBox={`0 0 ${size.width} ${size.height}`}>
          <image href={entry.src} width={size.width} height={size.height} />
          {marked && overlay ? <image href={overlay} width={size.width} height={size.height} /> : null}
          {marked && entry.review?.outline.length ? <polygon points={entry.review.outline.map(p => `${p.x * size.width},${p.y * size.height}`).join(" ")} fill="none" stroke="#00b8ff" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
      </> : <p style={{ padding: 18, fontSize: 13 }}>{entry.loading ? "Abriendo foto…" : imageId ? "Fotografía no disponible" : `Falta la foto de ${name.toLowerCase()}`}</p>}
    </div>
    <div className="tree-summary-info" style={{ minHeight: 0, overflowY: "auto" }}>
      {a ? <><p>Cobertura estimada por color</p><p style={{ fontSize: 30, fontWeight: 750 }}>{(100 * a.lichen / a.total).toFixed(1)} %</p>
        <p>{(100 * (a.total - a.lichen) / a.total).toFixed(1)} % sin clasificar</p>
        <p>{ai?.suggestions.length ? `BioCLIP: sugiere liquen en ${matches}/${ai.suggestions.length} ejemplos.` : "Sin revisión de IA guardada."}</p>
        <GuidedGroupCoverage config={entry.review!.config} counts={a.counts} total={a.total} />
      </> : <p>{imageId ? "La foto está guardada; falta confirmar su análisis en este flujo." : "Completa esta orientación para añadir su análisis."}</p>}
      {entry.error || maskError ? <p role="alert" style={{ color: "#9c341f" }}>{entry.error || maskError}</p> : null}
    </div>
    <div className="tree-summary-actions" style={{ flexShrink: 0 }}>
      {!expanded && entry.src ? <button onClick={onExpand} aria-label={`Ampliar ${name}`}>Ampliar</button> : null}
      <button className="g-primary" disabled={entry.loading} onClick={onEdit} aria-label={`${a ? "Revisar" : "Completar"} ${name}`}>{a ? "Revisar / editar" : "Completar vista"}</button>
      {entry.error ? <button onClick={onRetry}>Reintentar lectura</button> : null}
    </div>
  </article>;
}

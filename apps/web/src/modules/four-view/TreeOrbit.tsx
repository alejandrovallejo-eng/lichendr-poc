"use client";

import { useEffect, useRef, useState } from "react";
import { DIRECTIONS, DIRECTION_LABELS, type Direction } from "./types";
import { directionRotation, normalizeRotation, orbitDirection, prepareOrbitTexture, type OrbitEntry, type OrbitTexture } from "./tree-orbit";
import { renderOrbitPixels } from "./tree-orbit-render";

type Sector = { texture: OrbitTexture | null; error: string };
const emptySectors = (): Record<Direction, Sector> => ({ N: { texture: null, error: "" }, E: { texture: null, error: "" }, S: { texture: null, error: "" }, W: { texture: null, error: "" } });

export function TreeOrbit({ entries, marked, onOpenPhoto, prepare = prepareOrbitTexture }: {
  entries: Record<Direction, OrbitEntry>; marked: boolean; onOpenPhoto: (direction: Direction) => void;
  prepare?: typeof prepareOrbitTexture;
}) {
  const [sectors, setSectors] = useState(emptySectors);
  const [progress, setProgress] = useState("Preparando las vistas guardadas…");
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [renderError, setRenderError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; rotation: number } | null>(null);
  const direction = orbitDirection(rotation);
  useEffect(() => {
    const abort = new AbortController();
    setSectors(emptySectors());
    // Sequential: at most one decoded photo + one colour grid at a time.
    void (async () => {
      for (const d of DIRECTIONS) {
        if (abort.signal.aborted) return;
        setProgress(`Preparando ${DIRECTION_LABELS[d].toLowerCase()}…`);
        try {
          const texture = await prepare(entries[d], abort.signal);
          if (abort.signal.aborted) return;
          setSectors(prev => ({ ...prev, [d]: { texture, error: "" } }));
        } catch (e) {
          if (abort.signal.aborted) return;
          setSectors(prev => ({ ...prev, [d]: { texture: null, error: e instanceof Error ? e.message : "Recorte no disponible." } }));
        }
      }
      setProgress("");
    })();
    // Pixel buffers are owned by this view, with no object URLs or GPU resources.
    return () => { abort.abort(); };
  }, [entries, prepare]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const ctx = canvas.current?.getContext("2d");
        if (!ctx) throw new Error("No se pudo dibujar la vista 360. Puedes abrir las fotos originales.");
        const image = ctx.createImageData(600, 720);
        image.data.set(renderOrbitPixels({ N: sectors.N.texture, E: sectors.E.texture, S: sectors.S.texture, W: sectors.W.texture }, rotation, marked, 600, 720));
        ctx.putImageData(image, 0, 0); setRenderError("");
      } catch (error) { setRenderError(error instanceof Error ? error.message : "No se pudo dibujar la vista 360."); }
    });
    return () => cancelAnimationFrame(frame);
  }, [sectors, rotation, marked]);
  const hashes = DIRECTIONS.map(d => sectors[d].texture?.fingerprint).filter((s): s is string => Boolean(s));
  const repeated = new Set(hashes).size < hashes.length;
  const current = sectors[direction];
  const rotate = (delta: number) => setRotation(r => normalizeRotation(r + delta));
  return <section className="tree-orbit" aria-label="Explorador 360 aproximado">
    <style>{`.tree-orbit{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1}.tree-orbit-stage{height:clamp(250px,44vh,430px);min-height:250px;position:relative;overflow:hidden;border-radius:18px;background:radial-gradient(ellipse at 48% 35%,#f5f4e9 0%,#e8eee3 50%,#d7e1d3 100%);touch-action:pan-y;cursor:grab;user-select:none;outline-offset:-4px}.tree-orbit-stage:active{cursor:grabbing}.tree-orbit-shadow{position:absolute;left:50%;bottom:7%;width:115px;height:13px;background:#354b3433;filter:blur(8px);border-radius:50%;transform:translateX(-50%);pointer-events:none}.tree-orbit-canvas{position:absolute;left:50%;top:50%;height:100%;width:auto;max-width:none;pointer-events:none}.tree-orbit-label{position:absolute;top:12px;left:14px;background:#fffdf2;border:1px solid #d5dece;border-radius:20px;padding:6px 12px;font-size:12px}.tree-orbit-instruction{position:absolute;bottom:10px;left:0;right:0;text-align:center;font-size:12px;color:#324b3d;pointer-events:none}.tree-orbit-controls{display:flex;justify-content:center;align-items:center;gap:10px;flex-wrap:wrap}.tree-orbit-directions{display:flex;gap:6px}.tree-orbit-directions button[aria-pressed=true]{background:#00634e;color:white}.tree-orbit-caption{text-align:center;font-size:12px;color:#425b4e}.tree-orbit-message{font-size:12px;text-align:center;color:#765622}.tree-orbit-controls input{width:100px;vertical-align:middle}@media(max-width:600px){.tree-orbit-stage{height:36vh;min-height:240px}.tree-orbit-controls{gap:7px}.tree-orbit-directions button{padding:8px}}`}</style>
    <div className="tree-orbit-stage" role="group" tabIndex={0} aria-label={`Vista giratoria. Orientación ${DIRECTION_LABELS[direction]}. Usa las flechas para girar y más o menos para acercar.`}
      onKeyDown={e => {
        if (!["ArrowLeft", "ArrowRight", "+", "=", "-", "Home"].includes(e.key)) return;
        e.preventDefault();
        if (e.key === "ArrowLeft") rotate(15);
        else if (e.key === "ArrowRight") rotate(-15);
        else if (e.key === "Home") { setRotation(0); setZoom(1); }
        else setZoom(z => Math.max(.7, Math.min(1.4, z + (e.key === "-" ? -.1 : .1))));
      }}
      onPointerDown={e => { if (e.button !== 0 || !e.isPrimary) return; drag.current = { id: e.pointerId, x: e.clientX, rotation }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { const start = drag.current; if (start?.id === e.pointerId) setRotation(normalizeRotation(start.rotation + (e.clientX - start.x) * .45)); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <div className="tree-orbit-shadow" aria-hidden="true" />
      <canvas ref={canvas} width={600} height={720} className="tree-orbit-canvas" aria-hidden="true" data-marked={marked} style={{ transform: `translate(-50%,-50%) scale(${zoom})` }} />
      <div className="tree-orbit-label">360° aproximado · {DIRECTION_LABELS[direction]}</div>
      <div className="tree-orbit-instruction">Arrastra para girar · también puedes usar N / E / S / O</div>
    </div>
    <div className="tree-orbit-controls">
      <button onClick={() => rotate(30)} aria-label="Girar a la izquierda">←</button>
      <div className="tree-orbit-directions" aria-label="Orientaciones">
        {DIRECTIONS.map(d => <button key={d} aria-label={`Ver ${DIRECTION_LABELS[d]} en 360`} aria-pressed={direction === d} onClick={() => setRotation(directionRotation(d))}>{d === "W" ? "O" : d}</button>)}
      </div>
      <button onClick={() => rotate(-30)} aria-label="Girar a la derecha">→</button>
      <label style={{ fontSize: 12 }}>Zoom <input aria-label="Zoom del árbol" type="range" min="70" max="140" step="5" value={Math.round(zoom * 100)} onChange={e => setZoom(Number(e.target.value) / 100)} /></label>
      <button onClick={() => { setRotation(0); setZoom(1); }}>Restablecer</button>
      <button disabled={!entries[direction].src} onClick={() => onOpenPhoto(direction)}>Abrir foto de {DIRECTION_LABELS[direction].toLowerCase()}</button>
    </div>
    <p className="tree-orbit-caption" role="status">{progress || (current.texture ? `${DIRECTION_LABELS[direction]} · contorno guardado${marked && current.texture.overlay ? " y selección de liquen" : ""}` : `${DIRECTION_LABELS[direction]} · sector sin recorte. ${current.error}`)}</p>
    {renderError ? <p className="tree-orbit-message" role="alert">{renderError}</p> : null}
    {current.texture?.warning ? <p className="tree-orbit-message" role="alert">{current.texture.warning}</p> : null}
    {repeated ? <p className="tree-orbit-message">Hay fotografías repetidas entre las vistas. Este montaje no representa cuatro lados distintos del árbol.</p> : null}
    <p className="tree-orbit-caption">Tus cuatro recortes se adaptan visualmente a un tronco continuo. Forma, luz y uniones aproximadas; el gris rayado indica zonas sin imagen. Las fotos y porcentajes originales no cambian. No es un escaneo 3D.</p>
  </section>;
}

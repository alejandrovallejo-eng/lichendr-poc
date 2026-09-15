"use client";

import { useEffect, useRef, useState } from "react";
import { DIRECTIONS, DIRECTION_LABELS, type Direction } from "./types";
import { directionRotation, normalizeRotation, orbitDirection, prepareOrbitTexture, releaseOrbitTexture, type OrbitEntry, type OrbitTexture } from "./tree-orbit";

type Sector = { texture: OrbitTexture | null; error: string };
const emptySectors = (): Record<Direction, Sector> => ({ N: { texture: null, error: "" }, E: { texture: null, error: "" }, S: { texture: null, error: "" }, W: { texture: null, error: "" } });
const STRIPS = 16, RADIUS = 110, STRIP_WIDTH = 2 * RADIUS * Math.tan(Math.PI / (4 * STRIPS));

export function TreeOrbit({ entries, marked, onOpenPhoto, prepare = prepareOrbitTexture }: {
  entries: Record<Direction, OrbitEntry>; marked: boolean; onOpenPhoto: (direction: Direction) => void;
  prepare?: typeof prepareOrbitTexture;
}) {
  const [sectors, setSectors] = useState(emptySectors);
  const [progress, setProgress] = useState("Preparando las vistas guardadas…");
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ id: number; x: number; rotation: number } | null>(null);
  const direction = orbitDirection(rotation);
  useEffect(() => {
    const abort = new AbortController(), textures: OrbitTexture[] = [];
    setSectors(emptySectors());
    // Sequential: at most one decoded photo + one colour grid at a time.
    void (async () => {
      for (const d of DIRECTIONS) {
        if (abort.signal.aborted) return;
        setProgress(`Preparando ${DIRECTION_LABELS[d].toLowerCase()}…`);
        try {
          const texture = await prepare(entries[d], abort.signal);
          if (abort.signal.aborted) { releaseOrbitTexture(texture); return; }
          textures.push(texture);
          setSectors(prev => ({ ...prev, [d]: { texture, error: "" } }));
        } catch (e) {
          if (abort.signal.aborted) return;
          setSectors(prev => ({ ...prev, [d]: { texture: null, error: e instanceof Error ? e.message : "Recorte no disponible." } }));
        }
      }
      setProgress("");
    })();
    return () => { abort.abort(); textures.forEach(releaseOrbitTexture); };
  }, [entries, prepare]);
  const hashes = DIRECTIONS.map(d => sectors[d].texture?.fingerprint).filter((s): s is string => Boolean(s));
  const repeated = new Set(hashes).size < hashes.length;
  const current = sectors[direction];
  const rotate = (delta: number) => setRotation(r => normalizeRotation(r + delta));
  return <section className="tree-orbit" aria-label="Explorador 360 aproximado">
    <style>{`.tree-orbit{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1}.tree-orbit-stage{height:clamp(250px,44vh,430px);min-height:250px;position:relative;overflow:hidden;border-radius:18px;background:radial-gradient(ellipse at 50% 40%,#e5eee6,#ceddd2);touch-action:pan-y;cursor:grab;user-select:none;outline-offset:-4px}.tree-orbit-stage:active{cursor:grabbing}.tree-orbit-camera{position:absolute;inset:0;perspective:850px}.tree-orbit-cylinder{position:absolute;left:50%;top:50%;width:0;height:0;transform-style:preserve-3d}.tree-orbit-strip{position:absolute;height:clamp(185px,33vh,300px);background-color:#acbbb1;background-repeat:no-repeat;background-size:1600% 100%;backface-visibility:hidden;pointer-events:none}.tree-orbit-label{position:absolute;top:12px;left:14px;background:#fffdf2;border:1px solid #d5dece;border-radius:20px;padding:6px 12px;font-size:12px}.tree-orbit-instruction{position:absolute;bottom:12px;left:0;right:0;text-align:center;font-size:12px;color:#324b3d;pointer-events:none}.tree-orbit-controls{display:flex;justify-content:center;align-items:center;gap:10px;flex-wrap:wrap}.tree-orbit-directions{display:flex;gap:6px}.tree-orbit-directions button[aria-pressed=true]{background:#00634e;color:white}.tree-orbit-caption{text-align:center;font-size:12px;color:#425b4e}.tree-orbit-message{font-size:12px;text-align:center;color:#765622}.tree-orbit-controls input{width:100px;vertical-align:middle}@media(max-width:600px){.tree-orbit-stage{height:36vh;min-height:240px}.tree-orbit-strip{height:185px}.tree-orbit-controls{gap:7px}.tree-orbit-directions button{padding:8px}}`}</style>
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
      <div className="tree-orbit-camera" aria-hidden="true">
        <div className="tree-orbit-cylinder" style={{ transform: `scale(${zoom}) rotateY(${rotation}deg)` }}>
          {DIRECTIONS.flatMap((d, sector) => Array.from({ length: STRIPS }, (_, strip) => {
            const texture = sectors[d].texture;
            const angle = sector * 90 - 45 + (strip + .5) * 90 / STRIPS;
            const layers = texture ? [marked && texture.overlay ? `url("${texture.overlay}")` : "", `url("${texture.photo}")`].filter(Boolean).join(",") : "none";
            return <div key={`${d}-${strip}`} className="tree-orbit-strip" data-orientation={d} style={{
              width: STRIP_WIDTH + .25, left: -(STRIP_WIDTH + .25) / 2,
              transform: `rotateY(${angle}deg) translateZ(${RADIUS}px) translateY(-50%)`,
              backgroundImage: layers, backgroundPosition: `${strip * 100 / (STRIPS - 1)}% 50%`,
              borderLeft: strip === 0 ? "1px solid #ffffff90" : undefined,
            }} />;
          }))}
        </div>
      </div>
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
    {current.texture?.warning ? <p className="tree-orbit-message" role="alert">{current.texture.warning}</p> : null}
    {repeated ? <p className="tree-orbit-message">Hay fotografías repetidas entre las vistas. Este montaje no representa cuatro lados distintos del árbol.</p> : null}
    <p className="tree-orbit-caption">Montaje de N / E / S / O sobre una forma cilíndrica. Las proporciones y uniones son aproximadas; el gris indica zonas sin recorte. No es un escaneo 3D ni una medición de superficie.</p>
  </section>;
}

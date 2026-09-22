"use client";

import { useRef, useState } from "react";
import { MAX_TRUNK_POINTS, trunkOutlineError, type TrunkPoint } from "./trunk-outline";

const BUTTON = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sky-700";
interface Props {
  src: string;
  viewName: string;
  points: readonly TrunkPoint[] | null;
  disabled: boolean;
  onConfirm: (points: TrunkPoint[]) => boolean | void;
  onEditingChange: (editing: boolean) => void;
}

export function TrunkOutlineEditor({ src, viewName, points, disabled, onConfirm, onEditingChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TrunkPoint[]>([]);
  const [history, setHistory] = useState<TrunkPoint[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; original: TrunkPoint[] } | null>(null);
  const moved = useRef(false);
  const change = (next: TrunkPoint[]) => { setHistory(h => [...h.slice(-99), draft]); setDraft(next); };
  const end = () => { setEditing(false); onEditingChange(false); drag.current = null; };
  const coordinate = (clientX: number, clientY: number): TrunkPoint | null => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box?.width || !box.height) return null;
    return { x: Math.max(0, Math.min(1, (clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (clientY - box.top) / box.height)) };
  };
  const error = trunkOutlineError(draft);
  return <section className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-slate-900" aria-label={`Delimitar tronco · ${viewName}`}>
    <h5 className="font-semibold">1. Delimita el tronco de {viewName}</h5>
    <p className="mt-1 text-sm">{points ? `Contorno confirmado · ${points.length} puntos. La próxima búsqueda se limitará a este tronco.` : "Marca el tronco antes de pedir nuevas propuestas. No necesitas dibujar cada liquen."}</p>
    {!editing ? <button type="button" disabled={disabled} className={`${BUTTON} mt-3`} onClick={() => {
      setDraft(points?.map(p => ({ ...p })) ?? []); setHistory([]); setSelected(null); setEditing(true); onEditingChange(true);
    }}>{points ? "Ajustar contorno del tronco" : "Dibujar contorno del tronco"}</button> : <>
      <p className="my-3 text-sm">Haz clic siguiendo el borde del tronco. Arrastra los puntos para ajustarlos. Con teclado: selecciona un punto y usa las flechas; Suprimir lo elimina. El último punto se une al primero.</p>
      <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg bg-slate-200">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`Delimitar ${viewName}`} className="block h-auto max-h-[65vh] w-auto max-w-full" draggable={false} />
        <svg ref={svgRef} viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full touch-none" role="group" aria-label={`Puntos del tronco de ${viewName}`}
          onClick={event => {
            if (moved.current) { moved.current = false; return; }
            if (event.target !== event.currentTarget || draft.length >= MAX_TRUNK_POINTS) return;
            const p = coordinate(event.clientX, event.clientY); if (p) { change([...draft, p]); setSelected(draft.length); }
          }}
          onPointerMove={event => {
            if (!drag.current) return;
            const p = coordinate(event.clientX, event.clientY); if (!p) return;
            moved.current = true;
            const index = drag.current.index;
            setDraft(current => current.map((point, i) => i === index ? p : point));
          }}
          onPointerUp={() => {
            if (drag.current && moved.current) { const original = drag.current.original; setHistory(h => [...h.slice(-99), original]); }
            drag.current = null;
          }}
          onPointerCancel={() => { if (drag.current) setDraft(drag.current.original); drag.current = null; moved.current = false; }}>
          <polygon points={draft.map(p => `${p.x * 1000},${p.y * 1000}`).join(" ")} fill="rgba(14,165,233,0.18)" stroke="#0284c7" strokeWidth="3" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          {draft.map((p, i) => <circle key={i} cx={p.x * 1000} cy={p.y * 1000} r="11" fill={selected === i ? "#facc15" : "white"} stroke="#075985" strokeWidth="2" vectorEffect="non-scaling-stroke" tabIndex={0} role="button" aria-label={`Punto ${i + 1} del tronco`}
            onClick={e => { e.stopPropagation(); moved.current = false; setSelected(i); }}
            onFocus={() => setSelected(i)}
            onPointerDown={e => { e.stopPropagation(); moved.current = false; drag.current = { index: i, original: draft }; setSelected(i); e.currentTarget.setPointerCapture(e.pointerId); }}
            onKeyDown={e => {
              const delta: Record<string, TrunkPoint> = { ArrowLeft: { x: -0.002, y: 0 }, ArrowRight: { x: 0.002, y: 0 }, ArrowUp: { x: 0, y: -0.002 }, ArrowDown: { x: 0, y: 0.002 } };
              if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); change(draft.filter((_, n) => n !== i)); setSelected(null); }
              else if (delta[e.key]) { e.preventDefault(); const d = delta[e.key]; change(draft.map((p, n) => n !== i ? p : { x: Math.max(0, Math.min(1, p.x + d.x * (e.shiftKey ? 5 : 1))), y: Math.max(0, Math.min(1, p.y + d.y * (e.shiftKey ? 5 : 1))) })); }
            }} />)}
        </svg>
      </div>
      <p className="mt-3 text-sm" role="status">{draft.length} puntos · {error ?? "Contorno válido. Confírmalo para guardarlo."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={!history.length} onClick={() => { setDraft(history[history.length - 1]); setHistory(h => h.slice(0, -1)); setSelected(null); }}>Deshacer punto o movimiento</button>
        <button type="button" className={BUTTON} disabled={selected === null} onClick={() => { change(draft.filter((_, i) => i !== selected)); setSelected(null); }}>Eliminar punto seleccionado</button>
        <button type="button" className={BUTTON} disabled={!draft.length} onClick={() => { change([]); setSelected(null); }}>Reiniciar dibujo</button>
        <button type="button" className={BUTTON} onClick={end}>Cancelar contorno</button>
        <button type="button" className={`${BUTTON} !bg-sky-800 !text-white`} disabled={!!error || disabled} onClick={() => { if (!trunkOutlineError(draft) && onConfirm(draft) !== false) end(); }}>Confirmar tronco</button>
      </div>
      <p className="mt-2 text-xs">Cancelar conserva el contorno anterior. Esto delimita un área visible; no sustituye la plantilla de calibración.</p>
    </>}
  </section>;
}

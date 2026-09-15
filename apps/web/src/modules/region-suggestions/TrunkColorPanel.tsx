"use client";

import { useEffect, useRef, useState } from "react";
import { rasterizeTrunk, type TrunkPoint } from "./trunk-outline";
import { COLOR_NAMES, MAX_COLOR_SAMPLES, OVERLAY_RGB, classifyTrunkColors, colorStorageKey,
  colorWorkingSize, initialColorConfig, parseColorConfig, sampleColor,
  type ColorClass, type ColorConfig, type ColorResult } from "./trunk-colors";

const BUTTON = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-emerald-700";
interface Props { src: string; viewName: string; points: readonly TrunkPoint[]; identity: string; disabled: boolean }
interface Pixels { rgba: Uint8ClampedArray; width: number; height: number; roi: Uint8Array }

export function TrunkColorPanel(props: Props) {
  const [open, setOpen] = useState(false);
  return <section aria-label={`Colores del tronco · ${props.viewName}`} className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-slate-900">
    <h5 className="font-semibold">2. Selecciona corteza y líquenes por color</h5>
    <p className="my-2">Marca ejemplos dentro del tronco. La selección se actualiza automáticamente, sin esperar a la IA.</p>
    <button type="button" className={BUTTON} aria-expanded={open} disabled={props.disabled} onClick={() => setOpen(!open)}>{open ? "Cerrar cuentagotas" : "Abrir cuentagotas"}</button>
    {open ? <ColorWorkspace key={colorStorageKey(props.identity, props.points)} {...props} /> : null}
  </section>;
}

function ColorWorkspace({ src, viewName, points, identity, disabled }: Props) {
  const key = colorStorageKey(identity, points);
  const [config, setConfig] = useState<ColorConfig>(initialColorConfig);
  const [hydrated, setHydrated] = useState(false);
  const [pixels, setPixels] = useState<Pixels | null>(null);
  const [result, setResult] = useState<ColorResult | null>(null);
  const [target, setTarget] = useState<ColorClass>(2);
  const [status, setStatus] = useState("Cargando la fotografía…");
  const [warning, setWarning] = useState<string | null>(null);
  const [show, setShow] = useState(true);
  const [opacity, setOpacity] = useState(40);
  const [reviewed, setReviewed] = useState(false);
  const [clearRequested, setClearRequested] = useState(false);
  const [cursor, setCursor] = useState({ x: .5, y: .5 });
  const [keyboard, setKeyboard] = useState(false);
  const overlay = useRef<HTMLCanvasElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const generation = useRef(0);

  useEffect(() => {
    try { setConfig(parseColorConfig(window.localStorage.getItem(key)) ?? initialColorConfig()); }
    catch { setWarning("El navegador no permite recuperar tus muestras guardadas."); }
    setHydrated(true);
  }, [key]);

  const edit = (next: ColorConfig) => {
    generation.current++; setConfig(next); setResult(null); setReviewed(false); setWarning(null);
    try { window.localStorage.setItem(key, JSON.stringify(next)); }
    catch { setWarning("Muestras activas, pero no se pudieron guardar. No cierres esta pestaña."); }
  };

  useEffect(() => {
    if (!hydrated || !pixels) return;
    const controller = new AbortController(), current = ++generation.current;
    setResult(null); setReviewed(false);
    if (!config.samples.some(s => s.label === 2) || !config.samples.some(s => s.label >= 3)) {
      setStatus("Marca al menos una muestra de corteza y una de liquen para comenzar.");
      return;
    }
    setStatus("Buscando colores parecidos dentro del tronco…");
    const timer = setTimeout(() => {
      void classifyTrunkColors(pixels.rgba, pixels.width, pixels.height, points, config, controller.signal).then(next => {
        if (controller.signal.aborted || current !== generation.current) return;
        setResult(next); setStatus("Selección actualizada. Revisa las zonas coloreadas antes de confirmar.");
        // Review is tied to exact settings, grid and classified pixels, not just
        // a percentage. Recompute on reload instead of persisting large masks.
        try { setReviewed(window.localStorage.getItem(`${key}:review`) === resultSignature(next, config, pixels)); }
        catch { setReviewed(false); }
      }).catch((error: unknown) => {
        if (!controller.signal.aborted && current === generation.current) setStatus(error instanceof Error ? error.message : "No se pudo calcular la selección por colores.");
      });
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [hydrated, pixels, points, config, key]);

  useEffect(() => {
    const canvas = overlay.current;
    if (!canvas || !pixels) return;
    canvas.width = pixels.width; canvas.height = pixels.height;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, pixels.width, pixels.height);
    if (!result || !show) return;
    const data = ctx.createImageData(pixels.width, pixels.height);
    result.labels.forEach((code, i) => {
      if (!code) return;
      const rgb = OVERLAY_RGB[code - 1];
      data.data[i * 4] = rgb[0]; data.data[i * 4 + 1] = rgb[1]; data.data[i * 4 + 2] = rgb[2];
      data.data[i * 4 + 3] = Math.round(255 * opacity / 100);
    });
    ctx.putImageData(data, 0, 0);
  }, [pixels, result, show, opacity]);

  const pick = (x: number, y: number) => {
    if (!pixels || disabled || !hydrated) return;
    if (config.samples.length >= MAX_COLOR_SAMPLES) { setWarning("Ya tienes 24 muestras. Elimina alguna antes de añadir otra."); return; }
    const sample = sampleColor(pixels.rgba, pixels.width, pixels.height, pixels.roi, x, y, target);
    if (!sample) { setWarning("Haz clic dentro del contorno azul del tronco."); return; }
    edit({ ...config, samples: [...config.samples, sample] });
  };
  const percent = (n: number) => result?.total ? `${(100 * n / result.total).toFixed(1)} %` : "—";

  return <div className="mt-4">
    <p className="mb-3 text-sm">Elige una herramienta y toca un ejemplo en la foto. Añade varias muestras del mismo material si cambia con la luz. Los tonos 1, 2 y 3 son grupos de color, no especies.</p>
    <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Material del cuentagotas">
      {([2, 3, 4, 5] as ColorClass[]).map(label => <button type="button" key={label} className={`${BUTTON} ${target === label ? "!border-emerald-800 !bg-emerald-100" : ""}`} aria-pressed={target === label} disabled={disabled} onClick={() => setTarget(label)}>{COLOR_NAMES[label - 1]}</button>)}
    </div>
    <p className="mb-2 text-sm font-medium">Cuentagotas activo: {COLOR_NAMES[target - 1]}. {config.samples.length}/{MAX_COLOR_SAMPLES} muestras.</p>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(250px,1fr)]">
      <div>
        <div ref={surface} className="relative mx-auto w-fit max-w-full cursor-crosshair overflow-hidden rounded-lg bg-slate-200 outline-offset-2 focus-visible:outline-2 focus-visible:outline-emerald-800" tabIndex={0} role="group" aria-label={`Tomar muestra de color · ${viewName}`}
          onClick={event => { const box = surface.current?.getBoundingClientRect(); if (box?.width && box.height) { setKeyboard(false); pick((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height); } }}
          onKeyDown={event => {
            const steps: Record<string, [number, number]> = { ArrowLeft: [-.005, 0], ArrowRight: [.005, 0], ArrowUp: [0, -.005], ArrowDown: [0, .005] };
            if (steps[event.key]) { event.preventDefault(); setKeyboard(true); const [dx, dy] = steps[event.key]; setCursor(p => ({ x: Math.max(0, Math.min(.999, p.x + dx * (event.shiftKey ? 5 : 1))), y: Math.max(0, Math.min(.999, p.y + dy * (event.shiftKey ? 5 : 1))) })); }
            else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setKeyboard(true); pick(cursor.x, cursor.y); }
          }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`Muestras de color de ${viewName}`} draggable={false} className="block h-auto max-h-[65vh] w-auto max-w-full"
            onError={() => { generation.current++; setPixels(null); setResult(null); setReviewed(false); setStatus("No se pudo abrir esta fotografía para muestrear colores."); }}
            onLoad={event => {
              try {
                const image = event.currentTarget, size = colorWorkingSize(image.naturalWidth, image.naturalHeight);
                const canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                if (!ctx) throw new Error("El navegador no permite leer los colores de esta fotografía.");
                ctx.drawImage(image, 0, 0, size.width, size.height);
                const rgba = ctx.getImageData(0, 0, size.width, size.height).data;
                setPixels({ ...size, rgba, roi: rasterizeTrunk(points, size.width, size.height) });
              } catch { generation.current++; setPixels(null); setResult(null); setReviewed(false); setStatus("No se pudo preparar la foto para el cuentagotas. La fotografía original sigue intacta."); }
            }} />
          <canvas ref={overlay} aria-label="Selección de color sobre el tronco" className="pointer-events-none absolute inset-0 h-full w-full" />
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            <polygon points={points.map(p => `${p.x * 1000},${p.y * 1000}`).join(" ")} fill="none" stroke="#0284c7" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {config.samples.map((s, i) => <g key={i}><circle cx={s.x * 1000} cy={s.y * 1000} r="9" fill={`rgb(${OVERLAY_RGB[s.label - 1].join(",")})`} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" /><text x={s.x * 1000 + 12} y={s.y * 1000} fill="white" stroke="#0f172a" strokeWidth=".5" fontSize="24">{i + 1}</text></g>)}
            {keyboard ? <circle cx={cursor.x * 1000} cy={cursor.y * 1000} r="15" fill="none" stroke="#ef4444" strokeWidth="3" vectorEffect="non-scaling-stroke" /> : null}
          </svg>
        </div>
        <p className="mt-2 text-xs">Teclado: enfoca la foto, mueve el cursor con las flechas y pulsa Enter para tomar una muestra. Shift mueve más rápido.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />Mostrar selección por colores</label>
          <label>Opacidad <input aria-label="Opacidad de colores" type="range" min="10" max="80" value={opacity} onChange={e => setOpacity(Number(e.target.value))} /> {opacity} %</label>
        </div>
      </div>
      <div className="min-w-0 rounded-lg border border-emerald-200 bg-white p-4">
        <label className="block font-medium">Variación de color permitida: {config.tolerance}<input className="mt-2 block w-full" aria-label="Variación de color permitida" type="range" min="3" max="35" step="1" value={config.tolerance} disabled={disabled || !hydrated} onChange={e => edit({ ...config, tolerance: Number(e.target.value) })} /></label>
        <p className="mt-1 text-xs">Menor: más estricto. Mayor: incluye tonos más diferentes. Si compiten dos grupos parecidos, la zona queda sin clasificar.</p>
        <p className="my-3 text-sm" role="status">{status}</p>
        {warning ? <p className="my-3 text-sm text-amber-900" role="alert">{warning}</p> : null}
        <h6 className="font-semibold">Cobertura {reviewed ? "revisada por color" : "provisional por color"}</h6>
        <p className="mt-2 text-2xl font-bold text-emerald-900">Líquenes: {result ? percent(result.lichen) : "—"}</p>
        <div className="my-3 space-y-1" aria-label="Desglose por color">{COLOR_NAMES.map((name, i) => <p className="flex items-center justify-between gap-3" key={name}><span><span className="mr-2 inline-block h-3 w-3 rounded" style={{ backgroundColor: `rgb(${OVERLAY_RGB[i].join(",")})` }} />{name}</span><span>{result ? percent(result.counts[i + 1]) : "—"}</span></p>)}</div>
        {result && result.total > 0 && result.counts[1] / result.total > .2 ? <p className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-950">Queda {percent(result.counts[1])} sin clasificar. Añade ejemplos de las zonas que faltan; no asumas que son corteza. La cobertura puede estar subestimada.</p> : null}
        <p className="text-xs">Porcentaje del área visible delimitada, en una copia de hasta 1024 px. Cada píxel cuenta una sola vez; «sin clasificar» sigue en el denominador. No es superficie real, identificación de especie ni calidad del aire.</p>
        <button type="button" className={`${BUTTON} mt-3 w-full`} disabled={!result?.total || reviewed || disabled} onClick={() => {
          if (!result || !pixels) return;
          try { window.localStorage.setItem(`${key}:review`, resultSignature(result, config, pixels)); setReviewed(true); }
          catch { setWarning("No se pudo guardar la revisión. La selección sigue disponible aquí."); }
        }}>{reviewed ? "Revisión por color guardada" : "Revisé la selección por color"}</button>
        <p className="mt-2 text-xs">Confirma solo después de comprobar las zonas marcadas. Cambiar muestras, tolerancia o contorno exige nueva revisión. No modifica tus decisiones de MobileSAM/BioCLIP ni se suma a su cobertura.</p>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2" aria-label="Muestras de color guardadas">{config.samples.map((s, i) => <button key={i} className={BUTTON} type="button" disabled={disabled} title="Eliminar esta muestra" aria-label={`Eliminar muestra ${i + 1}: ${COLOR_NAMES[s.label - 1]}`} onClick={() => edit({ ...config, samples: config.samples.filter((_, n) => n !== i) })}><span className="mr-2 inline-block h-4 w-4 rounded border border-slate-400 align-middle" style={{ backgroundColor: `rgb(${s.rgb.join(",")})` }} />{i + 1}. {COLOR_NAMES[s.label - 1]} ×</button>)}</div>
    {config.samples.length ? <button type="button" className={`${BUTTON} mt-3`} disabled={disabled} onClick={() => setClearRequested(true)}>Borrar muestras de esta foto</button> : null}
    {clearRequested ? <div className="mt-2 flex flex-wrap items-center gap-2" role="alert"><span>¿Borrar todas las muestras de color de esta foto?</span><button type="button" className={BUTTON} onClick={() => setClearRequested(false)}>Conservar muestras</button><button type="button" className={BUTTON} disabled={disabled} onClick={() => { edit(initialColorConfig()); setClearRequested(false); }}>Confirmar borrado de muestras</button></div> : null}
    <p className="mt-3 text-xs">Las muestras y esta revisión se guardan solo en este navegador. Si ajustas el contorno, comienza una nueva selección de colores. El original y las regiones de IA permanecen intactos.</p>
  </div>;
}

function resultSignature(result: ColorResult, config: ColorConfig, pixels: Pick<Pixels, "width" | "height">): string {
  let hash = 2166136261;
  for (const code of result.labels) hash = Math.imul(hash ^ code, 16777619) >>> 0;
  // Canonical property order also after validated JSON restoration.
  const canonical = { version: config.version, tolerance: config.tolerance,
    samples: config.samples.map(s => ({ x: s.x, y: s.y, label: s.label, rgb: s.rgb })) };
  return JSON.stringify({ config: canonical, width: pixels.width, height: pixels.height, counts: result.counts, hash });
}

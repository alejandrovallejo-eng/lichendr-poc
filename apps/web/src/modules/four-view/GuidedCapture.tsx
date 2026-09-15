"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DIRECTIONS, DIRECTION_LABELS, type Direction } from "./types";
import type { GuidedContext, GuidedSession, GuidedServices } from "./guided-flow";
import { analysisRecord, checkLichenSamples, guidedKey, parseGuidedReview, type GuidedReview } from "./guided-flow";
import { classifyTrunkColors, colorWorkingSize, initialColorConfig, OVERLAY_RGB, rgbToLab, sampleColor,
  type ColorConfig, type ColorClass, type ColorResult } from "../region-suggestions/trunk-colors";
import { rasterizeTrunk, trunkOutlineError, type TrunkPoint } from "../region-suggestions/trunk-outline";
import { orderedCloudWriter, reviewFingerprint, type CloudReview } from "./guided-cloud";

const fresh = (): GuidedReview => ({ version: 1, outline: [], config: initialColorConfig(), analysis: null, savedAt: null });
const STEPS = ["Foto", "Tronco", "Colores", "Análisis", "Guardar"];
type Pixels = { width: number; height: number; rgba: Uint8ClampedArray };
interface Props {
  context: GuidedContext;
  contextLabel: string;
  backHref: string;
  services: GuidedServices;
  checkSamples?: typeof checkLichenSamples;
}
const message = (e: unknown) => e instanceof Error ? e.message : "No se pudo completar este paso. Reintenta.";

// One mounted photograph and one active step. Never render four editors or
// launch legacy four-view calibration behind this screen.
export function GuidedCapture({ context, contextLabel, backHref, services, checkSamples = checkLichenSamples }: Props) {
  const [session, setSession] = useState<GuidedSession | null>(null);
  const [direction, setDirection] = useState<Direction>("N");
  const [step, setStep] = useState(0);
  const [review, setReview] = useState<GuidedReview>(fresh);
  const [src, setSrc] = useState("");
  const [pixels, setPixels] = useState<Pixels | null>(null);
  const [result, setResult] = useState<ColorResult | null>(null);
  const [overlay, setOverlay] = useState("");
  const [showOverlay, setShowOverlay] = useState(true);
  const [busy, setBusy] = useState("Recuperando esta captura…");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Partial<Record<Direction, boolean>>>({});
  const [finished, setFinished] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [cloudStatus, setCloudStatus] = useState("");
  const [recovery, setRecovery] = useState<GuidedReview | null>(null);
  const [cursor, setCursor] = useState<TrunkPoint>({ x: .5, y: .5 });
  const [keyboard, setKeyboard] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const lock = useRef(false);
  const drag = useRef<number | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const screen = useRef<HTMLElement>(null);
  const cloudWriter = useRef<((value: GuidedReview) => Promise<CloudReview>) | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCloud = useRef("");
  const latestReview = useRef(review);
  const imageId = session?.views[direction];
  const key = session?.treeSampleId && imageId ? guidedKey(session.ownerId, session.treeSampleId, direction, imageId) : null;
  const currentKey = useRef(key); currentKey.current = key;
  const name = DIRECTION_LABELS[direction];
  const contextId = `${context.projectId}:${context.siteId}:${context.eventId}:${context.treeId}`;

  useEffect(() => {
    // The full-screen editor replaces (rather than sits in the tab order of)
    // the underlying dashboard. Preserve and restore each previous inert state.
    const previous: Array<[HTMLElement, boolean]> = [];
    let node: HTMLElement | null = screen.current;
    while (node?.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling !== node && sibling instanceof HTMLElement) { previous.push([sibling,sibling.inert]); sibling.inert=true; }
      }
      node=node.parentElement;
      if (node===document.body) break;
    }
    const overflow=document.body.style.overflow; document.body.style.overflow="hidden";
    return () => { previous.forEach(([element,inert])=>{element.inert=inert;});document.body.style.overflow=overflow; };
  }, []);

  useEffect(() => {
    let active = true;
    services.load(context).then(data => {
      if (!active) return;
      setSession(data);
      setSaved(data.savedViews ?? {});
      setBusy("");
    }).catch(e => { if (active) { setError(message(e)); setBusy(""); } });
    return () => { active = false; generation.current++; controller.current?.abort(); if (draftTimer.current) clearTimeout(draftTimer.current); };
    // The parent keys this component by the complete context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId, services]);

  useEffect(() => {
    if (!session || !imageId || !key) return;
    let active = true, objectUrl = "";
    const current = ++generation.current;
    controller.current?.abort();
    setBusy("Abriendo la fotografía y su revisión…"); setError(""); setPixels(null); setSrc(""); setResult(null); setOverlay("");
    cloudWriter.current = null; lastCloud.current = ""; setRecovery(null); setCloudStatus("");
    const reference = { ownerId: session.ownerId, treeSampleId: session.treeSampleId, direction, imageId };
    Promise.all([services.photo(session.ownerId, imageId), services.cloud.read(reference)]).then(([blob, remote]) => {
      if (!active || generation.current !== current) return;
      let local: GuidedReview | null = null;
      try { local = parseGuidedReview(localStorage.getItem(key)); } catch { /* Cloud does not depend on local storage. */ }
      const restored = remote?.review ?? (local ? { ...local, savedAt: null } : fresh());
      cloudWriter.current = orderedCloudWriter(services.cloud, reference, remote?.revision ?? 0);
      lastCloud.current = remote ? reviewFingerprint(remote.review) : "";
      latestReview.current = restored; setReview(restored);
      setSaved(prev => ({ ...prev, [direction]: Boolean(remote?.review.savedAt) }));
      setCloudStatus(remote ? "Guardado en la nube ✓" : local ? "Borrador local pendiente de sincronizar" : "");
      if (remote && local && reviewFingerprint(local) !== reviewFingerprint(remote.review)) {
        setRecovery(local);
        try { localStorage.setItem(`${key}:recovery`, JSON.stringify(local)); } catch { /* Retained in memory. */ }
      }
      objectUrl = URL.createObjectURL(blob); setSrc(objectUrl); setBusy("");
    }).catch(e => { if (active && generation.current === current) { setError(message(e)); setBusy(""); } });
    return () => { active = false; if (draftTimer.current) clearTimeout(draftTimer.current); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    // Do not reopen the photograph just because another session field changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, key, services, loadAttempt]);

  useEffect(() => { title.current?.focus(); }, [step, direction, finished]);
  useEffect(() => {
    // Restore the visible mask from the stored colours, without another AI call.
    if (!pixels || !review.analysis || result) return;
    const abort = new AbortController();
    void classifyTrunkColors(pixels.rgba, pixels.width, pixels.height, review.outline,
      review.config, abort.signal, "lichen-only").then(restored => {
      if (abort.signal.aborted) return;
      if (reviewFingerprint(restored.counts) !== reviewFingerprint(review.analysis?.counts)) {
        setError("La imagen de análisis cambió. Recalcula la selección antes de confirmar su cobertura.");
        const invalidated = { ...review, analysis: null, savedAt: null };
        latestReview.current = invalidated; setReview(invalidated);
        setSaved(s => ({ ...s, [direction]: false }));
        return;
      }
      setResult(restored);
    }).catch(e => { if (!abort.signal.aborted) setError(message(e)); });
    return () => abort.abort();
  }, [pixels, review.analysis, review.outline, review.config, result, direction]);
  useEffect(() => {
    if (!result || !pixels) { setOverlay(""); return; }
    const canvas = document.createElement("canvas"); canvas.width = pixels.width; canvas.height = pixels.height;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const data = ctx.createImageData(pixels.width, pixels.height);
    result.labels.forEach((code, i) => {
      if (code < 3) return;
      const color = OVERLAY_RGB[code - 1]; data.data.set([...color, 125], i * 4);
    });
    ctx.putImageData(data, 0, 0); setOverlay(canvas.toDataURL());
  }, [result, pixels]);

  const persist = (next: GuidedReview) => {
    if (!key) throw new Error("La fotografía debe terminar de guardarse primero.");
    latestReview.current = next;
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* The cloud save remains authoritative. */ }
  };
  const sync = async (next: GuidedReview) => {
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    const writer = cloudWriter.current, targetKey = key;
    if (!writer || !targetKey) throw new Error("Espera a que se abra la revisión de esta fotografía.");
    setCloudStatus("Guardando en la nube…");
    try {
      const row = await writer(next);
      if (currentKey.current === targetKey) {
        lastCloud.current = reviewFingerprint(row.review);
        if (reviewFingerprint(latestReview.current) === lastCloud.current) setCloudStatus("Guardado en la nube ✓");
      }
      return row;
    } catch (e) {
      if (currentKey.current === targetKey) setCloudStatus("Sin sincronizar: borrador conservado aquí");
      throw e;
    }
  };
  const edit = (outline: TrunkPoint[], config: ColorConfig) => {
    controller.current?.abort(); generation.current++; setResult(null); setError("");
    const next: GuidedReview = { version: 1, outline, config, analysis: null, savedAt: null };
    setReview(next); setSaved(prev => ({ ...prev, [direction]: false }));
    persist(next); setCloudStatus("Cambios pendientes de guardar…");
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => { void sync(next).catch(e => setError(message(e))); }, 750);
  };
  const openView = (d: Direction) => {
    if (d === direction && !finished) return;
    if (d === direction) setLoadAttempt(n => n + 1);
    controller.current?.abort(); generation.current++;
    setDirection(d); setStep(0); setFinished(false); setReview(fresh()); setResult(null); setPixels(null); setSrc(""); setError("");
  };
  const switchView = async (d: Direction) => {
    if (lock.current || busy || (d === direction && !finished)) return;
    lock.current = true; setBusy("Guardando antes de cambiar de vista…");
    try {
      if (key && reviewFingerprint(latestReview.current) !== lastCloud.current) await sync(latestReview.current);
      openView(d);
    } catch (e) { setError(message(e)); }
    finally { lock.current = false; setBusy(""); }
  };
  const upload = async (file: File) => {
    if (!session || lock.current || session.completed) return;
    if (imageId && !window.confirm(`¿Reemplazar la fotografía de ${name}? Su revisión no se aplicará a la nueva imagen.`)) return;
    if (!/\.(jpe?g|png|heic|heif)$/i.test(file.name) || file.size > 20 * 1024 * 1024) { setError("Usa JPEG, PNG o HEIC de hasta 20 MB."); return; }
    lock.current = true; setBusy("Guardando la fotografía original…"); setError("");
    const current = ++generation.current;
    try {
      const stored = await services.upload(context, direction, file, crypto.randomUUID());
      if (current !== generation.current) return;
      setSession(s => s && ({ ...s, treeSampleId: stored.treeSampleId, views: { ...s.views, [direction]: stored.imageId } }));
      setReview(fresh()); setSaved(s => ({ ...s, [direction]: false })); setStep(1);
    } catch (e) { if (current === generation.current) setError(message(e)); }
    finally { lock.current = false; if (current === generation.current) setBusy(""); }
  };
  const pick = (point: TrunkPoint) => {
    if (!pixels || busy || lock.current) return;
    if (step === 1) {
      if (review.outline.length >= 64) { setError("Ya hay 64 puntos. Deshaz uno antes de añadir otro."); return; }
      edit([...review.outline, point], initialColorConfig());
    } else if (step === 2) {
      if (review.config.samples.length >= 6) { setError("Seis ejemplos son suficientes para esta pasada. Puedes quitar uno tocando su color."); return; }
      const roi = rasterizeTrunk(review.outline, pixels.width, pixels.height);
      const sample = sampleColor(pixels.rgba, pixels.width, pixels.height, roi, point.x, point.y, 3);
      if (!sample) { setError("Toca un liquen dentro del contorno del tronco."); return; }
      const lab = rgbToLab(sample.rgb);
      const closest = review.config.samples.map(s => ({ label: s.label, distance: Math.hypot(...rgbToLab(s.rgb).map((v, i) => v - lab[i])) })).sort((a, b) => a.distance - b.distance)[0];
      sample.label = closest?.distance < 12 ? closest.label : Math.min(5, 3 + new Set(review.config.samples.map(s => s.label)).size) as ColorClass;
      edit(review.outline, { ...review.config, samples: [...review.config.samples, sample] });
    }
  };
  const analyse = async () => {
    if (!session || !pixels || !imageId || lock.current) return;
    lock.current = true; const current = ++generation.current;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    // 150 s cold start + 120 s inference fit inside the route's 300 s budget.
    const timeout = setTimeout(() => abort.abort(), 285_000);
    setStep(3); setBusy("Calculando cobertura y consultando BioCLIP…"); setError(""); setResult(null);
    try {
      const colors = await classifyTrunkColors(pixels.rgba, pixels.width, pixels.height, review.outline, review.config, abort.signal, "lichen-only");
      if (current !== generation.current) return;
      if (!colors.total) throw new Error("El contorno no incluye píxeles analizables.");
      setResult(colors);
      const partial = { ...review, savedAt: null, analysis: analysisRecord(colors, pixels.width, pixels.height, null) };
      setReview(partial); persist(partial);
      await sync(partial);
      if (current !== generation.current) return;
      setBusy("Preparando la IA y revisando tus ejemplos. El primer análisis puede tardar unos dos minutos…");
      const ai = await checkSamples({ imageId, treeSampleId: session.treeSampleId, direction }, review.outline, review.config, pixels.width, pixels.height, abort.signal);
      if (current !== generation.current) return;
      if (ai.context.imageId !== imageId || ai.context.treeSampleId !== session.treeSampleId || ai.context.direction !== direction || !ai.suggestions.length)
        throw new Error("La respuesta de IA no corresponde a esta fotografía.");
      const next = { ...partial, analysis: analysisRecord(colors, pixels.width, pixels.height, ai) };
      setReview(next); persist(next); await sync(next);
      if (current === generation.current) setStep(4);
    } catch (e) { if (current === generation.current) setError(abort.signal.aborted ? "La IA tardó demasiado. Tus colores y la estimación se conservaron. Puedes reintentar o revisar sin IA." : message(e)); }
    finally { clearTimeout(timeout); if (current === generation.current) { lock.current = false; setBusy(""); } }
  };
  const save = async () => {
    if (!review.analysis || lock.current || busy) return;
    lock.current = true; setBusy("Confirmando el guardado en la nube…"); setError("");
    try {
      const next = { ...review, savedAt: new Date().toISOString() }; persist(next); setReview(next);
      await sync(next);
      const complete = { ...saved, [direction]: true }; setSaved(complete);
      const nextView = DIRECTIONS[DIRECTIONS.indexOf(direction) + 1] ?? DIRECTIONS.find(d => !complete[d]);
      if (nextView) openView(nextView); else setFinished(true);
    } catch (e) { setError(`No avanzamos a la siguiente foto. ${message(e)}`); }
    finally { lock.current = false; setBusy(""); }
  };
  const a = review.analysis;
  const percent = a ? (100 * a.lichen / a.total).toFixed(1) : "—";
  const matching = a?.ai?.suggestions.filter(s => s.ranking?.[0]?.label === "lichen").length ?? 0;
  const photoWidth = pixels?.width ?? 1000, photoHeight = pixels?.height ?? 1000;
  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), scale = Math.min(box.width / photoWidth, box.height / photoHeight);
    const left = box.left + (box.width - photoWidth * scale) / 2, top = box.top + (box.height - photoHeight * scale) / 2;
    const x = (event.clientX - left) / (photoWidth * scale), y = (event.clientY - top) / (photoHeight * scale);
    return x >= 0 && y >= 0 && x < 1 && y < 1 ? { x, y } : null;
  };
  const leave = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (busy || (reviewFingerprint(latestReview.current) !== lastCloud.current && review.outline.length && !window.confirm("Hay cambios pendientes de sincronizar. El borrador queda aquí. ¿Volver a la jornada?"))) event.preventDefault();
  };

  return <section ref={screen} aria-label="Captura paso a paso" className="guided-capture" style={{ position: "fixed", inset: 0, zIndex: 60, background: "#f4f7f5", color: "#172e25", display: "grid", gridTemplateRows: "auto auto minmax(0,1fr) auto", height: "100dvh" } as CSSProperties}>
    <style>{`.guided-capture *{box-sizing:border-box}.guided-capture button,.guided-capture .g-upload{min-height:44px;border:1px solid #cbd8d0;border-radius:10px;padding:8px 14px;background:white;color:#173d2d;font:inherit;cursor:pointer}.guided-capture button:disabled{opacity:.45;cursor:default}.guided-capture button:focus-visible,.guided-capture a:focus-visible,.guided-capture svg:focus-visible{outline:3px solid #e1b752;outline-offset:2px}.guided-capture .g-primary{background:#00674d;color:white;border-color:#00674d;font-weight:700}.guided-capture .g-main{display:grid;grid-template-columns:minmax(0,1fr) 290px;min-height:0;gap:16px;padding:16px}.guided-capture .g-tools{overflow:auto;min-height:0;padding:16px;border-radius:16px;background:white;display:flex;flex-direction:column;gap:14px}.guided-capture .g-photo{min-height:0;position:relative;background:#e6ece8;border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center}.guided-capture .g-steps{display:flex;justify-content:center;gap:6px;padding:8px}.guided-capture .g-steps span{padding:5px 12px;border-radius:20px;font-size:13px}.guided-capture p{margin:0}.guided-capture footer{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 20px;background:white;border-top:1px solid #d6e0d9}.guided-capture .g-context{max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.guided-capture .g-heading{font-size:21px;margin:0}.guided-capture .g-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:700px){.guided-capture .g-main{grid-template-columns:1fr;grid-template-rows:minmax(120px,1fr) auto;padding:8px;gap:8px}.guided-capture .g-tools{max-height:210px;gap:8px;padding:12px}.guided-capture .g-steps span{padding:4px 6px;font-size:11px}.guided-capture footer{padding:8px;font-size:13px}.guided-capture .g-context{max-width:60vw}.guided-capture .g-heading{font-size:18px}}`}</style>
    <header style={{ padding: "12px 20px 4px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
      <div><p className="g-context" title={contextLabel}>{contextLabel}</p><h1 className="g-heading" ref={title} tabIndex={-1}>{finished ? "Las cuatro vistas están guardadas" : `${name} · ${DIRECTIONS.indexOf(direction) + 1} de 4`}</h1></div>
      <a href={backHref} onClick={leave} style={{ fontSize: 13 }}>Volver a la jornada</a>
    </header>
    <nav className="g-steps" aria-label="Pasos de esta fotografía">{STEPS.map((label, i) => <span key={label} aria-current={i === step ? "step" : undefined} style={{ background: i === step ? "#d1eadc" : "transparent", fontWeight: i === step ? 700 : 400 }}>{i + 1}. {label}</span>)}</nav>
    {finished ? <main className="g-main" style={{ display: "flex", justifyContent: "center", alignItems: "center" }}><div className="g-tools" style={{ maxWidth: 540 }}><h2>Listo por hoy</h2><p>Fotografías, contornos, colores y revisiones guardados en la nube, dentro de tu proyecto y jornada.</p><p>Estos porcentajes describen el tronco visible; no son una medición de superficie real ni de calidad del aire.</p>{DIRECTIONS.map(d => <button key={d} onClick={() => void switchView(d)}>Revisar {DIRECTION_LABELS[d]} ✓</button>)}</div></main> : <main className="g-main">
      <div className="g-photo">
        {src ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="g-hidden" src={src} alt="" onError={() => setError("No se pudo mostrar la copia de análisis. Reintenta abrir la foto.")} onLoad={event => {
            try {
              const image = event.currentTarget, size = colorWorkingSize(image.naturalWidth, image.naturalHeight);
              const canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
              const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) throw new Error("No se pueden leer los colores en este navegador.");
              ctx.drawImage(image, 0, 0, size.width, size.height); setPixels({ ...size, rgba: ctx.getImageData(0, 0, size.width, size.height).data });
            } catch (e) { setError(message(e)); }
          }} />
          <svg role="group" aria-label={`Fotografía de ${name}: ${step === 1 ? "delimitar tronco" : step === 2 ? "elegir colores de liquen" : "vista previa"}`} tabIndex={0} viewBox={`0 0 ${photoWidth} ${photoHeight}`} style={{ width: "100%", height: "100%", touchAction: "none", cursor: step === 1 || step === 2 ? "crosshair" : "default" }}
            onPointerDown={event => {
              if (busy || (step !== 1 && step !== 2)) return;
              const p = pointFromEvent(event); if (!p) return; setKeyboard(false);
              const found = step === 1 ? review.outline.findIndex(v => Math.hypot((p.x-v.x)*photoWidth,(p.y-v.y)*photoHeight) < 13) : -1;
              if (found >= 0) { drag.current = found; event.currentTarget.setPointerCapture(event.pointerId); } else pick(p);
            }} onPointerMove={event => {
              if (drag.current === null || busy || step !== 1) return;
              const p = pointFromEvent(event); if (p) edit(review.outline.map((v, i) => i === drag.current ? p : v), initialColorConfig());
            }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
            onKeyDown={event => {
              if (busy || (step !== 1 && step !== 2)) return;
              const moves: Record<string, number[]> = { ArrowLeft: [-.01,0], ArrowRight: [.01,0], ArrowUp: [0,-.01], ArrowDown: [0,.01] };
              if (moves[event.key]) { event.preventDefault(); setKeyboard(true); const [x,y] = moves[event.key]; setCursor(p => ({x:Math.max(0,Math.min(.999,p.x+x)), y:Math.max(0,Math.min(.999,p.y+y))})); }
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(cursor); }
            }}>
            <image href={src} width={photoWidth} height={photoHeight} />
            {showOverlay && overlay && step >= 3 ? <image href={overlay} width={photoWidth} height={photoHeight} /> : null}
            {review.outline.length ? <polygon points={review.outline.map(p => `${p.x*photoWidth},${p.y*photoHeight}`).join(" ")} fill={step === 1 ? "#009cda22" : "none"} stroke="#00b8ff" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null}
            {step === 1 ? review.outline.map((p,i) => <circle key={i} cx={p.x*photoWidth} cy={p.y*photoHeight} r="6" fill="#00b8ff" stroke="white" strokeWidth="2" />) : null}
            {step >= 2 ? review.config.samples.map((s,i) => <circle key={i} cx={s.x*photoWidth} cy={s.y*photoHeight} r="7" fill={`rgb(${s.rgb.join(",")})`} stroke="#00ffff" strokeWidth="3" />) : null}
            {keyboard ? <circle cx={cursor.x*photoWidth} cy={cursor.y*photoHeight} r="10" fill="none" stroke="yellow" strokeWidth="2" /> : null}
          </svg>
        </> : <div style={{ padding: 28, textAlign: "center" }}>{busy || "Sube una fotografía para comenzar"}</div>}
      </div>
      <aside className="g-tools" aria-label="Herramientas del paso actual">
        <h2 style={{ fontSize: 19, margin: 0 }}>{["Sube la foto", "Delimita el tronco", "Toca colores de liquen", busy ? "Analizando tu selección" : "Revisar estimación", "Revisa y guarda"][step]}</h2>
        {step === 0 ? <><p>Una fotografía por orientación. Empezamos con {name.toLowerCase()}.</p><label className="g-upload">{imageId ? "Reemplazar fotografía" : "Elegir fotografía"}<input aria-label={`Subir foto de ${name}`} type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif" className="g-hidden" disabled={!!busy || !session || session.completed} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /></label>{imageId ? <p style={{ fontSize: 13 }}>Original guardado ✓</p> : null}{saved[direction] ? <p>Esta vista ya tiene una revisión guardada.</p> : null}</> : null}
        {step === 1 ? <><p>Toca puntos alrededor del tronco, incluyendo los líquenes. El fondo queda fuera.</p><p style={{ fontSize: 13 }}>Arrastra un punto para ajustar el borde.</p><button disabled={!!busy || !review.outline.length} onClick={() => edit(review.outline.slice(0,-1), initialColorConfig())}>Deshacer punto</button><p style={{ fontSize: 12 }}>{review.outline.length} puntos · mínimo 3</p></> : null}
        {step === 2 ? <><p>Toca únicamente los líquenes: un ejemplo de cada color o iluminación. No selecciones colores de corteza.</p><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{review.config.samples.map((s,i) => <button key={i} aria-label={`Quitar color ${i+1}`} title={`Quitar color ${i+1}`} onClick={() => edit(review.outline,{...review.config,samples:review.config.samples.filter((_,n)=>n!==i)})} style={{ width: 44, padding: 4 }}><span style={{ display:"block",width:25,height:25,borderRadius:20,background:`rgb(${s.rgb.join(",")})`,border:"1px solid #777",margin:"auto" }} /></button>)}</div><p style={{ fontSize: 12 }}>{review.config.samples.length}/6 ejemplos · toca un color para quitarlo</p><label style={{ fontSize: 13 }}>Incluir colores similares<input aria-label="Variación de color" style={{ width: "100%" }} type="range" min="3" max="35" value={review.config.tolerance} onChange={e => edit(review.outline,{...review.config,tolerance:Number(e.target.value)})} /></label></> : null}
        {step >= 3 && a ? <><p style={{ fontSize: 13 }}>Cobertura estimada por tus colores</p><p style={{ fontSize: 36, fontWeight: 750 }}>{percent} %</p><p style={{ fontSize: 13 }}>{(100*(a.total-a.lichen)/a.total).toFixed(1)} % restante sin clasificar; no se asume corteza.</p><label style={{ fontSize: 13 }}><input type="checkbox" checked={showOverlay} onChange={e=>setShowOverlay(e.target.checked)} /> Mostrar selección</label>{a.ai ? <p style={{ fontSize: 13 }}>BioCLIP sugiere liquen en {matching}/{a.ai.suggestions.length} ejemplos. {matching < a.ai.suggestions.length ? "Hay diferencias: comprueba los colores antes de guardar." : "Comprueba igualmente la selección."}</p> : <p style={{ fontSize: 13 }}>Sin revisión de IA.</p>}<p style={{ fontSize: 11 }}>El porcentaje se calcula por color dentro del contorno. La IA revisa recortes de ejemplo, no identifica especies ni valida todos los píxeles.</p></> : null}
        {step === 4 ? <p style={{ fontSize: 12 }}>Al guardar confirmas la selección visible y su revisión en la nube. Después se abre la siguiente orientación.</p> : null}
        {cloudStatus ? <p role="status" style={{ fontSize: 12 }}>{cloudStatus}</p> : null}
        {recovery ? <button disabled={!!busy} onClick={() => { const draft = { ...recovery, savedAt: null }; persist(draft); setReview(draft); setResult(null); setRecovery(null); setSaved(s => ({ ...s, [direction]: false })); setCloudStatus("Borrador recuperado; pulsa Guardar para sincronizar"); }}>Recuperar borrador local distinto</button> : null}
        {!busy && cloudStatus.startsWith("Sin sincronizar") ? <button onClick={() => void sync(latestReview.current).then(() => setError("")).catch(e => setError(message(e)))}>Reintentar guardado</button> : null}
        {busy ? <p role="status">{busy}</p> : null}
        {busy && step === 3 ? <button onClick={() => {
          generation.current++; controller.current?.abort(); lock.current=false; setBusy("");
          setError("Consulta de IA cancelada. La fotografía y los colores se conservaron.");
        }}>Cancelar consulta de IA</button> : null}
        {error ? <p role="alert" style={{ color: "#a0331e", fontSize: 13 }}>{error}</p> : null}
        {!busy && error && imageId && !pixels ? <button onClick={()=>setLoadAttempt(n=>n+1)}>Reintentar abrir foto</button> : null}
        {step === 3 && !busy && error ? <button onClick={()=>void analyse()}>Reintentar IA</button> : null}
      </aside>
    </main>}
    <footer>
      <div style={{ display: "flex", gap: 6 }}>{DIRECTIONS.map(d=><button key={d} aria-label={`Abrir ${DIRECTION_LABELS[d]}`} aria-pressed={direction===d} disabled={!!busy} onClick={()=>switchView(d)} style={{ padding:"6px 10px",fontSize:13,background:direction===d?"#e0efe5":"white" }}>{d==="W"?"O":d}{saved[d]?" ✓":""}</button>)}</div>
      {!finished ? <div style={{ display:"flex",gap:8 }}>
        {step > 0 ? <button disabled={!!busy} onClick={()=>{setStep(step===4?2:Math.max(0,step-1));setError("");}}>Atrás</button> : null}
        <button className="g-primary" disabled={!!busy || !pixels || (step===2 && !review.config.samples.length) || (step>=3 && !a)} onClick={()=>{
          setError("");
          if(step===0) setStep(1);
          else if(step===1){const issue=trunkOutlineError(review.outline);if(issue)setError(issue);else setStep(2);}
          else if(step===2) void analyse();
          else if(step===3) setStep(4);
          else if(step===4) void save();
        }}>{step===4 ? direction==="W" ? "Guardar y terminar" : `Guardar y pasar a ${DIRECTION_LABELS[DIRECTIONS[DIRECTIONS.indexOf(direction)+1]]}` : step===2 ? "Analizar selección" : step===3 ? busy ? "Analizando…" : "Revisar sin IA" : "Continuar"}</button>
      </div> : <a href={backHref}>Volver a los árboles</a>}
    </footer>
  </section>;
}

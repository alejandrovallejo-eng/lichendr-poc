"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DIRECTIONS, DIRECTION_LABELS, type Direction } from "./types";
import type { GuidedContext, GuidedSession, GuidedServices } from "./guided-flow";
import { analysisRecord, checkLichenSamples, guidedKey, parseGuidedReview, type GuidedReview } from "./guided-flow";
import { classifyTrunkColors, colorWorkingSize, initialColorConfig, OVERLAY_RGB,
  type ColorConfig, type ColorResult } from "../region-suggestions/trunk-colors";
import { trunkOutlineError, type TrunkPoint } from "../region-suggestions/trunk-outline";
import { orderedCloudWriter, reviewFingerprint, type CloudReview } from "./guided-cloud";
import { TreeSummary } from "./TreeSummary";
import { ExperimentalComparison } from "./ExperimentalComparison";
import { BioClipEvidence } from "./BioClipEvidence";
import { GuidedColorControls, GuidedGroupCoverage, GuidedToneMarker, proposalDisplayPixels, useGuidedColorPicker } from "./GuidedColorPicker";

const fresh = (): GuidedReview => ({ version: 1, outline: [], config: initialColorConfig(), analysis: null, savedAt: null });
const STEPS = ["Foto", "Tronco", "Colores", "Análisis", "Guardar"];
type Pixels = { width: number; height: number; rgba: Uint8ClampedArray };
interface Props {
  context: GuidedContext;
  contextLabel: string;
  treeLabel?: string;
  backHref: string;
  services: GuidedServices;
  checkSamples?: typeof checkLichenSamples;
  initialSummary?: boolean;
}
const message = (e: unknown) => e instanceof Error ? e.message : "No se pudo completar este paso. Reintenta.";

// One mounted photograph and one active step. Never render four editors or
// launch legacy four-view calibration behind this screen.
export function GuidedCapture({ context, contextLabel, treeLabel, backHref, services, checkSamples = checkLichenSamples, initialSummary = false }: Props) {
  const [session, setSession] = useState<GuidedSession | null>(null);
  const [direction, setDirection] = useState<Direction>("N");
  const [step, setStep] = useState(0);
  const [review, setReview] = useState<GuidedReview>(fresh);
  const [src, setSrc] = useState("");
  const [pixels, setPixels] = useState<Pixels | null>(null);
  const [result, setResult] = useState<ColorResult | null>(null);
  const [overlay, setOverlay] = useState("");
  const [proposalOverlay, setProposalOverlay] = useState("");
  const [showOverlay, setShowOverlay] = useState(true);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [experimental, setExperimental] = useState(false);
  const [busy, setBusy] = useState("Recuperando esta captura…");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Partial<Record<Direction, boolean>>>({});
  const [finished, setFinished] = useState(initialSummary);
  const [editingSummary, setEditingSummary] = useState(false);
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
  const photo = useRef<SVGSVGElement>(null);
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
    if (!session || !imageId || !key || finished) return;
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
  }, [imageId, key, services, loadAttempt, finished]);

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
      // A completed view opens its review, not another forced trip through
      // upload/outline/sampling and paid inference. Geometry was checked above.
      if (review.savedAt) setStep(4);
    }).catch(e => { if (!abort.signal.aborted) setError(message(e)); });
    return () => abort.abort();
  }, [pixels, review.analysis, review.outline, review.config, review.savedAt, result, direction]);

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
  const picker = useGuidedColorPicker(pixels, review.outline, review.config, step === 2 && !finished,
    config => edit(review.outline, config));
  const displayed = step === 2 ? picker.accepted : result;
  useEffect(() => {
    if (!displayed || !pixels) { setOverlay(""); return; }
    const canvas = document.createElement("canvas"); canvas.width = pixels.width; canvas.height = pixels.height;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const data = ctx.createImageData(pixels.width, pixels.height);
    displayed.labels.forEach((code, i) => {
      if (code >= 3) data.data.set([...OVERLAY_RGB[code - 1], 125], i * 4);
    });
    ctx.putImageData(data, 0, 0); setOverlay(canvas.toDataURL());
  }, [displayed, pixels]);
  useEffect(() => {
    if (!picker.proposal || !pixels) { setProposalOverlay(""); return; }
    const canvas = document.createElement("canvas"); canvas.width = pixels.width; canvas.height = pixels.height;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const data = ctx.createImageData(pixels.width, pixels.height);
    data.data.set(proposalDisplayPixels(picker.proposal.mask, pixels.width, pixels.height));
    ctx.putImageData(data, 0, 0); setProposalOverlay(canvas.toDataURL());
  }, [picker.proposal, pixels]);
  const openView = (d: Direction) => {
    if (d === direction && !finished) return;
    if (d === direction) setLoadAttempt(n => n + 1);
    controller.current?.abort(); generation.current++;
    setDirection(d); setStep(0); setFinished(false); setReview(fresh()); setResult(null); setPixels(null); setSrc(""); setError("");
  };
  const switchView = async (d: Direction) => {
    if (lock.current || busy || picker.pending || (d === direction && !finished)) return;
    lock.current = true; setBusy("Guardando antes de cambiar de vista…");
    try {
      if (!finished && key && reviewFingerprint(latestReview.current) !== lastCloud.current) await sync(latestReview.current);
      if (finished) setEditingSummary(true);
      openView(d);
    } catch (e) { setError(message(e)); }
    finally { lock.current = false; setBusy(""); }
  };
  const showSummary = async () => {
    if (lock.current || busy || picker.pending) return;
    lock.current = true; setBusy("Guardando antes de abrir el análisis…");
    try {
      if (key && cloudWriter.current && reviewFingerprint(latestReview.current) !== lastCloud.current) await sync(latestReview.current);
      setFinished(true); setError("");
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
      setCompareOriginal(false); setShowOverlay(true);
      picker.pick(point);
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
      const ai = await checkSamples({ imageId, treeSampleId: session.treeSampleId, direction }, review.outline, review.config, pixels.width, pixels.height, abort.signal, experimental);
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
      if (editingSummary || DIRECTIONS.every(d => complete[d])) setFinished(true);
      else if (nextView) openView(nextView); else setFinished(true);
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
    if (busy || (picker.pending && !window.confirm("Esta propuesta todavía no está aceptada. ¿Salir y descartarla?"))
      || (!finished && reviewFingerprint(latestReview.current) !== lastCloud.current && review.outline.length && !window.confirm("Hay cambios pendientes de sincronizar. El borrador queda aquí. ¿Volver a la jornada?"))) event.preventDefault();
  };

  return <section ref={screen} aria-label="Captura paso a paso" className="guided-capture" style={{ position: "fixed", inset: 0, zIndex: 60, background: "#f4f7f5", color: "#172e25", display: "grid", gridTemplateRows: "auto auto minmax(0,1fr) auto", height: "100dvh" } as CSSProperties}>
    <style>{`.guided-capture *{box-sizing:border-box}.guided-capture button,.guided-capture .g-upload{min-height:44px;border:1px solid #cbd8d0;border-radius:10px;padding:8px 14px;background:white;color:#173d2d;font:inherit;cursor:pointer}.guided-capture button:disabled{opacity:.45;cursor:default}.guided-capture button:focus-visible,.guided-capture a:focus-visible,.guided-capture svg:focus-visible{outline:3px solid #e1b752;outline-offset:2px}.guided-capture .g-primary{background:#00674d;color:white;border-color:#00674d;font-weight:700}.guided-capture .g-main{display:grid;grid-template-columns:minmax(0,1fr) 290px;min-height:0;gap:16px;padding:16px}.guided-capture .g-tools{overflow:auto;min-height:0;padding:16px;border-radius:16px;background:white;display:flex;flex-direction:column;gap:14px}.guided-capture .g-photo{min-height:0;position:relative;background:#e6ece8;border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center}.guided-capture .g-steps{display:flex;justify-content:center;gap:6px;padding:8px}.guided-capture .g-steps span{padding:5px 12px;border-radius:20px;font-size:13px}.guided-capture p{margin:0}.guided-capture footer{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 20px;background:white;border-top:1px solid #d6e0d9}.guided-capture .g-context{max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.guided-capture .g-heading{font-size:21px;margin:0}.guided-capture .g-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:700px){.guided-capture .g-main{grid-template-columns:1fr;grid-template-rows:minmax(120px,1fr) auto;padding:8px;gap:8px}.guided-capture .g-tools{max-height:210px;gap:8px;padding:12px}.guided-capture .g-steps span{padding:4px 6px;font-size:11px}.guided-capture footer{padding:8px;font-size:13px}.guided-capture .g-context{max-width:60vw}.guided-capture .g-heading{font-size:18px}}`}</style>
    <header style={{ padding: "12px 20px 4px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
      <div><p className="g-context" title={contextLabel}>{contextLabel}</p><h1 className="g-heading" ref={title} tabIndex={-1}>{finished ? `Análisis del árbol${treeLabel ? ` · ${treeLabel}` : ""}` : `${name} · ${DIRECTIONS.indexOf(direction) + 1} de 4`}</h1></div>
      <div style={{display:"flex",gap:12,alignItems:"center"}}>{!finished ? <button disabled={!!busy || !session || !!picker.pending} onClick={() => void showSummary()} style={{fontSize:13}}>Ver análisis del árbol</button> : null}<a href={backHref} onClick={leave} style={{ fontSize: 13 }}>Volver a la jornada</a></div>
    </header>
    {finished ? <div /> : <nav className="g-steps" aria-label="Pasos de esta fotografía">{STEPS.map((label, i) => <span key={label} aria-current={i === step ? "step" : undefined} style={{ background: i === step ? "#d1eadc" : "transparent", fontWeight: i === step ? 700 : 400 }}>{i + 1}. {label}</span>)}</nav>}
    {finished ? session ? <TreeSummary session={session} services={services} onEdit={d => void switchView(d)} /> : <main style={{padding:24}}><p role={error ? "alert" : "status"}>{error || busy}</p></main> : <main className="g-main">
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
          <svg ref={photo} role="group" aria-label={`Fotografía de ${name}: ${step === 1 ? "delimitar tronco" : step === 2 ? "elegir colores de liquen" : "vista previa"}`} tabIndex={0} viewBox={`0 0 ${photoWidth} ${photoHeight}`} style={{ width: "100%", height: "100%", touchAction: "none", cursor: step === 1 || step === 2 ? "crosshair" : "default" }}
            onPointerDown={event => {
              if (busy || (step !== 1 && step !== 2)) return;
              const p = pointFromEvent(event); if (!p) return; setKeyboard(false); setCursor(p);
              const found = step === 1 ? review.outline.findIndex(v => Math.hypot((p.x-v.x)*photoWidth,(p.y-v.y)*photoHeight) < 13) : -1;
              if (found >= 0) { drag.current = found; event.currentTarget.setPointerCapture(event.pointerId); } else pick(p);
            }} onPointerMove={event => {
              const p = pointFromEvent(event);
              if (p && step === 2 && !busy) setCursor(p);
              if (drag.current === null || busy || step !== 1) return;
              if (p) edit(review.outline.map((v, i) => i === drag.current ? p : v), initialColorConfig());
            }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
            onKeyDown={event => {
              if (busy || (step !== 1 && step !== 2)) return;
              const moves: Record<string, number[]> = { ArrowLeft: [-.01,0], ArrowRight: [.01,0], ArrowUp: [0,-.01], ArrowDown: [0,.01] };
              if (moves[event.key]) { event.preventDefault(); setKeyboard(true); const [x,y] = moves[event.key]; setCursor(p => ({x:Math.max(0,Math.min(.999,p.x+x)), y:Math.max(0,Math.min(.999,p.y+y))})); }
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(cursor); }
            }}>
            <image href={src} width={photoWidth} height={photoHeight} />
            {showOverlay && overlay && step >= 2 && !(step === 2 && compareOriginal) ? <image href={overlay} width={photoWidth} height={photoHeight} opacity={step === 2 && picker.pending ? .3 : 1} /> : null}
            {step === 2 && !compareOriginal && proposalOverlay ? <image aria-label="Zonas propuestas en fucsia" href={proposalOverlay} width={photoWidth} height={photoHeight} /> : null}
            {review.outline.length ? <polygon points={review.outline.map(p => `${p.x*photoWidth},${p.y*photoHeight}`).join(" ")} fill={step === 1 ? "#009cda22" : "none"} stroke="#00b8ff" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null}
            {step === 1 ? review.outline.map((p,i) => <circle key={i} cx={p.x*photoWidth} cy={p.y*photoHeight} r="6" fill="#00b8ff" stroke="white" strokeWidth="2" />) : null}
            {step >= 2 && !(step === 2 && compareOriginal) ? review.config.samples.map((s,i) => <circle key={i} cx={s.x*photoWidth} cy={s.y*photoHeight} r="7" fill={`rgb(${s.rgb.join(",")})`} stroke="#00ffff" strokeWidth="3" />) : null}
            {step === 2 && picker.pending && !compareOriginal ? <GuidedToneMarker sample={picker.pending} width={photoWidth} height={photoHeight} /> : null}
            {keyboard ? <circle cx={cursor.x*photoWidth} cy={cursor.y*photoHeight} r="10" fill="none" stroke="yellow" strokeWidth="2" /> : null}
          </svg>
          {step === 2 ? <>
            <button aria-pressed={compareOriginal} onClick={() => setCompareOriginal(v => !v)} style={{ position: "absolute", left: 12, top: 12, fontSize: 12, boxShadow: "0 1px 6px #0003" }}>{compareOriginal ? "Volver a la selección" : "Ver foto sin marcas"}</button>
            <div role="status" style={{ position: "absolute", bottom: 12, left: 12, maxWidth: "calc(100% - 24px)", padding: "9px 12px", borderRadius: 10, background: "#173126ee", color: "white", fontSize: 13, pointerEvents: "none" }}>
              {compareOriginal ? "Foto sin marcas · vuelve a la selección para revisar las zonas." : picker.pending
                ? <><strong>{picker.proposal ? "Fucsia = zonas nuevas propuestas" : "Color capturado · buscando coincidencias…"}</strong><br />{picker.removing ? "Toca una zona fucsia para quitarla." : "Revisa la foto y pulsa «Aceptar este tono»."}</>
                : <>Toca {review.config.samples.some(s => s.label === picker.label) ? "otro tono" : "el primer color"} de <strong>{picker.groups.find(g => g.label === picker.label)?.name}</strong>. Verás aquí las zonas parecidas.</>}
            </div>
          </> : null}
          {step === 2 ? <svg aria-label="Lupa del gotero" width="100" height="100" viewBox={`${cursor.x * photoWidth - 18} ${cursor.y * photoHeight - 18} 36 36`}
            style={{ position: "absolute", right: 12, top: 12, border: "2px solid white", borderRadius: 12, background: "#183d2d", pointerEvents: "none", boxShadow: "0 2px 8px #0006" }}>
            <image href={src} width={photoWidth} height={photoHeight} />
            <path d={`M${cursor.x * photoWidth - 4} ${cursor.y * photoHeight}h8 M${cursor.x * photoWidth} ${cursor.y * photoHeight - 4}v8`} stroke="white" strokeWidth=".7" />
          </svg> : null}
        </> : <div style={{ padding: 28, textAlign: "center" }}>{busy || "Sube una fotografía para comenzar"}</div>}
      </div>
      <aside className="g-tools" aria-label="Herramientas del paso actual" style={step === 2 ? { gap: 10 } : undefined}>
        <h2 style={{ fontSize: 19, margin: 0 }}>{["Sube la foto", "Delimita el tronco", "Toca colores de liquen", busy ? "Analizando tu selección" : "Revisar estimación", "Revisa y guarda"][step]}</h2>
        {step === 0 ? <><p>Una fotografía por orientación. Empezamos con {name.toLowerCase()}.</p><label className="g-upload">{imageId ? "Reemplazar fotografía" : "Elegir fotografía"}<input aria-label={`Subir foto de ${name}`} type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif" className="g-hidden" disabled={!!busy || !session || session.completed} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /></label>{imageId ? <p style={{ fontSize: 13 }}>Original guardado ✓</p> : null}{saved[direction] ? <p>Esta vista ya tiene una revisión guardada.</p> : null}</> : null}
        {step === 1 ? <><p>Toca puntos alrededor del tronco, incluyendo los líquenes. El fondo queda fuera.</p><p style={{ fontSize: 13 }}>Arrastra un punto para ajustar el borde.</p><button disabled={!!busy || !review.outline.length} onClick={() => edit(review.outline.slice(0,-1), initialColorConfig())}>Deshacer punto</button><p style={{ fontSize: 12 }}>{review.outline.length} puntos · mínimo 3</p></> : null}
        {step === 2 ? <GuidedColorControls picker={picker} config={review.config} onFocusPhoto={() => { setCompareOriginal(false); setShowOverlay(true); photo.current?.focus(); }} /> : null}
        {step === 2 ? <details style={{ fontSize: 12 }}><summary>Opciones de IA</summary><label style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={experimental} disabled={!!busy} onChange={e => setExperimental(e.target.checked)} /> Añadir segunda opinión de IA</label><p>Revisión adicional en prueba para distinguir musgo, algas y otros hongos. Tu selección se conserva.</p></details> : null}
        {step >= 3 && a ? <><p style={{ fontSize: 13 }}>Cobertura estimada por tus colores</p><p style={{ fontSize: 36, fontWeight: 750 }}>{percent} %</p><p style={{ fontSize: 13 }}>{(100*(a.total-a.lichen)/a.total).toFixed(1)} % sin seleccionar.</p><label style={{ fontSize: 13 }}><input type="checkbox" checked={showOverlay} onChange={e=>setShowOverlay(e.target.checked)} /> Mostrar selección</label>{a.ai ? <p style={{ fontSize: 13 }}>Revisión de IA: {matching}/{a.ai.suggestions.length} ejemplos sugieren liquen. {matching < a.ai.suggestions.length ? "Hay diferencias: revisa las zonas resaltadas." : "Revisa las zonas resaltadas antes de guardar."}</p> : <p style={{ fontSize: 13 }}>Sin revisión de IA.</p>}<p style={{ fontSize: 11 }}>El porcentaje corresponde al área que seleccionaste dentro del contorno.</p></> : null}
        {step >= 3 && a ? <GuidedGroupCoverage config={review.config} counts={a.counts} total={a.total} /> : null}
        {step >= 3 && a && session && imageId ? <BioClipEvidence ai={a.ai} src={src} width={photoWidth} height={photoHeight}
          reference={{ imageId, treeSampleId: session.treeSampleId, direction }} /> : null}
        {step >= 3 ? <ExperimentalComparison comparison={a?.ai?.experimental} /> : null}
        {step === 4 ? <p style={{ fontSize: 12 }}>Al guardar confirmas la selección visible y su revisión en la nube. {editingSummary || DIRECTIONS.every(d => d === direction || saved[d]) ? "Después verás el análisis del árbol con sus cuatro vistas." : "Después se abre la siguiente orientación."}</p> : null}
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
      {!finished ? <div style={{ display: "flex", gap: 6 }}>{DIRECTIONS.map(d=><button key={d} aria-label={`Abrir ${DIRECTION_LABELS[d]}`} aria-pressed={direction===d} disabled={!!busy || !!picker.pending} onClick={()=>switchView(d)} style={{ padding:"6px 10px",fontSize:13,background:direction===d?"#e0efe5":"white" }}>{d==="W"?"O":d}{saved[d]?" ✓":""}</button>)}</div> : <span style={{fontSize:13}}>Fotos y resultados agrupados en esta jornada.</span>}
      {!finished ? <div style={{ display:"flex",gap:8 }}>
        {step > 0 ? <button disabled={!!busy || !!picker.pending} onClick={()=>{setStep(step===4?2:Math.max(0,step-1));setError("");}}>Atrás</button> : null}
        <button className="g-primary" disabled={!!busy || !pixels || (step===2 && (!review.config.samples.length || !!picker.pending || !picker.accepted)) || (step>=3 && !a)} onClick={()=>{
          setError("");
          if(step===0) setStep(1);
          else if(step===1){const issue=trunkOutlineError(review.outline);if(issue)setError(issue);else setStep(2);}
          else if(step===2) void analyse();
          else if(step===3) setStep(4);
          else if(step===4) void save();
        }}>{step===4 ? editingSummary || DIRECTIONS.every(d=>d===direction||saved[d]) ? "Guardar y ver árbol" : direction==="W" ? "Guardar y continuar" : `Guardar y pasar a ${DIRECTION_LABELS[DIRECTIONS[DIRECTIONS.indexOf(direction)+1]]}` : step===2 ? "Analizar selección" : step===3 ? busy ? "Analizando…" : a?.ai ? "Continuar" : "Continuar sin IA" : "Continuar"}</button>
      </div> : <div style={{display:"flex",gap:16,flexWrap:"wrap"}}><a href={`/analysis?${new URLSearchParams({projectId:context.projectId,siteId:context.siteId,eventId:context.eventId})}`} onClick={leave} style={{fontWeight:700}}>Ver resultados de la jornada</a><a href={backHref} onClick={leave} style={{fontWeight:700}}>Continuar con otro árbol →</a></div>}
    </footer>
  </section>;
}

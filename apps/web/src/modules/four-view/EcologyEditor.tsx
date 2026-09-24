"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { GuidedColorControls, GuidedToneMarker, proposalDisplayPixels, useGuidedColorPicker } from "./GuidedColorPicker";
import { colorWorkingSize, OVERLAY_RGB, type ColorConfig } from "../region-suggestions/trunk-colors";
import type { TrunkPoint } from "../region-suggestions/trunk-outline";
import type { GuidedReview } from "./guided-flow";
import type { EcologyServices } from "./ecology-client";
import { emptyEcologyConfig, frameContinuationReady, morphDisplayName, parseEcologyReview, quadratFromFrame, quadratFromPoints, quadratOutline, referenceTones, sameEcologySource, selectMorph, validQuadrat,
  type EcologyRow, type Morphospecies, type Quadrat } from "./ecology";
import { DIRECTION_LABELS, type Direction } from "./types";
import { reviewFingerprint } from "./guided-cloud";
import MorphNameEditor from "./MorphNameEditor";
import { CELL_FREQUENCY_METHOD, FRAME_CELL_COUNT, encodeAcceptedMasks, frameCellPolygons, isVerifiedCalibration, projectSourcePointToRectified, proposeCellDecisions, type CellDecision, type CellDecisions, type FrameQuad, type StandardizedCellReview } from "./cell-frequency";

function CellReviewMatrix({ catalog, config, decisions, proposed, onChange }: {
  catalog: Morphospecies[]; config: ColorConfig; decisions: CellDecisions;
  proposed: CellDecisions;
  onChange: (value: CellDecisions) => void;
}) {
  const groups = config.confirmed?.groups.filter(group => group.id !== "unassigned") ?? [];
  const update = (morphId: string, index: number, value: CellDecision) => onChange({
    ...decisions, [morphId]: { ...(decisions[morphId] ?? {}), [String(index)]: value },
  });
  return <div aria-label="Revisión compacta de presencia por celda" style={{display:"grid",gap:8}}>
    <p className="eco-small">La propuesta usa los píxeles de las máscaras aceptadas. Confirma cada celda; tonos distintos del mismo liquen cuentan una sola vez.</p>
    {groups.map(group => <div key={group.id}>
      <strong style={{overflowWrap:"anywhere"}}>{morphDisplayName(catalog.find(m=>m.id===group.id) ?? {id:group.id,event_id:"",ordinal:0})}</strong>
      <div style={{display:"grid",gridTemplateColumns:`repeat(${FRAME_CELL_COUNT}, minmax(0, 1fr))`,gap:4}}>
        {Array.from({length:FRAME_CELL_COUNT},(_,index)=>{
          const value=decisions[group.id]?.[String(index)] ?? proposed[group.id]?.[String(index)] ?? "not_evaluated";
          return <label key={index} className="eco-small"><span>Celda {index+1}</span>
            <select value={value} onChange={e=>update(group.id,index,e.target.value as CellDecision)} style={{width:"100%",fontSize:11}}>
              <option value="proposed">Propuesta</option><option value="observed">Presencia</option>
              <option value="not_observed">No observada</option><option value="not_evaluated">No evaluada</option>
            </select>
          </label>;
        })}
      </div>
    </div>)}
    {!groups.length?<p className="eco-small">Acepta primero un tono y asígnalo a una morfoespecie.</p>:null}
  </div>;
}

export function MorphCatalogue({ catalog, reviews, selectedId, disabled, busy, onSelect, onCreate, onRename }: {
  catalog:Morphospecies[]; reviews:EcologyRow[]; selectedId?:string; disabled:boolean; busy:boolean;
  onSelect:(m:Morphospecies)=>void; onCreate:()=>void;
  onRename?:(m:Morphospecies,name:string)=>Promise<void>;
}) {
  return <div id="morph-catalogue" aria-label="Catálogo de morfoespecies" className="eco-catalogue">
    <p className="eco-small">Compartido por esta jornada. Los tonos son referencias: elige los de esta fotografía antes de aceptar.</p>
    {catalog.map(m=><div key={m.id}><button aria-pressed={selectedId===m.id} disabled={disabled||busy} onClick={()=>onSelect(m)} className="eco-morph" style={{width:"100%",overflowWrap:"anywhere"}}>
      <strong>{morphDisplayName(m)}</strong><span className="eco-swatches">{referenceTones(reviews,m.id).map((c,i)=><span key={i} title={`Referencia RGB ${c.join(", ")}`} style={{background:`rgb(${c.join(",")})`}} />)}</span>
      <small>{selectedId===m.id?"Seleccionada en esta vista":"También está en este cuadrante →"}</small>
    </button>{onRename?<MorphNameEditor morph={m} disabled={disabled||busy} onSave={onRename}/>:null}</div>)}
    {!catalog.length?<p className="eco-small">Todavía no hay morfoespecies. Crea la primera.</p>:null}
    <button onClick={onCreate} disabled={disabled||busy||catalog.length>=64}>{busy?"Creando…":"+ Nueva morfoespecie"}</button>
  </div>;
}

const detail=(e:unknown)=>e instanceof Error?e.message:"No se pudo completar la operación.";
export default function EcologyEditor({ownerId,eventId,sampleId,imageId,direction,treeName,source,existing,catalog,reviews,services,onCatalog,onSaved,onClose}: {
  ownerId:string;eventId:string;sampleId:string;imageId:string;direction:Direction;treeName:string;source:GuidedReview;
  existing?:EcologyRow;catalog:Morphospecies[];reviews:EcologyRow[];services:EcologyServices;
  onCatalog:(m:Morphospecies)=>void;onSaved:(r:EcologyRow)=>void;onClose:()=>void;
}) {
  const currentWidth=source.calibration?.width ?? source.analysis?.width ?? 0;
  const currentHeight=source.calibration?.height ?? source.analysis?.height ?? 0;
  const usable=existing&&source.analysis&&sameEcologySource(existing.review,source.outline,currentWidth,currentHeight,{...source,imageId})?existing.review:null;
  const [quadrat,setQuadrat]=useState<Quadrat|null>(usable?.quadrat??null);
  const [config,setConfig]=useState<ColorConfig>(usable?.config??emptyEcologyConfig);
  const [step,setStep]=useState(usable?1:0),[first,setFirst]=useState<TrunkPoint|null>(null);
  const [src,setSrc]=useState(""),[pixels,setPixels]=useState<{width:number;height:number;rgba:Uint8ClampedArray}|null>(null);
  const [error,setError]=useState(""),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[creating,setCreating]=useState(false);
  const [open,setOpen]=useState(true),[original,setOriginal]=useState(false),[zero,setZero]=useState(!!usable&&!usable.config.samples.length);
  const [overlay,setOverlay]=useState(""),[proposal,setProposal]=useState("");
  const canRegisterFrame = Boolean(source.analysis);
  const [standardized,setStandardized]=useState(Boolean(usable?.standardized));
  const [frameConfirmed,setFrameConfirmed]=useState(Boolean(usable?.standardized?.frameConfirmed));
  const [cellDecisions,setCellDecisions]=useState<CellDecisions>(usable?.standardized?.decisions ?? {});
  const [decisionFingerprint,setDecisionFingerprint]=useState(usable?.standardized?.sourceFingerprint ?? "");
  const [frameCorners,setFrameCorners]=useState<FrameQuad | null>(usable?.standardized?.frame.corners ?? null);
  const [registeringFrame,setRegisteringFrame]=useState(false);
  const [pendingFrameCorners,setPendingFrameCorners]=useState<TrunkPoint[]>([]);
  const [cursor,setCursor]=useState<TrunkPoint>({x:.5,y:.5}),[keyboard,setKeyboard]=useState(false);
  const photo=useRef<SVGSVGElement>(null),createId=useRef<string|null>(null),alive=useRef(true),savingRef=useRef(false);
  const lastAttempt=useRef<{fingerprint:string;savedAt:string}|null>(null);
  const displayOutline=useMemo(() => {
    if (!isVerifiedCalibration(source.calibration)) return source.outline;
    return source.outline.map(point => projectSourcePointToRectified(source.calibration!.sourceCorners, point)).filter((point): point is TrunkPoint => Boolean(point));
  }, [source.outline, source.calibration]);
  const outline=useMemo(()=>quadrat&&pixels?quadratOutline(quadrat,pixels.width,pixels.height):displayOutline,[quadrat,pixels,displayOutline]);
  const edit=(next:ColorConfig)=>{setConfig(next);setDirty(true);setZero(false);};
  const picker=useGuidedColorPicker(pixels,outline,config,!!quadrat&&!saving,edit);
  const selectedId=picker.groups.find(g=>g.label===picker.label)?.id;
  const groupNames=Object.fromEntries(catalog.map(m=>[m.id,morphDisplayName(m)]));
  const assigned=selectedId!=="unassigned";
  const frame = useMemo(() => frameCorners ? ({corners:frameCorners,widthCm:10 as const,heightCm:50 as const}) : null,[frameCorners]);
  const frameQuadrat = useMemo(() => frame && pixels ? quadratFromFrame(frame, displayOutline, pixels.width, pixels.height) : null,
    [frame, displayOutline, pixels]);
  const frameCalibration = useMemo(() => {
    if (!frame || !pixels) return source.calibration;
    if (source.calibration) return source.calibration;
    const edge = (a: TrunkPoint, b: TrunkPoint) => Math.hypot((a.x - b.x) * pixels.width, (a.y - b.y) * pixels.height);
    const scale = (edge(frame.corners[0], frame.corners[1]) + edge(frame.corners[3], frame.corners[2])) / 20;
    return { pixelsPerCm: scale, method: "manual_confirmed" as const, width: pixels.width, height: pixels.height,
      imageId, proxyPath: `analysis-proxy:${imageId}`, transformationId: `manual-frame:${imageId}`,
      sourceCorners: frame.corners };
  }, [frame, pixels, source.calibration, imageId]);
  const acceptedMasks = useMemo(() => picker.accepted&&pixels ? encodeAcceptedMasks(picker.accepted.labels,pixels.width,pixels.height,
    config.confirmed!.groups.filter(g=>g.id!=="unassigned").map(g=>({id:g.id,label:g.label}))) : {},[picker.accepted,pixels,config]);
  const activeMorphIds = useMemo(() => config.confirmed?.groups.filter(g=>g.id!=="unassigned").map(g=>g.id) ?? [],[config]);
  const currentSourceFingerprint = useMemo(() => reviewFingerprint({imageId, outline:displayOutline,
    width:pixels?.width ?? 0, height:pixels?.height ?? 0, calibration:frameCalibration, frame,
    masksByMorph:acceptedMasks}),[imageId,displayOutline,frameCalibration,frame,pixels?.width,pixels?.height,acceptedMasks]);
  const proposedCells = useMemo(() => {
    if (!standardized || !picker.accepted || !pixels || !frame) return {};
    return proposeCellDecisions({masksByMorph:acceptedMasks,maskWidth:pixels.width,maskHeight:pixels.height,frame,morphIds:activeMorphIds});
  },[standardized,picker.accepted,pixels,acceptedMasks,frame,activeMorphIds]);
  const effectiveCellDecisions = useMemo(() => {
    const next={...proposedCells};
    if (decisionFingerprint === currentSourceFingerprint)
      for(const [id,cells] of Object.entries(cellDecisions)) next[id]={...(next[id]??{}),...cells};
    return next;
  },[cellDecisions,decisionFingerprint,currentSourceFingerprint,proposedCells]);
  useEffect(()=>{alive.current=true;let url="";const abort=new AbortController();
    void services.photo(ownerId,imageId,source.calibration?.proxyPath).then(blob=>{if(!abort.signal.aborted){url=URL.createObjectURL(blob);setSrc(url);}}).catch(e=>{if(!abort.signal.aborted)setError(detail(e));});
    return()=>{alive.current=false;abort.abort();if(url)URL.revokeObjectURL(url);};
  },[services,ownerId,imageId,source.calibration?.proxyPath,currentWidth,currentHeight]);
  useEffect(()=>{
    const guard=(e:BeforeUnloadEvent)=>{if(dirty||picker.pending||saving||creating){e.preventDefault();e.returnValue="";}};
    window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);
  },[dirty,picker.pending,saving,creating]);
  useEffect(()=>{
    let cancelled=false;
    const commit=(nextOverlay:string,nextProposal:string)=>queueMicrotask(()=>{
      if(!cancelled){setOverlay(nextOverlay);setProposal(nextProposal);}
    });
    if(!pixels||!picker.accepted){commit("","");return ()=>{cancelled=true;};}
    const canvas=document.createElement("canvas");canvas.width=pixels.width;canvas.height=pixels.height;
    const ctx=canvas.getContext("2d");if(!ctx)return;
    const rgba=new Uint8ClampedArray(pixels.width*pixels.height*4);
    picker.accepted.labels.forEach((label,i)=>{if(label>=3)rgba.set([...OVERLAY_RGB[label-1],135],i*4);});
    const data=ctx.createImageData(pixels.width,pixels.height);data.data.set(rgba);ctx.putImageData(data,0,0);
    const nextOverlay=canvas.toDataURL();
    let nextProposal="";
    if(picker.proposal){data.data.set(proposalDisplayPixels(picker.proposal.mask,pixels.width,pixels.height));ctx.putImageData(data,0,0);nextProposal=canvas.toDataURL();}
    commit(nextOverlay,nextProposal);
    return ()=>{cancelled=true;};
  },[pixels,picker.accepted,picker.proposal]);
  const choose=(m:Morphospecies)=>{
    if(picker.pending||saving||creating)return;
    try{const next=selectMorph(config,m);if(next.config!==config)edit(next.config);picker.setTarget(next.label);setOpen(false);setError("");}catch(e){setError(detail(e));}
  };
  const create=async()=>{
    if(creating||saving||picker.pending)return;setCreating(true);setError("");createId.current??=crypto.randomUUID();
    try{const m=await services.createMorph(eventId,createId.current);if(!alive.current)return;createId.current=null;onCatalog(m);
      const next=selectMorph(config,m);edit(next.config);picker.setTarget(next.label);setOpen(false);
    }catch(e){if(alive.current)setError(detail(e));}finally{if(alive.current)setCreating(false);}
  };
  const pick=(point:TrunkPoint)=>{
    if(!pixels||saving||creating)return;setError("");
    if(registeringFrame){
      const next=[...pendingFrameCorners,point];
      if(next.length===4){setFrameCorners(next as FrameQuad);setQuadrat(quadratFromFrame({corners:next},displayOutline,pixels.width,pixels.height));setPendingFrameCorners([]);setRegisteringFrame(false);setFrameConfirmed(false);setCellDecisions({});setDecisionFingerprint("");setDirty(true);
        if(!quadratFromFrame({corners:next},displayOutline,pixels.width,pixels.height))setError("El marco no define un cuadrante válido dentro del tronco. Revisa las cuatro esquinas.");}
      else setPendingFrameCorners(next);
    }else if(step===0){
      if(!first){setFirst(point);return;}
      const q=quadratFromPoints(first,point,pixels.width,pixels.height);setFirst(null);
      if(!validQuadrat(q,displayOutline,pixels.width,pixels.height)){setError("El cuadrante debe quedar completamente dentro del tronco azul. Marca de nuevo dos esquinas opuestas.");return;}
      setQuadrat(q);setConfig(emptyEcologyConfig());setStandardized(false);setFrameConfirmed(false);setFrameCorners(null);setCellDecisions({});setDecisionFingerprint("");
      setDirty(true);setZero(false);
    }else if(step===1&&assigned)picker.pick(point);
  };
  const close=()=>{if(saving||creating)return;if((dirty||picker.pending)&&!window.confirm("¿Salir sin guardar los cambios de este cuadrante? El análisis anterior se conserva."))return;onClose();};
  const save=async()=>{
    if(savingRef.current||!pixels||!quadrat||!picker.accepted||picker.pending||(!config.samples.length&&!zero))return;
    const standardizedReview: StandardizedCellReview | undefined = standardized && frameCalibration && frame
      ? { method: CELL_FREQUENCY_METHOD, frame, frameConfirmed,
        calibration: frameCalibration, maskWidth: pixels.width, maskHeight: pixels.height,
        masksByMorph: acceptedMasks, decisions: effectiveCellDecisions, reviewedAt: new Date().toISOString(),
        sourceFingerprint: currentSourceFingerprint } : undefined;
    if (standardized && (!standardizedReview || !frameConfirmed)) { setError("Registra las cuatro esquinas y confirma la referencia física de 10 × 50 cm."); return; }
    if (standardized && (Object.keys(effectiveCellDecisions).length !== activeMorphIds.length
      || activeMorphIds.some(id => !effectiveCellDecisions[id]
        || Object.keys(effectiveCellDecisions[id]).length !== FRAME_CELL_COUNT)
      || Object.values(effectiveCellDecisions).flatMap(v=>Object.values(v)).some(v=>v==="proposed"||v==="not_evaluated"))) {
      setError("Revisa cada celda y confirma presencia o no observada antes de guardar."); return;
    }
    const draft={version:1,scale:"uncalibrated",sourceOutline:displayOutline,quadrat,width:pixels.width,height:pixels.height,
      config,counts:Array.from(picker.accepted.counts),total:picker.accepted.total, ...(standardizedReview ? {standardized:standardizedReview} : {})};
    const fingerprint=reviewFingerprint(draft);
    if(lastAttempt.current?.fingerprint!==fingerprint)lastAttempt.current={fingerprint,savedAt:new Date().toISOString()};
    const review=parseEcologyReview({...draft,savedAt:lastAttempt.current.savedAt});
    if(!review){setError("No se pudo validar este cuadrante. No se guardó ningún cambio.");return;}
    savingRef.current=true;setSaving(true);setError("");
    try{const r=await services.save(eventId,sampleId,imageId,direction,review,existing?.revision??0);if(alive.current){setDirty(false);onSaved(r);}}
    catch(e){if(alive.current)setError(detail(e));}finally{savingRef.current=false;if(alive.current)setSaving(false);}
  };
  const w=pixels?.width??source.analysis!.width,h=pixels?.height??source.analysis!.height;
  const focus=step===0?displayOutline:quadrat?quadratOutline(quadrat,w,h):displayOutline;
  const x0=Math.max(0,Math.min(...focus.map(p=>p.x))*w-20),y0=Math.max(0,Math.min(...focus.map(p=>p.y))*h-20);
  const x1=Math.min(w,Math.max(...focus.map(p=>p.x))*w+20),y1=Math.min(h,Math.max(...focus.map(p=>p.y))*h+20);
  const pct=(n:number)=>`${(100*n/Math.max(1,picker.accepted?.total??1)).toFixed(1)} %`;
  return <section className="ecology-editor" aria-label="Análisis del cuadrante" style={{position:"fixed",inset:0,zIndex:100,background:"#f3f6f1",color:"#173d35",display:"grid",gridTemplateRows:"auto auto minmax(0,1fr) auto"}}>
    <style>{`.ecology-editor *{box-sizing:border-box}.ecology-editor p{margin:0}.ecology-editor button{border:1px solid #a5bfb2;border-radius:10px;background:white;color:#173d35;min-height:42px;padding:8px 12px;cursor:pointer;font:inherit}.ecology-editor button:disabled{opacity:.45;cursor:default}.ecology-editor button:focus-visible,.ecology-editor svg:focus-visible{outline:3px solid #c09b28;outline-offset:2px}.ecology-editor .g-primary{background:#00674d;color:white;font-weight:700}.eco-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;min-height:0;gap:14px;padding:14px}.eco-photo{min-height:0;background:#dfe7df;border-radius:16px;overflow:hidden;position:relative}.eco-tools{overflow:auto;min-height:0;background:white;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:12px}.eco-small{font-size:12px}.eco-catalogue{display:flex;flex-direction:column;gap:8px}.eco-morph{text-align:left;display:flex;flex-direction:column;gap:5px}.eco-morph[aria-pressed=true]{border:2px solid #00674d;background:#edf8ef}.eco-swatches{display:flex;gap:4px;flex-wrap:wrap}.eco-swatches span{width:20px;height:20px;border:1px solid #6c7f72;border-radius:4px}.ecology-editor footer{background:white;border-top:1px solid #d2dfd4;padding:12px 18px;display:flex;justify-content:space-between;gap:8px;align-items:center}.ecology-editor .eco-caption{font-size:12px;max-width:50vw}.eco-editor-header{display:flex;justify-content:space-between;align-items:center;padding:12px 20px;gap:12px}.eco-steps{text-align:center;padding:6px;font-size:13px}@media(max-width:700px){.eco-layout{grid-template-columns:1fr;grid-template-rows:minmax(140px,1fr) auto;padding:8px;gap:8px}.eco-tools{max-height:240px;padding:12px}.eco-editor-header{padding:8px;font-size:14px}.ecology-editor footer{padding:8px;font-size:12px}.ecology-editor .eco-caption{display:none}}`}</style>
    <header className="eco-editor-header"><div><strong>{treeName} · {DIRECTION_LABELS[direction]}</strong><p className="eco-small">Diversidad · {standardized?"frecuencia estandarizada":"cuadrante exploratorio"}</p></div><button disabled={saving||creating} onClick={close}>Volver a resultados</button></header>
    <nav className="eco-steps" aria-label="Paso actual">{["1. Cuadrante","2. Morfoespecies","3. Guardar"].map((s,i)=><span key={s} style={{padding:"5px 12px",fontWeight:step===i?700:400,background:step===i?"#cee9d8":"transparent",borderRadius:20}}>{s}</span>)}</nav>
    <main className="eco-layout"><div className="eco-photo">
      {!src?<p role="status" style={{padding:20}}>Abriendo la fotografía guardada…</p>:<>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" style={{position:"absolute",width:1,height:1,opacity:0}} onError={()=>setError("No se pudo abrir la fotografía. Vuelve a resultados y reintenta.")} onLoad={e=>{
          try{const img=e.currentTarget,size=colorWorkingSize(img.naturalWidth,img.naturalHeight);
            if(size.width!==currentWidth||size.height!==currentHeight)throw new Error("La copia de la foto cambió de tamaño. Revisa primero la rectificación del marco.");
            const c=document.createElement("canvas");c.width=size.width;c.height=size.height;const ctx=c.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("No se pudieron leer los colores.");
            ctx.drawImage(img,0,0,c.width,c.height);setPixels({...size,rgba:ctx.getImageData(0,0,c.width,c.height).data});
          }catch(e){setError(detail(e));}
        }}/>
        <svg ref={photo} tabIndex={0} role="group" aria-label={registeringFrame?"Fotografía: registrar cuatro esquinas del marco físico":step===0?"Fotografía: elegir dos esquinas del cuadrante":"Fotografía: elegir tonos de morfoespecies"}
          viewBox={`${x0} ${y0} ${x1-x0} ${y1-y0}`} style={{width:"100%",height:"100%",touchAction:"none",cursor:step<2?"crosshair":"default"}}
          onPointerDown={e=>{const matrix=e.currentTarget.getScreenCTM();if(!matrix)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());
            if(p.x<0||p.y<0||p.x>=w||p.y>=h)return;const point={x:p.x/w,y:p.y/h};setCursor(point);setKeyboard(false);pick(point);}}
          onKeyDown={e=>{const delta:Record<string,number[]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
            if(delta[e.key]){e.preventDefault();setKeyboard(true);const [dx,dy]=delta[e.key];setCursor(p=>({x:Math.max(0,Math.min(.999,p.x+dx/w*(e.shiftKey?10:1))),y:Math.max(0,Math.min(.999,p.y+dy/h*(e.shiftKey?10:1)))}));}
            if(e.key==="Enter"||e.key===" "){e.preventDefault();pick(cursor);}}}>
          <image href={src} width={w} height={h}/>
          {!original&&step>0&&overlay?<image href={overlay} width={w} height={h} opacity={picker.pending ? 0.3 : 1}/>:null}
          {!original&&step===1&&proposal?<image href={proposal} width={w} height={h} aria-label="Zonas propuestas en fucsia"/>:null}
          <polygon points={displayOutline.map(p=>`${p.x*w},${p.y*h}`).join(" ")} fill="none" stroke="#00aeff" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
          {quadrat?<rect {...quadrat} fill="none" stroke="#ffd900" strokeWidth="3" vectorEffect="non-scaling-stroke"/>:null}
          {frameCorners ? frameCellPolygons(frameCorners).map((polygon,index)=><polygon key={`frame-cell-${index}`} points={polygon.map(p=>`${p.x*w},${p.y*h}`).join(" ")} fill={index%2?"#2b8a6e18":"#ffd90018"} stroke="#00674d" strokeWidth="2" vectorEffect="non-scaling-stroke"/>) : null}
          {pendingFrameCorners.map((point,index)=><circle key={`frame-point-${index}`} cx={point.x*w} cy={point.y*h} r="5" fill="#00674d" stroke="white"/>)}
          {first?<circle cx={first.x*w} cy={first.y*h} r="5" fill="#ffd900" stroke="black"/>:null}
          {step===1&&!original?config.samples.map((s,i)=><circle key={i} cx={s.x*w} cy={s.y*h} r="3" fill={`rgb(${s.rgb.join(",")})`} stroke="white"/>):null}
          {step===1&&!original&&picker.pending?<GuidedToneMarker sample={picker.pending} width={w} height={h}/>:null}
          {keyboard?<circle cx={cursor.x*w} cy={cursor.y*h} r="5" fill="none" stroke="yellow"/>:null}
        </svg>
      </>}
    </div><aside className="eco-tools">
      {existing&&!usable?<p className="eco-small">El tronco cambió desde el último cuadrante. Revisa uno nuevo; el anterior solo se sustituirá al guardar.</p>:null}
      {step===0?<><h2 style={{margin:0}}>Elige tu cuadrante</h2><p>{first?"Ahora marca la esquina opuesta.":"Haz clic en dos esquinas opuestas, dentro del tronco azul."}</p>
        <p className="eco-small">Amarillo = área que se medirá. El contorno del tronco y el análisis general no se modifican.</p>
        <p className="eco-small">Sin escala física: mediremos porcentaje de esta área, no cm² ni calidad del aire.</p>
        {canRegisterFrame?<><label className="eco-small"><input type="checkbox" checked={standardized} onChange={e=>{setStandardized(e.target.checked);setDirty(true);}}/> Usar marco físico conocido de 10 × 50 cm (cinco celdas verticales)</label>
          {standardized?<><button type="button" onClick={()=>{setRegisteringFrame(true);setPendingFrameCorners([]);setFrameConfirmed(false);setDirty(true);}}>Registrar cuatro esquinas del marco</button>
            <p className="eco-small">{frameCorners ? "Marco registrado: las celdas se dibujan sobre sus esquinas." : "Haz clic en orden: superior izquierda, superior derecha, inferior derecha, inferior izquierda."}</p>
            <label className="eco-small"><input type="checkbox" checked={frameConfirmed} disabled={!frameCorners} onChange={e=>{if(e.target.checked&&!frameQuadrat){setError("El marco confirmado no contiene un cuadrante válido dentro del tronco.");return;}setFrameConfirmed(e.target.checked);setDirty(true);}}/> Confirmo la posición del marco físico visible en esta vista.</label></>:null}</>
          :<p className="eco-small">Se necesita una referencia física visible y conocida para usar el marco; mientras tanto solo está disponible el análisis exploratorio.</p>}
        {first?<button onClick={()=>setFirst(null)}>Cancelar esquina</button>:null}
        {quadrat?<button onClick={()=>{setQuadrat(null);setFirst(null);setConfig(emptyEcologyConfig());setFrameCorners(null);setStandardized(false);setDirty(true);setZero(false);}}>Elegir otro cuadrante</button>:null}
      </>:step===1?<>
        <button aria-expanded={open} aria-controls="morph-catalogue" disabled={!!picker.pending||saving||creating} onClick={()=>setOpen(!open)}>{open?"Cerrar catálogo":"Abrir catálogo de la jornada"}</button>
        {open?<MorphCatalogue catalog={catalog} reviews={reviews} selectedId={selectedId} disabled={!!picker.pending||saving} busy={creating} onSelect={choose} onCreate={()=>void create()} onRename={async(m,name)=>onCatalog(await services.renameMorph(m,name))}/>:null}
        {assigned?<GuidedColorControls catalogue groupNames={groupNames} picker={picker} config={config} onFocusPhoto={()=>photo.current?.focus()}/>:<p>Elige una morfoespecie del catálogo o crea una nueva. Después toca sus colores en la foto.</p>}
        {!config.samples.length?<label className="eco-small"><input type="checkbox" checked={zero} disabled={!!picker.pending} onChange={e=>{setZero(e.target.checked);setDirty(true);}}/> Revisé el cuadrante y no marqué ninguna morfoespecie.</label>:null}
      </>:<><h2 style={{margin:0}}>{standardized?"Revisión de presencia por celda":"Resumen del cuadrante"}</h2>
        {standardized?<CellReviewMatrix catalog={catalog} config={config} decisions={decisionFingerprint===currentSourceFingerprint?cellDecisions:{}} proposed={proposedCells} onChange={next=>{setCellDecisions(next);setDecisionFingerprint(currentSourceFingerprint);setDirty(true);}}/>:null}
        {config.confirmed!.groups.filter(g=>g.id!=="unassigned"&&(picker.accepted?.counts[g.label]??0)>0).map(g=><p key={g.id} style={{overflowWrap:"anywhere"}}>{groupNames[g.id]??g.name}: <strong>{pct(picker.accepted!.counts[g.label])}</strong></p>)}
        <p>Sin clasificar: <strong>{pct(picker.accepted?.counts[1]??0)}</strong></p><p className="eco-small">Sin clasificar no significa corteza. Las áreas aceptadas no se cuentan dos veces.</p>
        <p className="eco-small">Morfoespecies reconocidas por ti; no son identificaciones taxonómicas verificadas. El resultado se vincula a este árbol, vista y jornada.</p>
      </>}
      {step>0?<button aria-pressed={original} onClick={()=>setOriginal(!original)}>{original?"Ver selección":"Comparar con original"}</button>:null}
      {error?<p role="alert" style={{color:"#aa3322"}}>{error}</p>:null}
    </aside></main>
    <footer><span className="eco-caption">{dirty?"Cambios sin guardar":"El análisis general del árbol se conserva"}</span>
      <div style={{display:"flex",gap:8}}>{step>0?<button disabled={saving||creating||!!picker.pending} onClick={()=>{if(step===1&&config.samples.length&&!window.confirm("Cambiar de cuadrante borrará los tonos de este análisis al elegir otra área. ¿Continuar?"))return;setStep(step-1);setOriginal(false);}}>Atrás</button>:null}
      {step<2?<button className="g-primary" disabled={!pixels||!quadrat||!!first||!!picker.pending||creating||!picker.accepted||(step===0&&standardized&&!frameContinuationReady(Boolean(pixels),frame,frameConfirmed,frameQuadrat))||(step===1&&!config.samples.length&&!zero)} onClick={()=>{setStep(step+1);setOriginal(false);}}>{step===0?"Usar este cuadrante":"Revisar cobertura"}</button>
        :<button className="g-primary" disabled={saving||!picker.accepted} onClick={()=>void save()}>{saving?"Guardando…":"Guardar cuadrante"}</button>}</div>
    </footer>
  </section>;
}

"use client";
import { useEffect, useState } from "react";
import EcologyEditor from "./EcologyEditor";
import { ecologyServices, type EcologyData, type EcologyServices } from "./ecology-client";
import { observedMorphs, morphDisplayName, type Morphospecies } from "./ecology";
import EcologySummary from "./EcologySummary";
import { currentQuadrat } from "./ecology-summary";
export { currentQuadrat } from "./ecology-summary";
import MorphNameEditor from "./MorphNameEditor";
import { DIRECTIONS, DIRECTION_LABELS, type Direction } from "./types";
import { guidedResultHref } from "./guided-results";

export default function EcologyJourney({eventId,initialSampleId,services=ecologyServices}:{eventId?:string;initialSampleId?:string;services?:EcologyServices}){
  const[data,setData]=useState<EcologyData|null>(null),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
  const[active,setActive]=useState<{sampleId:string;direction:Direction}|null>(null),[notice,setNotice]=useState("");
  const[panel,setPanel]=useState<"summary"|"quadrats">(initialSampleId?"quadrats":"summary");
  useEffect(()=>{if(!eventId)return;const abort=new AbortController();setData(null);setError("");
    setActive(null);setNotice("");
    void services.load(eventId,abort.signal).then(value=>{if(!abort.signal.aborted)setData(value);}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:"No se pudo abrir la jornada.");});return()=>abort.abort();
  },[eventId,attempt,services]);
  if(!eventId)return <section><h1>Análisis de diversidad</h1><p>Abre una jornada para usar su catálogo de morfoespecies.</p><a className="underline" href="/analysis">Elegir jornada</a></section>;
  if(error)return <section><h1>Análisis de diversidad</h1><p role="alert">{error}</p><button className="underline" onClick={()=>setAttempt(attempt+1)}>Reintentar lectura</button><p><a className="underline" href={`/analysis?eventId=${encodeURIComponent(eventId)}`}>Volver a resultados</a></p></section>;
  if(!data)return <p role="status">Abriendo cuadrantes y catálogo de la jornada…</p>;
  const updateCatalog=(m:Morphospecies)=>setData(prev=>prev?{...prev,catalog:[...prev.catalog.filter(c=>c.id!==m.id),m].sort((a,b)=>a.ordinal-b.ordinal)}:prev);
  const tree=active&&data.rows.find(r=>r.sampleId===active.sampleId),imageId=tree&&tree.views[active!.direction].imageId;
  if(tree&&imageId&&active){
    const source=data.sources[imageId];
    return <EcologyEditor key={imageId} ownerId={tree.project.owner_id} eventId={eventId} sampleId={tree.sampleId} imageId={imageId}
      direction={active.direction} treeName={tree.tree.code} source={source} catalog={data.catalog} reviews={data.reviews}
      existing={data.reviews.find(r=>r.image_id===imageId)} services={services}
      onCatalog={updateCatalog}
      onSaved={r=>{setData(prev=>prev?{...prev,reviews:[...prev.reviews.filter(s=>s.image_id!==r.image_id),r]}:prev);setNotice(`${tree.tree.code} · ${DIRECTION_LABELS[active.direction]}: cuadrante guardado.`);setActive(null);}}
      onClose={()=>setActive(null)}/>;
  }
  const valid=data.rows.flatMap(r=>DIRECTIONS.flatMap(d=>{const q=currentQuadrat(data,r.sampleId,d);return q.state==="saved"?[q.row!]:[];}));
  const allMorphs=new Set(valid.flatMap(r=>observedMorphs(r.review)));
  const sorted=[...data.rows].sort((a,b)=>Number(b.sampleId===initialSampleId)-Number(a.sampleId===initialSampleId));
  return <section className="space-y-5">
    <header><h1 className="text-2xl font-bold">Análisis de diversidad</h1><p>{data.rows[0]?.event.name??"Jornada"} · cuadrantes y morfoespecies</p>
      {data.rows[0]?<p className="text-sm text-stone-600">{data.rows[0].project.name} · {data.rows[0].site.name}</p>:null}
      <div className="mt-2 flex flex-wrap gap-4"><a className="text-sm underline" href={`/analysis?eventId=${encodeURIComponent(eventId)}`}>Ver análisis general y 360°</a>
        <a className="text-sm underline" href={`/jornada/${encodeURIComponent(eventId)}`}>Volver a la jornada</a>
        <button type="button" className="text-sm underline" onClick={()=>setAttempt(attempt+1)}>Actualizar resultados</button></div></header>
    {notice?<p role="status" className="rounded bg-emerald-50 p-3">{notice}</p>:null}
    <div className="flex flex-wrap gap-2" aria-label="Secciones del análisis ecológico">
      {([["summary","Resumen de jornada"],["quadrats","Cuadrantes y catálogo"]] as const).map(([key,label])=><button key={key} type="button" aria-pressed={panel===key}
        className={`rounded-lg border px-4 py-2 font-semibold ${panel===key?"bg-emerald-800 text-white":"bg-white"}`} onClick={()=>setPanel(key)}>{label}</button>)}
    </div>
    {panel==="summary"?<EcologySummary data={data} eventId={eventId} onReview={(sampleId,direction)=>{setNotice("");setActive({sampleId,direction});}}/>:<>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[[valid.length,"Cuadrantes guardados"],[data.rows.length*4-valid.length,"Vistas sin cuadrante vigente"],
      [allMorphs.size,"Morfoespecies registradas"],[new Set(valid.map(r=>r.tree_sample_id)).size,"Árboles con cuadrante"]].map(([n,label])=><div key={label} className="rounded border bg-white p-3"><strong className="text-2xl">{n}</strong><p className="text-sm">{label}</p></div>)}</div>
    <p className="rounded bg-amber-50 p-3 text-sm">Exploratorio: cobertura relativa dentro de cada cuadrante sin escala física. Los colores ayudan a delimitar grupos; no confirman especies ni calidad del aire. No sumamos porcentajes de fotos distintas ni tratamos vistas pendientes como cero.</p>
    <details className="rounded border bg-white p-4"><summary className="cursor-pointer font-semibold">Catálogo de la jornada · {data.catalog.length} morfoespecies</summary>
      <p className="my-2 text-sm">Puedes abrir este mismo catálogo al marcar colores en cualquier vista. Crear una entrada no significa haberla observado.</p>
      <ul>{data.catalog.map(m=><li key={m.id} className="my-3 text-sm" style={{overflowWrap:"anywhere"}}><strong>{morphDisplayName(m)}</strong> · {new Set(valid.filter(r=>observedMorphs(r.review).includes(m.id)).map(r=>r.tree_sample_id)).size} árbol(es) · {valid.filter(r=>observedMorphs(r.review).includes(m.id)).length} cuadrante(s)
        <MorphNameEditor morph={m} onSave={async(m,name)=>updateCatalog(await services.renameMorph(m,name))}/></li>)}</ul>
    </details>
    {!sorted.length?<p>No hay árboles en esta jornada. <a href={`/jornada/${encodeURIComponent(eventId)}`} className="underline">Volver a la jornada</a></p>:null}
    {sorted.map(r=>{const treeMorphs=new Set(valid.filter(v=>v.tree_sample_id===r.sampleId).flatMap(v=>observedMorphs(v.review)));
      return <article key={r.sampleId} className="rounded-xl border bg-white p-4"><div className="mb-3 flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-bold">{r.tree.code}</h2><p className="text-sm">{treeMorphs.size} morfoespecies registradas en sus cuadrantes</p></div><a className="text-sm underline" href={guidedResultHref(r)}>Ver tronco y sus 4 vistas</a></div>
        <div className="grid gap-3 md:grid-cols-4">{DIRECTIONS.map(d=>{const q=currentQuadrat(data,r.sampleId,d),review=q.state==="saved"?q.row!.review:null;
          return <div key={d} className="rounded-lg border p-3"><h3 className="font-bold">{DIRECTION_LABELS[d]}</h3>
            {review?<><p className="my-2 text-sm text-emerald-800">Cuadrante guardado</p>
              {review.config.confirmed!.groups.filter(g=>g.id!=="unassigned"&&review.counts[g.label]>0).map(g=><p key={g.id} className="text-sm" style={{overflowWrap:"anywhere"}}>{morphDisplayName(data.catalog.find(m=>m.id===g.id)!)}: {(100*review.counts[g.label]/review.total).toFixed(1)} %</p>)}
              <p className="text-sm">Sin clasificar: {(100*review.counts[1]/review.total).toFixed(1)} %</p>
              {!observedMorphs(review).length?<p className="text-sm">Revisado sin morfoespecies marcadas.</p>:null}
            </>:<p className="my-2 text-sm">{q.state==="changed"?"El tronco cambió: revisar cuadrante.":q.state==="unavailable"?"Guarda primero la vista y su tronco.":"Cuadrante pendiente."}</p>}
            <button className="mt-3 rounded border px-3 py-2 text-sm font-semibold disabled:opacity-40" disabled={q.state==="unavailable"} onClick={()=>{setNotice("");setActive({sampleId:r.sampleId,direction:d});}}>{review?"Revisar cuadrante":"Elegir cuadrante"}</button>
          </div>;
        })}</div>
      </article>;
    })}</>}
  </section>;
}

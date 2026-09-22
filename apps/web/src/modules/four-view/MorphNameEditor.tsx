"use client";
import { useRef, useState } from "react";
import { morphDisplayName, morphName, normalizeMorphName, type Morphospecies } from "./ecology";

// Catalogue metadata only. Never rewrite a saved review or restart colour matching.
export default function MorphNameEditor({ morph, disabled=false, onSave }: {
  morph:Morphospecies; disabled?:boolean; onSave:(m:Morphospecies,name:string)=>Promise<void>;
}) {
  const [editing,setEditing]=useState(false),[name,setName]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  const inFlight=useRef(false),base=useRef(morph),button=useRef<HTMLButtonElement>(null);
  const close=()=>{if(inFlight.current)return;setEditing(false);setError("");requestAnimationFrame(()=>button.current?.focus());};
  const save=async()=>{
    if(disabled||inFlight.current)return;
    try{normalizeMorphName(name);}catch(e){setError((e as Error).message);return;}
    inFlight.current=true;setSaving(true);setError("");
    try{await onSave(base.current,name);inFlight.current=false;close();}
    catch(e){setError(e instanceof Error?e.message:"No se pudo guardar el nombre.");}
    finally{inFlight.current=false;setSaving(false);}
  };
  return <div style={{fontSize:12,marginTop:4}}>
    {!editing?<button ref={button} type="button" aria-label={`Editar nombre de ${morphDisplayName(morph)}`} disabled={disabled}
      style={{fontSize:12,textDecoration:"underline"}} onClick={()=>{base.current=morph;setName(morphDisplayName(morph));setError("");setEditing(true);}}>Editar nombre</button>
      :<div style={{padding:10,border:"1px solid #b5cbbc",borderRadius:10,background:"#f5faf6"}}>
        <label style={{display:"block"}}>Nombre en esta jornada
          <input autoFocus aria-label={`Nombre de ${morphName(morph.ordinal)}`} value={name} maxLength={80} disabled={saving||disabled}
            onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void save();}if(e.key==="Escape"){e.preventDefault();close();}}}
            style={{display:"block",width:"100%",minHeight:42,border:"1px solid #a5bfb2",borderRadius:8,padding:8,font:"inherit",margin:"6px 0"}}/>
        </label>
        <p style={{fontSize:11,margin:"6px 0"}}>Se actualiza en todas las vistas de esta jornada. Vacío = {morphName(morph.ordinal)}.</p>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button type="button" disabled={saving||disabled} onClick={()=>void save()} style={{padding:"6px 10px",borderRadius:8,background:"#00674d",color:"white"}}>{saving?"Guardando nombre…":"Guardar nombre"}</button>
          <button type="button" disabled={saving} onClick={close} style={{padding:"6px 10px",textDecoration:"underline"}}>Cancelar</button>
        </div>
        {error?<p role="alert" style={{color:"#aa3322",marginTop:6}}>{error}</p>:null}
      </div>}
  </div>;
}

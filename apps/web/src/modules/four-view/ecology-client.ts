"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { loadGuidedResults, readResultPages } from "./guided-results-client";
import { parseGuidedReview, type GuidedReview } from "./guided-flow";
import { normalizeMorphName, parseEcologyReview, type EcologyReview, type EcologyRow, type Morphospecies } from "./ecology";
import { guidedServices } from "./guided-service";
import type { Direction } from "./types";
const db = supabase as SupabaseClient;
const message = (code?: string) => code === "40001" ? "Otra pestaña guardó cambios. Cierra este editor y vuelve a abrir la vista para revisar la versión actual."
  : code === "42501" || code === "22023" ? "La foto, el tronco o la jornada cambiaron. Vuelve a los resultados y abre la vista actual."
  : "No se pudo confirmar el guardado. Conserva esta pestaña abierta y reintenta.";
export function parseEcologyRow(data: unknown): EcologyRow {
  const row = data as EcologyRow, review = parseEcologyReview(row?.review);
  if (!review || !Number.isSafeInteger(row?.revision) || row.revision < 1 || !row.image_id || !row.event_id || !row.tree_sample_id || !["N","E","S","W"].includes(row.direction))
    throw new Error("Hay un cuadrante guardado que necesita revisión. No se reemplazó ni se contó como cero.");
  return { ...row, review };
}
export const ecologyServices = {
  async load(eventId: string, signal?: AbortSignal) {
    const rows = await loadGuidedResults(db, eventId, signal);
    const catalog = await readResultPages<Morphospecies>(async (from,to) => {
      let query = db.from("jornada_morphospecies").select("id,event_id,ordinal,custom_name,name_revision").eq("event_id",eventId).order("ordinal").range(from,to);
      if (signal) query=query.abortSignal(signal); return await query;
    },signal);
    if (catalog.some(m => m.event_id!==eventId || !Number.isInteger(m.ordinal) || m.ordinal<1 || m.ordinal>64)) throw new Error("El catálogo no es válido.");
    const saved = await readResultPages<EcologyRow>(async(from,to) => {
      let query=db.from("ecological_quadrat_reviews").select("image_id,event_id,tree_sample_id,direction,review,revision").eq("event_id",eventId).order("image_id").range(from,to);
      if(signal)query=query.abortSignal(signal);return await query;
    },signal);
    const sources: Record<string,GuidedReview> = {};
    const ids=rows.flatMap(r=>Object.values(r.views).flatMap(v=>v.imageId?[v.imageId]:[]));
    for(let i=0;i<ids.length;i+=100){
      const values=await readResultPages<{image_id:string;review:unknown}>(async(from,to)=>{
        let query=db.from("guided_capture_reviews").select("image_id,review").in("image_id",ids.slice(i,i+100)).order("image_id").range(from,to);
        if(signal)query=query.abortSignal(signal);return await query;
      },signal);
      for(const value of values){const review=parseGuidedReview(JSON.stringify(value.review));if(review)sources[value.image_id]=review;}
    }
    const calibrated = await readResultPages<{image_id:string;processing_status:string;pixels_per_cm:number|null;
      rectified_width_px:number|null;rectified_height_px:number|null;calibration_method:string|null;confirmed_corners:unknown}>(
      async (from,to) => {
        let query = db.from("capture_views")
          .select("image_id,processing_status,pixels_per_cm,rectified_width_px,rectified_height_px,calibration_method,confirmed_corners")
          .in("image_id",ids).eq("active",true).range(from,to);
        if(signal) query=query.abortSignal(signal);
        return await query;
      },signal);
    for(const view of calibrated) {
      const source=sources[view.image_id];
      const method=view.calibration_method==="manual_confirmed" ? "manual_confirmed"
        : view.calibration_method==="automatic" ? "automatic" : null;
      const corners=Array.isArray(view.confirmed_corners) && view.confirmed_corners.length===4;
      if(source && view.processing_status==="calibrated" && method && corners
        && typeof view.pixels_per_cm==="number" && typeof view.rectified_width_px==="number" && typeof view.rectified_height_px==="number") {
        sources[view.image_id]={...source,calibration:{pixelsPerCm:view.pixels_per_cm,method,
          width:view.rectified_width_px,height:view.rectified_height_px}};
      }
    }
    const reviews=saved.filter(r=>ids.includes(r.image_id)).map(parseEcologyRow);
    if(reviews.some(r=>r.review.config.confirmed!.groups.some(g=>g.id!=="unassigned"&&!catalog.some(m=>m.id===g.id))))throw new Error("No se pudo vincular una morfoespecie con el catálogo de esta jornada.");
    return {rows,catalog,reviews,sources};
  },
  photo: guidedServices.storedPhoto,
  async createMorph(eventId:string,id:string):Promise<Morphospecies>{
    const {data,error}=await db.rpc("create_jornada_morphospecies",{p_event_id:eventId,p_id:id}).single();
    if(error)throw new Error(error.code==="22023"?"El catálogo admite hasta 64 morfoespecies.":message(error.code));
    const m=data as Morphospecies;if(!m?.id||m.event_id!==eventId||!Number.isInteger(m.ordinal))throw new Error("No se pudo leer la morfoespecie creada. Reintenta.");return m;
  },
  async save(eventId:string,sampleId:string,imageId:string,direction:Direction,review:EcologyReview,revision:number):Promise<EcologyRow>{
    const valid=parseEcologyReview(review);if(!valid)throw new Error("El cuadrante no es válido y no se guardó.");
    const{data,error}=await db.rpc("save_ecological_quadrat",{p_event_id:eventId,p_tree_sample_id:sampleId,p_image_id:imageId,p_direction:direction,p_review:valid,p_expected_revision:revision}).single();
    if(error)throw new Error(message(error.code));return parseEcologyRow(data);
  },
  async renameMorph(morph:Morphospecies,name:string):Promise<Morphospecies>{
    const customName=normalizeMorphName(name);
    const {data,error}=await db.rpc("rename_jornada_morphospecies",{p_event_id:morph.event_id,p_id:morph.id,p_name:customName,p_expected_revision:morph.name_revision??1}).single();
    if(error)throw new Error(error.code==="40001"?"El nombre cambió en otra pestaña. Vuelve a abrir los resultados para ver el nombre actual antes de editarlo."
      :error.code==="22023"?"Usa un nombre de hasta 80 caracteres, en una sola línea."
      :error.code==="42501"?"No tienes acceso para editar este catálogo.":"No se pudo confirmar el nombre. Conserva este texto y reintenta guardar.");
    const m=data as Morphospecies;
    if(m?.id!==morph.id||m.event_id!==morph.event_id||m.ordinal!==morph.ordinal||m.custom_name!==customName||!Number.isSafeInteger(m.name_revision))
      throw new Error("No se pudo confirmar el nombre guardado. Reintenta.");
    return m;
  },
};
export type EcologyServices=typeof ecologyServices;
export type EcologyData=Awaited<ReturnType<EcologyServices["load"]>>;

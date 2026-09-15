import "../region-suggestions/component-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { GuidedCapture } from "./GuidedCapture.tsx";
import { parseGuidedReview, type GuidedReview } from "./guided-flow.ts";
import { orderedCloudWriter, reviewFingerprint, type CloudReview, type GuidedCloudStore } from "./guided-cloud.ts";
import { classifyTrunkColors } from "../region-suggestions/trunk-colors.ts";
import type { SuggestionResponse } from "../region-suggestions/client.ts";
import { TreeSummary } from "./TreeSummary.tsx";
import { colorWorkingSize } from "../region-suggestions/trunk-colors.ts";

test("lichen-only analysis does not require bark and never calls unmatched pixels bark", async () => {
  const result = await classifyTrunkColors(new Uint8ClampedArray([80,170,80,255, 120,50,20,255]),2,1,
    [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],
    { version:1,tolerance:5,samples:[{x:0,y:0,rgb:[80,170,80],label:3}] },undefined,"lichen-only");
  assert.equal(result.lichen,1); assert.equal(result.total,2); assert.equal(result.counts[2],0); assert.equal(result.counts[1],1);
});
for (const aiUnavailable of [false, true]) test(`wizard cloud save/restore, only lichen samples, North to East; AI unavailable=${aiUnavailable}`, async () => {
  localStorage.clear();
  const oldContext=HTMLCanvasElement.prototype.getContext, oldData=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage(){},getImageData(_x:number,_y:number,w:number,h:number){
    const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i+=4)data.set([80,170,80,255],i);return {data};
  },createImageData(w:number,h:number){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){} })) as never;
  HTMLCanvasElement.prototype.toDataURL=()=>"data:image/png;base64,test";
  const photos:string[]=[], owner="owner", tree="sample", image="image-n";
  let remote: CloudReview | null = null, failSave = false;
  const cloud: GuidedCloudStore = { async read(){return remote;}, async write(ref,review,revision){
    assert.equal(ref.imageId,image); assert.equal(ref.direction,"N"); assert.equal(ref.ownerId,owner);
    if(failSave) throw new Error("Cloud offline");
    assert.equal(revision, remote?.revision ?? 0);
    remote={review:JSON.parse(reviewFingerprint(review)),revision:revision+1};return remote;
  }};
  const services={cloud,async load(){return {ownerId:owner,treeSampleId:tree,views:{N:image},completed:false};},async photo(_owner:string,id:string){photos.push(id);return new Blob(["photo"]);},async storedPhoto(){throw new Error("No summary expected");},async upload(){throw new Error("No upload expected");}};
  let calls=0;
  const ai={context:{imageId:image,treeSampleId:tree,direction:"N"},suggestions:[{regionId:"sample-0",ranking:[{label:"lichen"}]}]} as SuggestionResponse;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const button=(text:string)=>{const b=Array.from(host.querySelectorAll("button")).find(b=>b.textContent===text);assert.ok(b,text);return b;};
  const click=async(text:string)=>{await act(async()=>button(text).click());};
  const point=async(x:number,y:number)=>{await act(async()=>host.querySelector("svg")!.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,clientX:x,clientY:y})));};
  try {
    await act(async()=>{root.render(createElement(GuidedCapture,{context:{projectId:"project",siteId:"site",eventId:"event",treeId:"tree"},contextLabel:"My tree",backHref:"/jornada",services,checkSamples:async()=>{calls++;if(aiUnavailable)throw new Error("Worker unavailable");return ai;}}));});
    await act(async()=>{host.querySelector("img")!.dispatchEvent(new Event("load",{bubbles:true}));});
    assert.deepEqual(photos,[image]);assert.equal(host.querySelectorAll("svg").length,1);assert.equal(calls,0);
    await click("Continuar");await click("Continuar");assert.match(host.textContent!,/Añade al menos tres puntos/);
    for(const [x,y] of [[40,30],[360,30],[360,270],[40,270]])await point(x,y);
    await click("Continuar");assert.match(host.textContent!,/No selecciones colores de corteza/);
    assert.equal(button("Analizar selección").disabled,true);await point(200,150);assert.equal(button("Analizar selección").disabled,false);
    await click("Analizar selección");
    for(let i=0;i<80 && !host.textContent!.includes(aiUnavailable?"Worker unavailable":"Revisa y guarda");i++) await act(async()=>{await new Promise(r=>setTimeout(r,10));});
    if(aiUnavailable){assert.match(host.textContent!,/Sin revisión de IA/);await click("Revisar sin IA");}
    assert.equal(calls,1);assert.match(host.textContent!,/100.0 %/);assert.equal(host.querySelectorAll("svg").length,1);
    failSave=true;
    await click("Guardar y pasar a Este");assert.match(host.textContent!,/No avanzamos/);assert.match(host.textContent!,/Norte · 1 de 4/);
    failSave=false;
    const storage=Object.getPrototypeOf(localStorage), oldSet=storage.setItem;
    try { // Local quota cannot prevent a successful cloud save.
      storage.setItem=()=>{throw new Error("quota");};
      await click("Guardar y pasar a Este");
    } finally { storage.setItem=oldSet; }
    assert.match(host.textContent!,/Este · 2 de 4/);assert.match(host.textContent!,/Sube una fotografía/);
    assert.ok((remote as CloudReview | null)?.review.savedAt);
    assert.equal(Boolean((remote as CloudReview | null)?.review.analysis?.ai),!aiUnavailable);
    assert.equal(photos.length,1); // no hidden four-photo analysis or download
    await click("E");assert.match(host.textContent!,/Este · 2 de 4/);
    localStorage.clear();
    await click("N ✓");
    assert.match(host.textContent!,/Esta vista ya tiene una revisión guardada/);
    assert.match(host.textContent!,/Guardado en la nube/);
    assert.doesNotMatch(host.textContent!,/Recuperar borrador local distinto/);
    assert.equal(host.querySelectorAll("svg circle").length,0); // still on photo step
    await act(async()=>{host.querySelector("img")!.dispatchEvent(new Event("load",{bubbles:true}));});
    for(let i=0;i<80 && !host.textContent!.includes("Revisa y guarda");i++) await act(async()=>{await new Promise(r=>setTimeout(r,10));});
    assert.match(host.textContent!,/Revisa y guarda/); // reopen saved review, without a new analysis
    assert.match(host.textContent!,/100.0 %/);
    await click("Atrás");await click("Atrás");
    assert.match(host.textContent!,/4 puntos/); // restored without local cache
    assert.equal(calls,1); // restore never invokes AI
  } finally { await act(async()=>root.unmount());host.remove();HTMLCanvasElement.prototype.getContext=oldContext;HTMLCanvasElement.prototype.toDataURL=oldData; }
});

test("jsonb key ordering is not a dirty edit, but arrays retain their order", () => {
  assert.equal(reviewFingerprint({b:{y:2,x:1},a:[1,2]}),reviewFingerprint({a:[1,2],b:{x:1,y:2}}));
  assert.notEqual(reviewFingerprint({a:[1,2]}),reviewFingerprint({a:[2,1]}));
});

test("cloud writer orders autosave and final save and keeps optimistic revisions", async () => {
  const draft: GuidedReview={version:1,outline:[],config:{version:1,tolerance:12,samples:[]},analysis:null,savedAt:null};
  const seen:number[]=[];let release!:()=>void;
  const barrier=new Promise<void>(r=>{release=r;});
  const store:GuidedCloudStore={async read(){return null;},async write(_ref,review,revision){
    seen.push(revision);if(seen.length===1)await barrier;return {review,revision:revision+1};
  }};
  const write=orderedCloudWriter(store,{ownerId:"owner",treeSampleId:"tree",direction:"N",imageId:"image"},3);
  const a=write(draft),b=write({...draft,outline:[{x:.1,y:.1}]});
  await Promise.resolve();assert.deepEqual(seen,[3]);release();
  assert.equal((await a).revision,4);assert.equal((await b).revision,5);assert.deepEqual(seen,[3,4]);
});

test("cloud failure never advances the revision or discards the retry", async () => {
  const draft: GuidedReview={version:1,outline:[],config:{version:1,tolerance:12,samples:[]},analysis:null,savedAt:null};
  let fail=true;const seen:number[]=[];
  const store:GuidedCloudStore={async read(){return null;},async write(_ref,review,revision){
    seen.push(revision);if(fail)throw new Error("offline");return {review,revision:revision+1};
  }};
  const write=orderedCloudWriter(store,{ownerId:"owner",treeSampleId:"tree",direction:"N",imageId:"image"},0);
  await assert.rejects(write(draft),/offline/);fail=false;
  assert.equal((await write(draft)).revision,1);assert.deepEqual(seen,[0,0]);
  assert.equal(parseGuidedReview(JSON.stringify({...draft,analysis:{total:1}})),null);
});

const summaryReview = (lichen: number): GuidedReview => ({ version:1,
  outline:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],
  config:{version:1,tolerance:12,samples:[{x:.5,y:.5,rgb:[80,170,80],label:3}]},
  savedAt:"2026-09-15T12:00:00Z",analysis:{width:10,height:10,total:100,lichen,counts:[0,100-lichen,0,lichen,0,0],ai:null},
});
test("tree summary shows each saved result and missing view, survives photo error, never writes or invokes AI", async () => {
  const reads:string[]=[],photos:string[]=[],edits:string[]=[];
  const services={cloud:{async read(ref:{imageId:string;ownerId:string;treeSampleId:string;direction:string}){
    assert.equal(ref.ownerId,"owner");assert.equal(ref.treeSampleId,"sample");reads.push(`${ref.direction}:${ref.imageId}`);
    return {revision:1,review:summaryReview(ref.direction==="N"?10:ref.direction==="E"?20:30)};
  },async write(){throw new Error("No writes allowed");}},async storedPhoto(_owner:string,id:string){photos.push(id);if(id==="e")throw new Error("Photo offline");return new Blob([id]);},
  async photo(){throw new Error("No preparation allowed");},async upload(){throw new Error("No upload allowed");},async load(){throw new Error("Session already loaded");}};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(createElement(TreeSummary,{session:{ownerId:"owner",treeSampleId:"sample",views:{N:"n",E:"e",S:"s"},completed:false},services,onEdit:d=>edits.push(d)})));
    assert.deepEqual(reads,["N:n","E:e","S:s"]);assert.deepEqual(photos,["n","e","s"]);
    assert.equal(host.querySelectorAll("article").length,4);assert.match(host.textContent!,/3 de 4 vistas/);
    const cards=Array.from(host.querySelectorAll("article"));
    assert.match(cards[0].textContent!,/10.0 %/);assert.match(cards[1].textContent!,/20.0 %/);
    assert.match(cards[1].textContent!,/Photo offline/);assert.match(cards[2].textContent!,/30.0 %/);
    assert.match(cards[3].textContent!,/Sin fotografía/);assert.doesNotMatch(cards[3].textContent!,/0.0 %/);
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Ampliar Norte"]')!.click());
    assert.equal(host.querySelectorAll("article").length,1);assert.equal(photos.length,3);
    await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Ver las cuatro vistas")!.click());
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Completar Oeste"]')!.click());
    assert.deepEqual(edits,["W"]);assert.equal(reads.length,3);
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("saving the last missing direction opens all four views; summary edit/save returns there without AI", async () => {
  localStorage.clear();
  const oldContext=HTMLCanvasElement.prototype.getContext,oldData=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.getContext=(()=>({drawImage(){},getImageData(_x:number,_y:number,w:number,h:number){const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i+=4)data.set([80,170,80,255],i);return {data};},createImageData(w:number,h:number){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){}})) as never;
  HTMLCanvasElement.prototype.toDataURL=()=>"data:image/png;base64,test";
  const {width,height}=colorWorkingSize(1200,900), total=width*height;
  const base=summaryReview(100);base.analysis={...base.analysis!,width,height,total,lichen:total,counts:[0,0,0,total,0,0]};
  const rows=new Map(["N","E","S","W"].map(d=>[d,{review:{...base,savedAt:d==="N"?null:base.savedAt},revision:1}]));
  let writes=0,preparations=0,reads=0,aiCalls=0;
  const services={cloud:{async read(ref:{direction:string}){return rows.get(ref.direction)!;},async write(ref:{direction:string},review:GuidedReview,revision:number){writes++;assert.equal(rows.get(ref.direction)!.revision,revision);const row={review,revision:revision+1};rows.set(ref.direction,row);return row;}},
    async load(){return {ownerId:"owner",treeSampleId:"sample",views:{N:"n",E:"e",S:"s",W:"w"},completed:false,savedViews:{E:true,S:true,W:true}};},
    async photo(){preparations++;return new Blob(["photo"]);},async storedPhoto(){reads++;return new Blob(["photo"]);},async upload(){throw new Error("No upload");}};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const click=async(text:string)=>{const button=Array.from(host.querySelectorAll("button")).find(b=>b.textContent===text);assert.ok(button,text);await act(async()=>button.click());};
  const loadImage=async()=>{await act(async()=>host.querySelector("img")!.dispatchEvent(new Event("load",{bubbles:true})));for(let i=0;i<80;i++)await act(async()=>{await new Promise(r=>setTimeout(r,5));});};
  try {
    await act(async()=>root.render(createElement(GuidedCapture,{context:{projectId:"p",siteId:"s",eventId:"e",treeId:"t"},contextLabel:"Project / Day / Tree",backHref:"/jornada/e",services,checkSamples:async()=>{aiCalls++;return {context:{imageId:"n",treeSampleId:"sample",direction:"N"},suggestions:[{regionId:"sample-0",ranking:[{label:"lichen"}]}]} as SuggestionResponse;}})));
    await loadImage();await click("Continuar");await click("Continuar");
    await click("Analizar selección");
    for(let i=0;i<80 && !host.textContent!.includes("Revisa y guarda");i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});
    assert.match(host.textContent!,/Revisa y guarda/);assert.equal(aiCalls,1);
    await click("Guardar y ver árbol");
    assert.equal(host.querySelectorAll("article").length,4);assert.match(host.textContent!,/4 de 4 vistas/);
    assert.doesNotMatch(host.textContent!,/Listo por hoy/);assert.equal(writes,3); // estimate, AI, final confirmation
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Revisar Oeste"]')!.click());
    await loadImage();assert.match(host.textContent!,/Revisa y guarda/);
    await click("Guardar y ver árbol");
    assert.equal(host.querySelectorAll("article").length,4);assert.equal(writes,4);assert.equal(aiCalls,1);
    assert.ok(reads>=4);const before=preparations;
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Ampliar Oeste"]')!.click());
    assert.equal(preparations,before);assert.equal(writes,4);assert.equal(aiCalls,1);
  } finally {await act(async()=>root.unmount());host.remove();HTMLCanvasElement.prototype.getContext=oldContext;HTMLCanvasElement.prototype.toDataURL=oldData;}
});

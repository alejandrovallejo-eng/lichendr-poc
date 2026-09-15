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
  const services={cloud,async load(){return {ownerId:owner,treeSampleId:tree,views:{N:image},completed:false};},async photo(_owner:string,id:string){photos.push(id);return new Blob(["photo"]);},async upload(){throw new Error("No upload expected");}};
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

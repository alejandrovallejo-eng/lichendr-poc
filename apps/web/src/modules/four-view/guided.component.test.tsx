import "../region-suggestions/component-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { GuidedCapture } from "./GuidedCapture.tsx";
import { guidedKey, parseGuidedReview } from "./guided-flow.ts";
import { classifyTrunkColors } from "../region-suggestions/trunk-colors.ts";
import type { SuggestionResponse } from "../region-suggestions/client.ts";

test("lichen-only analysis does not require bark and never calls unmatched pixels bark", async () => {
  const result = await classifyTrunkColors(new Uint8ClampedArray([80,170,80,255, 120,50,20,255]),2,1,
    [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],
    { version:1,tolerance:5,samples:[{x:0,y:0,rgb:[80,170,80],label:3}] },undefined,"lichen-only");
  assert.equal(result.lichen,1); assert.equal(result.total,2); assert.equal(result.counts[2],0); assert.equal(result.counts[1],1);
});
test("one-photo wizard guards steps, asks only lichen samples, saves then opens East", async () => {
  localStorage.clear();
  const oldContext=HTMLCanvasElement.prototype.getContext, oldData=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage(){},getImageData(_x:number,_y:number,w:number,h:number){
    const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i+=4)data.set([80,170,80,255],i);return {data};
  },createImageData(w:number,h:number){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){} })) as never;
  HTMLCanvasElement.prototype.toDataURL=()=>"data:image/png;base64,test";
  const photos:string[]=[], owner="owner", tree="sample", image="image-n";
  const services={async load(){return {ownerId:owner,treeSampleId:tree,views:{N:image},completed:false};},async photo(_owner:string,id:string){photos.push(id);return new Blob(["photo"]);},async upload(){throw new Error("No upload expected");}};
  let calls=0;
  const ai={context:{imageId:image,treeSampleId:tree,direction:"N"},suggestions:[{regionId:"sample-0",ranking:[{label:"lichen"}]}]} as SuggestionResponse;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const button=(text:string)=>{const b=Array.from(host.querySelectorAll("button")).find(b=>b.textContent===text);assert.ok(b,text);return b;};
  const click=async(text:string)=>{await act(async()=>button(text).click());};
  const point=async(x:number,y:number)=>{await act(async()=>host.querySelector("svg")!.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,clientX:x,clientY:y})));};
  try {
    await act(async()=>{root.render(createElement(GuidedCapture,{context:{projectId:"project",siteId:"site",eventId:"event",treeId:"tree"},contextLabel:"My tree",backHref:"/jornada",services,checkSamples:async()=>{calls++;return ai;}}));});
    await act(async()=>{host.querySelector("img")!.dispatchEvent(new Event("load",{bubbles:true}));});
    assert.deepEqual(photos,[image]);assert.equal(host.querySelectorAll("svg").length,1);assert.equal(calls,0);
    await click("Continuar");await click("Continuar");assert.match(host.textContent!,/Añade al menos tres puntos/);
    for(const [x,y] of [[40,30],[360,30],[360,270],[40,270]])await point(x,y);
    await click("Continuar");assert.match(host.textContent!,/No selecciones colores de corteza/);
    assert.equal(button("Analizar selección").disabled,true);await point(200,150);assert.equal(button("Analizar selección").disabled,false);
    await click("Analizar selección");
    for(let i=0;i<80 && !host.textContent!.includes("Revisa y guarda");i++) await act(async()=>{await new Promise(r=>setTimeout(r,10));});
    assert.equal(calls,1);assert.match(host.textContent!,/100.0 %/);assert.equal(host.querySelectorAll("svg").length,1);
    const storage=Object.getPrototypeOf(localStorage), oldSet=storage.setItem;
    try {
      storage.setItem=()=>{throw new Error("quota");};
      await click("Guardar y pasar a Este");assert.match(host.textContent!,/No avanzamos/);assert.match(host.textContent!,/Norte · 1 de 4/);
    } finally { storage.setItem=oldSet; }
    await click("Guardar y pasar a Este");assert.match(host.textContent!,/Este · 2 de 4/);assert.match(host.textContent!,/Sube una fotografía/);
    assert.ok(parseGuidedReview(localStorage.getItem(guidedKey(owner,tree,"N",image)))?.savedAt);
    assert.equal(photos.length,1); // no hidden four-photo analysis or download
    await click("E");assert.match(host.textContent!,/Este · 2 de 4/);
  } finally { await act(async()=>root.unmount());host.remove();HTMLCanvasElement.prototype.getContext=oldContext;HTMLCanvasElement.prototype.toDataURL=oldData; }
});

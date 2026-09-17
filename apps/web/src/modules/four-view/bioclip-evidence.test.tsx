import "../region-suggestions/component-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { BioClipEvidence, evidenceItems } from "./BioClipEvidence.tsx";
import type { SuggestionResponse } from "../region-suggestions/client.ts";

const reference = { imageId: "photo-n", treeSampleId: "tree-1", direction: "N" };
function response(): SuggestionResponse {
  return { context: { ...reference, requestToken: "r1" }, cacheKey: "batch-1",
    suggestions: [
      { regionId: "sample-0", ranking: [{ label: "bare tree bark" }], preprocess: "standard_center_crop" },
      { regionId: "sample-1", ranking: [{ label: "lichen" }], preprocess: "standard_center_crop" },
    ], geometry: [
      { regionId: "sample-1", cropBoxNormalized: { x: .1, y: .2, width: .3, height: .4 } },
      { regionId: "sample-0", cropBoxNormalized: { x: 506/1024, y: 297/768, width: 111/1024, height: 111/768 } },
    ], experimental: { suggestions: [
      { regionId: "sample-1", decision: "lichen" }, { regionId: "sample-0", decision: "undetermined" },
    ] },
  } as SuggestionResponse;
}

test("evidence joins geometry and experimental decisions by identity, not list order", () => {
  const ai=response(), before=JSON.stringify(ai), items=evidenceItems(ai,reference);
  assert.equal(items[0].box?.x,506/1024); assert.equal(items[1].box?.x,.1);
  assert.equal(items[0].habitual,"corteza desnuda");
  assert.equal(items[0].experimental,"Sin determinar");
  assert.equal(items[1].experimental,"Liquen");
  assert.equal(JSON.stringify(ai),before);
  assert.equal(evidenceItems(null,reference).length,0);
  for(const key of ["imageId","treeSampleId","direction"] as const)
    assert.equal(evidenceItems(ai,{...reference,[key]:"different"}).length,0);
});

test("missing, duplicated, nonfinite and out-of-bounds boxes are not invented or silently clamped", () => {
  for(const box of [null,{x:NaN,y:0,width:.1,height:.2},{x:-.1,y:0,width:.1,height:.2},
    {x:0,y:0,width:0,height:.2},{x:.9,y:0,width:.2,height:.2},{x:0,y:Infinity,width:.1,height:.2}]) {
    const ai=response(); ai.geometry=[{regionId:"sample-0",cropBoxNormalized:box as never}];
    assert.equal(evidenceItems(ai,reference)[0].box,null);
  }
  const ai=response(); ai.geometry.push(ai.geometry[1]);
  assert.equal(evidenceItems(ai,reference)[0].box,null);
  delete (ai as Partial<SuggestionResponse>).geometry;
  assert.equal(evidenceItems(ai,reference)[0].box,null);
});

test("crop inspector is collapsed, read-only and bounded; reopen needs no inference or persistence", async () => {
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const ai=response(), before=JSON.stringify(ai), previousFetch=globalThis.fetch;
  let calls=0; globalThis.fetch=(async()=>{calls++;throw new Error("No network allowed");}) as typeof fetch;
  const props={ai,src:"blob:private-proxy",width:1024,height:768,reference};
  const open=async()=>{await act(async()=>{const d=host.querySelector("details")!;d.open=true;d.dispatchEvent(new Event("toggle"));});};
  try {
    await act(async()=>root.render(createElement(BioClipEvidence,props)));
    assert.equal(host.querySelector("details")?.open,false);assert.equal(host.querySelector("svg"),null);
    await open();
    const svg=host.querySelector("svg")!;
    assert.equal(svg.getAttribute("viewBox"),"506 297 111 111");
    assert.equal(svg.querySelector("image")?.getAttribute("href"),props.src);
    assert.ok(svg.querySelector("g")?.getAttribute("clip-path"));
    assert.equal(svg.style.height,"160px");
    assert.match(host.textContent!,/Sin determinar/);assert.match(host.textContent!,/no todos los píxeles/);
    assert.match(host.textContent!,/recorte central/);
    await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Ubicar en la foto")!.click());
    assert.equal(host.querySelector("svg")?.getAttribute("viewBox"),"0 0 1024 768");
    assert.equal(host.querySelector('rect[stroke="#d90079"]')?.getAttribute("x"),"506");
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Ejemplo siguiente"]')!.click());
    assert.match(host.textContent!,/Ejemplo 2 de 2/);
    assert.equal(host.querySelector("svg")?.getAttribute("viewBox"),"102.4 153.60000000000002 307.2 307.20000000000005");
    assert.equal(host.querySelector<HTMLButtonElement>('[aria-label="Ejemplo siguiente"]')?.disabled,true);
    await act(async()=>root.render(createElement(BioClipEvidence,{...props,ai:{...ai,cacheKey:"new-batch"}})));
    assert.equal(host.querySelector("details")?.open,false);
    await open();assert.match(host.textContent!,/Ejemplo 1 de 2/);
    assert.equal(calls,0);assert.equal(JSON.stringify(ai),before);
    await act(async()=>root.render(createElement(BioClipEvidence,{...props,reference:{...reference,direction:"S"}})));
    assert.equal(host.textContent,"");
  } finally {globalThis.fetch=previousFetch;await act(async()=>root.unmount());host.remove();}
});

test("old saved result and unavailable photo retain label without fake thumbnail",async()=>{
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const ai=response();ai.geometry=[];
  try {
    await act(async()=>root.render(createElement(BioClipEvidence,{ai,src:"",width:0,height:0,reference})));
    await act(async()=>{const d=host.querySelector("details")!;d.open=true;d.dispatchEvent(new Event("toggle"));});
    assert.equal(host.querySelector("svg"),null);assert.match(host.textContent!,/No está disponible el recorte/);
    assert.match(host.textContent!,/corteza desnuda/);
  } finally {await act(async()=>root.unmount());host.remove();}
});

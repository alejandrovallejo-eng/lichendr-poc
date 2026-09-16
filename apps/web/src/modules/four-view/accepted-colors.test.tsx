import "../region-suggestions/component-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { acceptColorAddition, classifyTrunkColors, confirmedColorConfig, countColorLabels, initialColorConfig,
  parseColorConfig, proposeColorAddition, type ColorConfig, type ColorSample } from "../region-suggestions/trunk-colors.ts";
import { GuidedColorControls, GuidedToneMarker, proposalDisplayPixels, useGuidedColorPicker } from "./GuidedColorPicker.tsx";
import { parseGuidedReview, analysisRecord } from "./guided-flow.ts";

const outline = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const red = [210, 30, 30], green = [30, 210, 30], brown = [65, 40, 25];
const rgba = (colors: number[][]) => new Uint8ClampedArray(colors.flatMap(c => [...c, 255]));
const tone = (rgb: number[], x = .1, label: ColorSample["label"] = 3): ColorSample =>
  ({ x, y: .5, rgb: rgb as [number, number, number], label, tolerance: 3, excluded: [] });
const blank = () => confirmedColorConfig(initialColorConfig());

test("accept A, add a different tone to A, keep every earlier pixel and count overlap only once", async () => {
  const data = rgba([red, brown, green, red]), base = countColorLabels(new Uint8Array(4).fill(1));
  const p = await proposeColorAddition(data, 4, 1, base, tone(red));
  assert.deepEqual([...base.labels], [1,1,1,1]); // merely proposing has no effect
  const a = acceptColorAddition(base, p.mask, 3);
  const p2 = await proposeColorAddition(data, 4, 1, a, tone(green, .6));
  const combined = acceptColorAddition(a, p2.mask, 3);
  assert.deepEqual([...combined.labels], [3,1,3,3]);
  assert.equal(combined.lichen, 3); assert.equal(combined.total, 4);
  assert.equal((await proposeColorAddition(data, 4, 1, combined, tone(red))).added, 0);
  const config = { ...blank(), samples: [tone(red), tone(green, .6)] };
  assert.deepEqual(await classifyTrunkColors(data,4,1,outline,config,undefined,"lichen-only"),combined);
});

test("a competing group cannot steal accepted A pixels; conflict is separate from new coverage", async () => {
  const data = rgba([red,green,red]), base = countColorLabels(new Uint8Array([3,1,3]));
  const p = await proposeColorAddition(data,3,1,base,tone(red,.1,4));
  assert.equal(p.added,0);assert.equal(p.conflicts,2);
  assert.deepEqual(acceptColorAddition(base,p.mask,4),base);
});

test("exclude one connected island and replay it, preserving the other matching island", async () => {
  const data=rgba([red,red,brown,red]), base=countColorLabels(new Uint8Array(4).fill(1));
  const sample={...tone(red),excluded:[0]};
  const p=await proposeColorAddition(data,4,1,base,sample);
  assert.deepEqual([...p.mask],[0,0,0,1]);
  const config={...blank(),samples:[sample]};
  const a=await classifyTrunkColors(data,4,1,outline,config,undefined,"lichen-only");
  assert.deepEqual([...a.labels],[1,1,1,3]);assert.equal(a.total,4);
});

test("undo last accepted tone leaves the previous selection byte-for-byte unchanged", async () => {
  const data=rgba([red,green,brown]);
  const one={...blank(),samples:[tone(red)]}, two={...one,samples:[...one.samples,tone(green,.5)]};
  const before=await classifyTrunkColors(data,3,1,outline,one,undefined,"lichen-only");
  const afterUndo=await classifyTrunkColors(data,3,1,outline,{...two,samples:two.samples.slice(0,-1)},undefined,"lichen-only");
  assert.deepEqual(before,afterUndo);assert.equal(before.counts[1],2);
});

test("v1 migration preserves ambiguous legacy pixels and saved v1 still parses unchanged", async () => {
  const data=rgba([red,green,brown]);
  const old:ColorConfig={version:1,tolerance:12,samples:[{...tone(red),label:3},{...tone(red),label:4}]};
  const prior=await classifyTrunkColors(data,3,1,outline,old,undefined,"lichen-only");
  const migrated=await classifyTrunkColors(data,3,1,outline,confirmedColorConfig(old),undefined,"lichen-only");
  assert.deepEqual(migrated.labels,prior.labels);assert.equal(migrated.lichen,prior.lichen);
  const review={version:1,outline,config:old,analysis:analysisRecord(prior,3,1,null),savedAt:"2026-09-15T12:00:00Z"};
  assert.ok(parseGuidedReview(JSON.stringify(review))?.savedAt);
});

test("cloud format retains group identity, names, tolerances and exclusions with more than six tones", async () => {
  const config={...blank(),samples:Array.from({length:8},()=>tone(red))};
  config.confirmed!.groups[0].name="Liquen claro";
  const parsed=parseColorConfig(JSON.stringify(config));assert.deepEqual(parsed,config);
  const result=await classifyTrunkColors(rgba([red,brown]),2,1,outline,config,undefined,"lichen-only");
  const review={version:1,outline,config,analysis:analysisRecord(result,2,1,null),savedAt:"2026-09-15T12:00:00Z"};
  assert.deepEqual(parseGuidedReview(JSON.stringify(review)),review);
  const invalid=structuredClone(config); invalid.samples[0].tolerance=100;
  assert.equal(parseColorConfig(JSON.stringify(invalid)),null);
  assert.equal(parseColorConfig(JSON.stringify({...config,version:1})),null);
  assert.equal(parseColorConfig(JSON.stringify({...config,samples:Array(25).fill(tone(red))})),null);
});

test("extended labels remain disjoint and duplicate identities, missing groups or corrupted exclusions fail closed", async () => {
  const c=blank();c.confirmed!.groups.push({id:"group-h",label:10,name:"Liquen H"});c.samples=[tone(red,.2,10)];
  const result=await classifyTrunkColors(rgba([red,green]),2,1,outline,c,undefined,"lichen-only");
  assert.equal(result.counts[10],1);assert.equal(result.lichen,1);
  assert.ok(parseGuidedReview(JSON.stringify({version:1,outline,config:c,savedAt:null,analysis:analysisRecord(result,2,1,null)})));
  const corrupt=structuredClone(c);corrupt.confirmed!.groups[1].id=corrupt.confirmed!.groups[0].id;
  assert.equal(parseColorConfig(JSON.stringify(corrupt)),null);
  assert.equal(parseColorConfig(JSON.stringify({...c,samples:[tone(red,.2,9)]})),null);
  assert.equal(parseColorConfig(JSON.stringify({...c,samples:[{...tone(red),excluded:[-1]}]})),null);
});

test("outside trunk, transparent pixels and cancellation never become accepted lichen", async () => {
  const data=rgba([red,red,red]);data[7]=0;
  const clipped=[{x:0,y:0},{x:.7,y:0},{x:.7,y:1},{x:0,y:1}];
  const result=await classifyTrunkColors(data,3,1,clipped,{...blank(),samples:[tone(red)]},undefined,"lichen-only");
  assert.deepEqual([...result.labels],[3,1,0]);
  const abort=new AbortController();abort.abort();
  await assert.rejects(proposeColorAddition(data,3,1,countColorLabels(new Uint8Array(3).fill(1)),tone(red),abort.signal),{name:"AbortError"});
});

test("picker requires explicit acceptance, keeps A active, discards without writes, names and undo survive", async () => {
  const data=rgba(Array.from({length:32},(_,i)=>i%16<5?red:i%16<10?green:brown));
  const pixels={width:16,height:2,rgba:data};let stored=blank(),latest:ReturnType<typeof useGuidedColorPicker>|null=null,writes=0;
  function Harness(){
    const [config,setConfig]=useState(stored);
    const p=useGuidedColorPicker(pixels,outline,config,true,next=>{stored=next;writes++;setConfig(next);});latest=p;
    return createElement(GuidedColorControls,{picker:p,config});
  }
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const current=()=>{assert.ok(latest);return latest as ReturnType<typeof useGuidedColorPicker>;};
  const settle=async()=>{for(let i=0;i<12;i++)await act(async()=>{await new Promise(r=>setTimeout(r,5));});};
  const click=async(name:string)=>{const b=Array.from(host.querySelectorAll("button")).find(b=>b.textContent===name);assert.ok(b,name);assert.equal(b.disabled,false);await act(async()=>b.click());await settle();};
  try{
    await act(async()=>root.render(createElement(Harness)));await settle();
    await act(async()=>current().pick({x:.1,y:.5}));await settle();assert.equal(writes,0);
    await click("Descartar");assert.equal(writes,0);assert.equal(stored.samples.length,0);
    await act(async()=>current().pick({x:.1,y:.5}));await settle();
    assert.ok(host.querySelector('[aria-label="Color capturado"]'));
    assert.match(host.textContent!, /Tono 1 para Liquen A/);
    assert.match(host.textContent!, /En fucsia:/);
    assert.match(host.textContent!, /Aún no está aceptado/);
    await click("Aceptar este tono");
    const first=current().accepted!.labels.slice();assert.equal(stored.samples.length,1);assert.equal(current().label,3);
    assert.match(host.textContent!, /Otro tono de Liquen A/);
    await act(async()=>current().pick({x:.45,y:.5}));await settle();
    assert.match(host.textContent!, /Tono 2 para Liquen A/);
    assert.ok(host.querySelector('[aria-label="Tono aceptado 1"]'));
    await click("Aceptar este tono");
    assert.equal(stored.samples.length,2);assert.equal(current().label,3);
    for(let i=0;i<first.length;i++)if(first[i]===3)assert.equal(current().accepted!.labels[i],3);
    await click("Deshacer añadido");assert.deepEqual(current().accepted!.labels,first);
    await click("+ Otro liquen");assert.equal(current().label,4);
    await act(async()=>current().pick({x:.45,y:.5}));await settle();
    assert.match(host.textContent!, /Tono 1 para Liquen B/);
    assert.ok(host.querySelector('[aria-label="Color capturado"]'));
    await click("Descartar");assert.equal(stored.samples.length,1);
    await act(async()=>current().rename("Liquen amarillo"));await settle();
    assert.equal(stored.confirmed!.groups[1].name,"Liquen amarillo");
    assert.equal(parseGuidedReview(JSON.stringify({version:1,outline,config:stored,analysis:null,savedAt:null}))!.config.confirmed!.groups[1].name,"Liquen amarillo");
  }finally{await act(async()=>root.unmount());host.remove();}
});

test("proposal feedback is high contrast without changing the coverage mask", () => {
  const mask=new Uint8Array([0,0,0,0,0, 0,1,1,1,0, 0,1,1,1,0, 0,1,1,1,0, 0,0,0,0,0]);
  const before=mask.slice(), display=proposalDisplayPixels(mask,5,5);
  assert.deepEqual(mask,before);
  assert.deepEqual([...display.slice(12*4,13*4)],[255,0,212,185]);
  assert.deepEqual([...display.slice(6*4,7*4)],[71,0,61,245]);
  for(let i=0;i<mask.length;i++)assert.equal(display[i*4+3]>0,!!mask[i]);
});

test("captured tone and point are visible before matching completes", async () => {
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const config=blank(), pending=tone(red);
  const picker={groups:config.confirmed!.groups,label:3,pending,proposal:null,accepted:countColorLabels(new Uint8Array([1])),
    tolerance:3,legacyCount:0,canUndo:false,error:"",notice:"",removing:false} as unknown as ReturnType<typeof useGuidedColorPicker>;
  try{
    await act(async()=>root.render(createElement("div",null,createElement(GuidedColorControls,{picker,config}),createElement("svg",null,createElement(GuidedToneMarker,{sample:pending,width:100,height:200})))));
    assert.ok(host.querySelector('[aria-label="Color elegido: RGB 210, 30, 30"]'));
    assert.match(host.textContent!,/Buscando zonas de tonos parecidos/);
    assert.equal(host.querySelector('[aria-label="Punto del color elegido"]')?.getAttribute("transform"),"translate(10 100)");
    const accept=Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Aceptar este tono");
    assert.ok(accept?.disabled);
  }finally{await act(async()=>root.unmount());host.remove();}
});

import "../region-suggestions/component-test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import MorphNameEditor from "./MorphNameEditor";
import { GuidedColorControls, useGuidedColorPicker } from "./GuidedColorPicker";
import { MorphCatalogue } from "./EcologyEditor";
import { emptyEcologyConfig, morphName, morphDisplayName, normalizeMorphName, selectMorph, validQuadrat, quadratOutline, parseEcologyReview, observedMorphs, referenceTones, sameEcologySource, type EcologyRow, type Morphospecies } from "./ecology";
import { classifyTrunkColors, proposeColorAddition, acceptColorAddition } from "../region-suggestions/trunk-colors";
import { encodeMaskRle } from "../region-suggestions/mask-codec";
const outline=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],q={x:2,y:2,width:4,height:4};
const a={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",event_id:"event-one",ordinal:1};
function document(){return {version:1,scale:"uncalibrated",sourceOutline:outline,quadrat:q,width:10,height:10,config:emptyEcologyConfig(),counts:[0,16,0,0,0,0,0,0,0,0,0],total:16,savedAt:"2026-09-16T12:00:00Z"};}
test("catalogue identities stable, names simple, local labels and samples never copied",()=>{
  assert.equal(morphName(1),"Morfoespecie A");assert.equal(morphName(26),"Morfoespecie Z");assert.equal(morphName(27),"Morfoespecie AA");
  const first=selectMorph(emptyEcologyConfig(),a);assert.equal(first.label,3);assert.equal(first.config.confirmed!.groups[0].id,a.id);
  const same=selectMorph(first.config,a);assert.equal(same.config,first.config);
  const second=selectMorph(selectMorph(emptyEcologyConfig(),{...a,id:"another",ordinal:2}).config,a);
  assert.equal(second.label,4);assert.equal(second.config.samples.length,0);assert.equal(second.config.confirmed!.groups[1].id,a.id);
});
test("quadrat stays inside trunk including concave edges, and has a bounded pixel denominator",()=>{
  assert.equal(validQuadrat(q,outline,10,10),true);
  assert.equal(validQuadrat({...q,x:8},outline,10,10),false);
  assert.equal(validQuadrat({...q,width:0},outline,10,10),false);
  assert.equal(validQuadrat(q,[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:.5,y:.3},{x:0,y:1}],10,10),false);
});
test("explicit empty review is unknown, not bark; invalid counts and samples rejected",()=>{
  const raw=document(),review=parseEcologyReview(raw);assert.ok(review);assert.deepEqual(observedMorphs(review),[]);
  assert.equal(parseEcologyReview({...raw,total:17}),null);
  assert.equal(parseEcologyReview({...raw,counts:[0,15,1,0,0,0,0,0,0,0,0]}),null);
  assert.equal(parseEcologyReview({...raw,counts:[0,15,0,1,0,0,0,0,0,0,0]}),null);
  assert.equal(parseEcologyReview({...raw,scale:"calibrated"}),null);
  const config=selectMorph(emptyEcologyConfig(),a).config;
  assert.equal(parseEcologyReview({...raw,config:{...config,samples:[{x:.9,y:.9,label:3,rgb:[1,2,3],tolerance:12}]}}),null);
  assert.equal(sameEcologySource(review,outline,10,10),true);assert.equal(sameEcologySource(review,outline,20,10),false);
  assert.equal(sameEcologySource(review,[...outline].reverse(),10,10),false);
});
test("standardized reviews require five explicit decisions and decodable bounded masks",()=>{
  const morph=selectMorph(emptyEcologyConfig(),a), mask=encodeMaskRle(new Uint8Array(10*50),10,50);
  const decisions={ [a.id]: { "0":"not_observed","1":"not_observed","2":"not_observed","3":"not_observed","4":"not_observed" } };
  const standardized={method:"cell-frequency-v2",frame:{corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],widthCm:10,heightCm:50},
    frameConfirmed:true,calibration:{pixelsPerCm:1,method:"manual_confirmed",width:10,height:50,imageId:"img",proxyPath:"analysis-proxy:img",transformationId:"rectified:img",sourceCorners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]},
    maskWidth:10,maskHeight:50,masksByMorph:{[a.id]:mask},decisions,reviewedAt:"2026-09-16T12:00:00Z",sourceFingerprint:"source"};
  const raw={...document(),config:morph.config,standardized};
  assert.ok(parseEcologyReview(raw));
  assert.equal(parseEcologyReview({...raw,standardized:{...standardized,decisions:{[a.id]:{"0":"not_observed"}}}}),null);
  assert.equal(parseEcologyReview({...raw,standardized:{...standardized,masksByMorph:{[a.id]:"not-rle"}}}),null);
});
test("colour matching clips to quadrat; accepted additions do not double count or paint bark",async()=>{
  const rgba=new Uint8ClampedArray(10*10*4);for(let i=0;i<100;i++)rgba.set([100,120,50,255],i*4);
  let config=selectMorph(emptyEcologyConfig(),a).config;
  const initial=await classifyTrunkColors(rgba,10,10,quadratOutline(q,10,10),config,undefined,"lichen-only");
  assert.equal(initial.total,16);assert.equal(initial.counts[1],16);assert.equal(initial.counts[2],0);
  const sample={x:.3,y:.3,label:3 as const,rgb:[100,120,50] as [number,number,number],tolerance:12,excluded:[]};
  const proposal=await proposeColorAddition(rgba,10,10,initial,sample);assert.equal(proposal.added,16);
  const accepted=acceptColorAddition(initial,proposal.mask,3);const repeated=await proposeColorAddition(rgba,10,10,accepted,sample);assert.equal(repeated.added,0);
  config={...config,samples:[sample]};const review=parseEcologyReview({...document(),config,counts:Array.from(accepted.counts)});assert.ok(review);assert.deepEqual(observedMorphs(review),[a.id]);
  const row={image_id:"img",event_id:a.event_id,tree_sample_id:"tree",direction:"N",revision:1,review} as EcologyRow;
  assert.deepEqual(referenceTones([row,row],a.id),[[100,120,50]]);
});
test("catalogue shows references and explicit reuse without certainty or auto-transfer",()=>{
  const html=renderToStaticMarkup(<MorphCatalogue catalog={[a]} reviews={[]} selectedId={a.id} disabled={false} busy={false} onSelect={()=>{}} onCreate={()=>{}}/>);
  assert.match(html,/Morfoespecie A/);assert.match(html,/Los tonos son referencias/);assert.match(html,/Nueva morfoespecie/);
  assert.doesNotMatch(html,/certeza|confidence|Nombre del liquen/);
  const disabled=renderToStaticMarkup(<MorphCatalogue catalog={[a]} reviews={[]} disabled busy={false} onSelect={()=>{}} onCreate={()=>{}}/>);assert.match(disabled,/disabled/);
});
test("custom display name keeps the default identity and measurement configuration unchanged",()=>{
  assert.equal(morphDisplayName(a),"Morfoespecie A");
  const renamed={...a,custom_name:"Liquen gris",name_revision:2};
  assert.equal(morphDisplayName(renamed),"Liquen gris");
  assert.equal(morphDisplayName({...renamed,custom_name:null}),"Morfoespecie A");
  assert.equal(normalizeMorphName("  Liquen gris  "),"Liquen gris");assert.equal(normalizeMorphName("   "),null);
  assert.throws(()=>normalizeMorphName("x".repeat(81)));assert.throws(()=>normalizeMorphName("Liquen\nA"));
  const config=selectMorph(emptyEcologyConfig(),a).config;
  assert.equal(selectMorph(config,renamed).config,config);
  assert.deepEqual(selectMorph(emptyEcologyConfig(),renamed).config,config);
  const html=renderToStaticMarkup(<MorphCatalogue catalog={[renamed]} reviews={[]} disabled={false} busy={false} onSelect={()=>{}} onCreate={()=>{}} onRename={async()=>{}}/>);
  assert.match(html,/Liquen gris/);assert.match(html,/Editar nombre/);
});
test("name editor saves explicitly, preserves text on failure, cancels, and restores the default",async()=>{
  const host=globalThis.document.createElement("div");globalThis.document.body.append(host);const root=createRoot(host);
  let writes=0,fail=true;let saved:Morphospecies=a;
  function Harness(){const[m,setM]=useState<Morphospecies>(a);return <><strong>{morphDisplayName(m)}</strong><MorphNameEditor morph={m} onSave={async(base,name)=>{
    writes++;assert.equal(base.id,a.id);if(fail)throw new Error("Fallo de prueba: reintenta.");
    saved={...base,custom_name:normalizeMorphName(name),name_revision:(base.name_revision??1)+1};setM(saved);
  }}/></>;}
  const click=async(text:string)=>{const b=Array.from(host.querySelectorAll("button")).find(b=>b.textContent===text);assert.ok(b,text);await act(async()=>b.click());};
  const type=async(value:string)=>{const input=host.querySelector("input")!;await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new window.Event("input",{bubbles:true}));});};
  try{
    await act(async()=>root.render(<Harness/>));await click("Editar nombre");await type("Liquen gris");assert.equal(writes,0);
    await click("Cancelar");assert.equal(writes,0);assert.equal(host.querySelector("input"),null);
    await click("Editar nombre");await type("Liquen gris");await click("Guardar nombre");
    assert.match(host.textContent!,/Fallo de prueba/);assert.equal(host.querySelector("input")!.value,"Liquen gris");
    fail=false;await click("Guardar nombre");assert.equal(saved.custom_name,"Liquen gris");assert.equal(host.querySelector("input"),null);
    await click("Editar nombre");await type("");await click("Guardar nombre");assert.equal(saved.custom_name,null);assert.match(host.textContent!,/Morfoespecie A/);
  }finally{await act(async()=>root.unmount());host.remove();}
});
test("current catalogue name is shown by the dropper without rewriting the accepted config",()=>{
  const config=selectMorph(emptyEcologyConfig(),a).config,before=JSON.stringify(config);
  function Harness(){const picker=useGuidedColorPicker(null,outline,config,false,()=>{throw new Error("No measurement write allowed");});return <GuidedColorControls catalogue groupNames={{[a.id]:"Liquen amarillo"}} picker={picker} config={config}/>;}
  const html=renderToStaticMarkup(<Harness/>);assert.match(html,/Elegir color de Liquen amarillo/);assert.doesNotMatch(html,/Morfoespecie A/);assert.equal(JSON.stringify(config),before);
});

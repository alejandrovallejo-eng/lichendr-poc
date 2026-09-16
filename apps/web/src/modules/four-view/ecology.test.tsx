import "../region-suggestions/component-test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MorphCatalogue } from "./EcologyEditor";
import { emptyEcologyConfig, morphName, selectMorph, validQuadrat, quadratOutline, parseEcologyReview, observedMorphs, referenceTones, sameEcologySource, type EcologyRow } from "./ecology";
import { classifyTrunkColors, proposeColorAddition, acceptColorAddition } from "../region-suggestions/trunk-colors";
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

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
import { TreeOrbit } from "./TreeOrbit.tsx";
import { consistentOrbitTextures, cropTrunkPixels, directionRotation, normalizeRotation, orbitDirection, type OrbitTexture } from "./tree-orbit.ts";
import { DIRECTIONS } from "./types.ts";
import { buildOrbitWrapMap, wrapOrbitPixels, renderOrbitPixels, type OrbitSurface } from "./tree-orbit-render.ts";

const solidOrbitTexture = (rgb: number[] = [100, 120, 80]): OrbitTexture => {
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) pixels.set([...rgb, 255], i * 4);
  return { photo: { pixels, width: 4, height: 4 }, overlay: null, profile: new Float32Array(4).fill(1), aspect: .32, fingerprint: "same-photo", warning: "" };
};

test("duplicate photos use one disclosed visual reference without replacing stored view results", () => {
  const input = { N: solidOrbitTexture(), E: solidOrbitTexture([200, 10, 50]), S: solidOrbitTexture([10, 100, 20]), W: solidOrbitTexture([10, 10, 200]) };
  input.N.overlay = solidOrbitTexture([35, 191, 135]).photo;
  // Non-uniform pixels exercise projection, not just a constant solid colour.
  for (let i = 0; i < 16; i++) { input.N.photo.pixels[i * 4] = i * 10; input.N.overlay.pixels[i * 4 + 3] = i % 2 ? 150 : 0; }
  const originals = DIRECTIONS.map(d => input[d].photo.pixels.slice());
  const montage = consistentOrbitTextures(input);
  assert.deepEqual(montage.sources, { N: "N", E: "N", S: "N", W: "N" });
  for (const d of DIRECTIONS) assert.equal(montage.textures[d], input.N);
  for (const marked of [false, true]) {
    const north = renderOrbitPixels(montage.textures, 0, marked, 120, 120);
    for (const d of DIRECTIONS) assert.deepEqual(renderOrbitPixels(montage.textures, directionRotation(d), marked, 120, 120), north);
  }
  DIRECTIONS.forEach((d, i) => assert.deepEqual(input[d].photo.pixels, originals[i]));
  assert.notEqual(input.E, input.N); assert.equal(input.E.overlay, null);
});

test("duplicate reference never fills missing views or joins distinct/unknown photos", () => {
  const east = { ...solidOrbitTexture(), fingerprint: "photo-e" }, south = { ...solidOrbitTexture(), fingerprint: "photo-s" };
  const input = { N: null, E: east, S: south, W: { ...solidOrbitTexture(), fingerprint: "photo-e" } };
  const montage = consistentOrbitTextures(input);
  assert.equal(montage.textures.N, null); assert.equal(montage.textures.S, south);
  assert.equal(montage.textures.W, east); assert.equal(montage.sources.W, "E");
  const unidentified = { N: solidOrbitTexture(), E: { ...east, fingerprint: "" }, S: { ...south, fingerprint: "" }, W: null };
  const unchanged = consistentOrbitTextures(unidentified);
  assert.equal(unchanged.textures.E, unidentified.E); assert.equal(unchanged.textures.S, unidentified.S);
  assert.deepEqual(unchanged.sources, { N: "N", E: "E", S: "S", W: "W" });
});

test("photo mode preserves exact RGB at all rotations, including joins, without lighting or tint mixing", () => {
  const textures = { N: solidOrbitTexture([40, 70, 90]), E: solidOrbitTexture([160, 50, 30]), S: solidOrbitTexture([20, 80, 140]), W: solidOrbitTexture([180, 150, 70]) };
  const colors = new Set(DIRECTIONS.map(d => Array.from(textures[d].photo.pixels.slice(0, 3)).join(",")));
  for (const rotation of [0, 13, 44, 45, 89, 135, 271, 359]) {
    const output = renderOrbitPixels(textures, rotation, false, 120, 120);
    let checked = 0;
    for (let i = 0; i < output.length; i += 4) if (output[i + 3] === 255) {
      assert.ok(colors.has(Array.from(output.slice(i, i + 3)).join(","))); checked++;
    }
    assert.ok(checked > 1000);
  }
});

test("orbit straightens a sloping trunk without changing photo pixels or mask alignment", () => {
  const source: OrbitSurface = { pixels: new Uint8ClampedArray(6 * 4 * 4), width: 6, height: 4 };
  const overlay: OrbitSurface = { ...source, pixels: source.pixels.slice() };
  for (let y = 0; y < 4; y++) for (let x = y; x < y + 3; x++) source.pixels.set([x, y, 70, 255], (y * 6 + x) * 4);
  overlay.pixels.set([255, 0, 200, 255], (2 * 6 + 3) * 4);
  const before = source.pixels.slice(), map = buildOrbitWrapMap(source, 3);
  const photo = wrapOrbitPixels(source, map), mask = wrapOrbitPixels(overlay, map);
  assert.equal(photo.width, 3); assert.equal(photo.height, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) assert.deepEqual(Array.from(photo.pixels.slice((y * 3 + x) * 4, (y * 3 + x + 1) * 4)), [x + y, y, 70, 255]);
  assert.deepEqual(Array.from(mask.pixels.slice((2 * 3 + 1) * 4, (2 * 3 + 2) * 4)), [255, 0, 200, 255]);
  assert.equal(Array.from(mask.pixels).filter((n, i) => i % 4 === 3 && n > 0).length, 1);
  assert.deepEqual(source.pixels, before);
});

test("orbit wrapping preserves interior holes and empty rows rather than inventing bark", () => {
  const source: OrbitSurface = { pixels: new Uint8ClampedArray(5 * 3 * 4), width: 5, height: 3 };
  for (const i of [0, 1, 3, 4, 10, 11, 12, 13, 14]) source.pixels.set([80, 60, 40, 255], i * 4);
  const map = buildOrbitWrapMap(source, 5), wrapped = wrapOrbitPixels(source, map);
  assert.equal(wrapped.pixels[2 * 4 + 3], 0);
  for (let x = 0; x < 5; x++) assert.equal(wrapped.pixels[(5 + x) * 4 + 3], 0);
  assert.equal(wrapped.pixels[(10 + 2) * 4 + 3], 255);
});

test("orbit projection keeps cardinal faces, missing data, overlays and source arrays separate", () => {
  const textures = { N: solidOrbitTexture([240, 0, 0]), E: solidOrbitTexture([0, 240, 0]), S: solidOrbitTexture([0, 0, 240]), W: solidOrbitTexture([240, 240, 0]) };
  const center = (data: Uint8ClampedArray) => Array.from(data.slice((60 * 120 + 60) * 4, (60 * 120 + 61) * 4));
  const before = textures.N.photo.pixels.slice();
  for (const d of DIRECTIONS) {
    const result = center(renderOrbitPixels(textures, directionRotation(d), false, 120, 120));
    const expected = Array.from(textures[d].photo.pixels.slice(0, 3));
    assert.equal(result[3], 255);
    assert.deepEqual(result.slice(0, 3), expected);
  }
  const missing = center(renderOrbitPixels({ ...textures, E: null }, -90, false, 120, 120));
  assert.ok(Math.max(...missing.slice(0, 3)) - Math.min(...missing.slice(0, 3)) < 12);
  textures.N.overlay = solidOrbitTexture([220, 30, 200]).photo;
  assert.deepEqual(center(renderOrbitPixels(textures, 0, true, 120, 120)), [220, 30, 200, 255]);
  assert.equal(center(renderOrbitPixels(textures, 0, false, 120, 120))[1], 0);
  assert.deepEqual(textures.N.photo.pixels, before);
});

test("orbit directions wrap and follow N/E/S/O without exchanging photos", () => {
  for (const d of DIRECTIONS) {
    assert.equal(orbitDirection(directionRotation(d)),d);
    assert.equal(orbitDirection(directionRotation(d)+720),d);
    assert.equal(orbitDirection(directionRotation(d)-720),d);
  }
  assert.equal(orbitDirection(-44),"N");assert.equal(orbitDirection(-46),"E");
  assert.equal(normalizeRotation(-361),359);
});

test("orbit crop removes background including concave notches and never mutates input", () => {
  const pixels=new Uint8ClampedArray(8*8*4).fill(255),before=pixels.slice();
  const crop=cropTrunkPixels(pixels,8,8,[{x:.25,y:.25},{x:.75,y:.25},{x:.75,y:.5},{x:.5,y:.5},{x:.5,y:.75},{x:.25,y:.75}]);
  assert.equal(crop.width,4);assert.equal(crop.height,4);
  assert.equal(crop.pixels[3],255);assert.equal(crop.pixels[(3*4+3)*4+3],0);
  assert.equal(Array.from(crop.pixels).filter((v,i)=>i%4===3&&v===255).length,12);
  assert.deepEqual(pixels,before);
  assert.throws(()=>cropTrunkPixels(pixels,8,8,[]),/tres puntos/);
});

test("orbit is read-only, preserves missing sector, changes orientation/zoom/overlay without rebuilding", async () => {
  const entries={N:{src:"n",review:summaryReview(10)},E:{src:"",review:null},S:{src:"s",review:summaryReview(20)},W:{src:"w",review:summaryReview(30)}};
  const prepared:string[]=[],opened:string[]=[];
  const prepare=async(entry:{src:string})=>{prepared.push(entry.src);if(!entry.src)throw new Error("Falta la foto");return solidOrbitTexture();};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const click=async(label:string)=>{const b=host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);assert.ok(b,label);await act(async()=>b.click());};
  try {
    await act(async()=>root.render(createElement(TreeOrbit,{entries,marked:true,onOpenPhoto:d=>opened.push(d),prepare})));
    assert.deepEqual(prepared,["n","","s","w"]);assert.equal(host.querySelectorAll(".tree-orbit-canvas").length,1);
    assert.match(host.textContent!,/fotografías repetidas/);
    await click("Ver Este en 360");assert.match(host.querySelector('[role="status"]')!.textContent!,/Este · sector sin recorte/);
    await click("Ver Oeste en 360");
    assert.match(host.querySelector('[role="status"]')!.textContent!,/referencia visual de Norte/);
    await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Abrir foto de oeste")!.click());
    assert.deepEqual(opened,["W"]);
    const stage=host.querySelector<HTMLElement>(".tree-orbit-stage")!;
    await act(async()=>stage.dispatchEvent(new KeyboardEvent("keydown",{key:"Home",bubbles:true})));
    await act(async()=>stage.dispatchEvent(new KeyboardEvent("keydown",{key:"+",bubbles:true})));
    assert.equal(host.querySelector<HTMLInputElement>('input[type="range"]')!.value,"110");
    await act(async()=>root.render(createElement(TreeOrbit,{entries,marked:false,onOpenPhoto:d=>opened.push(d),prepare})));
    assert.equal(prepared.length,4);
    assert.equal(host.querySelector("canvas")!.getAttribute("data-marked"),"false");
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("leaving orbit cancels preparation and discards a late buffer without starting other views", async () => {
  const entries={N:{src:"n",review:summaryReview(10)},E:{src:"e",review:null},S:{src:"s",review:null},W:{src:"w",review:null}};
  let resolve!:(texture:OrbitTexture)=>void,signal:AbortSignal|undefined,calls=0;
  const prepare=async(_entry:unknown,s:AbortSignal)=>{signal=s;calls++;return new Promise<OrbitTexture>(r=>{resolve=r;});};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(createElement(TreeOrbit,{entries,marked:true,onOpenPhoto:()=>{},prepare})));
    await act(async()=>root.unmount());assert.equal(signal?.aborted,true);
    await act(async()=>{resolve(solidOrbitTexture());});
    assert.equal(calls,1);
  } finally {host.remove();}
});

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
    assert.equal(button("Analizar selección").disabled,true);
    for(let i=0;i<100 && host.textContent!.includes("Preparando selección");i++) await act(async()=>{await new Promise(r=>setTimeout(r,10));});
    await point(200,150);assert.equal(button("Analizar selección").disabled,true);
    for(let i=0;i<160 && button("Aceptar este tono").disabled;i++) await act(async()=>{await new Promise(r=>setTimeout(r,10));});
    assert.ok(host.querySelector('[aria-label="Punto del color elegido"]'));
    await click("Ver foto sin marcas");
    assert.equal(host.querySelector('[aria-label="Punto del color elegido"]'),null);
    await click("Volver a la selección");
    assert.ok(host.querySelector('[aria-label="Punto del color elegido"]'));
    await click("Aceptar este tono");assert.equal(button("Analizar selección").disabled,false);
    await click("Analizar selección");
    for(let i=0;i<80 && !host.textContent!.includes(aiUnavailable?"Worker unavailable":"Revisa y guarda");i++) await act(async()=>{await new Promise(r=>setTimeout(r,10));});
    if(aiUnavailable){assert.match(host.textContent!,/Sin revisión de IA/);await click("Continuar sin IA");}
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
    // The expandable group list may scroll, but cannot push actions out of its card.
    const info=cards[0].querySelector<HTMLElement>(".tree-summary-info")!;
    assert.equal(info.style.minHeight,"0px");assert.equal(info.style.overflowY,"auto");
    assert.equal(cards[0].querySelector<HTMLElement>(".tree-summary-actions")!.style.flexShrink,"0");
    assert.match(cards[0].textContent!,/10.0 %/);assert.match(cards[1].textContent!,/20.0 %/);
    assert.match(cards[1].textContent!,/Photo offline/);assert.match(cards[2].textContent!,/30.0 %/);
    assert.match(cards[3].textContent!,/Sin fotografía/);assert.doesNotMatch(cards[3].textContent!,/0.0 %/);
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Ampliar Norte"]')!.click());
    assert.equal(host.querySelectorAll("article").length,1);assert.equal(photos.length,3);
    await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Ver las cuatro vistas")!.click());
    await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Explorar 360°")!.click());
    assert.equal(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked,false);
    assert.equal(host.querySelector("canvas")!.getAttribute("data-marked"),"false");
    assert.match(host.textContent!,/Resaltar áreas seleccionadas/);
    await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    assert.equal(host.querySelector("canvas")!.getAttribute("data-marked"),"true");
    await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Ver las cuatro vistas")!.click());
    assert.equal(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked,true);
    assert.match(host.textContent!,/10.0 %/);assert.match(host.textContent!,/20.0 %/);assert.match(host.textContent!,/30.0 %/);
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
    for(let i=0;i<160 && host.textContent!.includes("Preparando selección");i++) await act(async()=>{await new Promise(r=>setTimeout(r,10));});
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

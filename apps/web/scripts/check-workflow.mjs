// Explicit disposable end-to-end verification. No existing user's records are edited.
import nextEnv from '@next/env';
import { createServerClient } from '@supabase/ssr';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire, Module } from 'node:module';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { inspectArchive, restoreArchive } from './backup-archive.mjs';
const web = fileURLToPath(new URL('../',import.meta.url));
nextEnv.loadEnvConfig(web,false,{info(){},error(){}});
const args=process.argv.slice(2), production=args.includes('--production');
const imageAt=args.indexOf('--image');
if(imageAt>=0&&(!args[imageAt+1]||args[imageAt+1].startsWith('--')))throw new Error('--image requiere una ruta de archivo.');
if(args.some((a,i)=>a!=='--production'&&a!=='--image'&&i!==imageAt+1)) throw new Error('Uso: npm run check:workflow -- [--image /ruta/arbol.jpg] [--production]');
const base=production?'https://temporary-flying-nickel-213j01n.vercel.app':'http://127.0.0.1:3000';
const directory=await mkdtemp(join(tmpdir(),'lichendr-workflow-'));
const compilation=spawnSync(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'--noEmit','false','--incremental','false','--module','commonjs','--moduleResolution','node','--target','es2022','--esModuleInterop','true','--skipLibCheck','true','--allowJs','true','--rootDir','src','--outDir',directory,'src/modules/exports/backup.ts','src/modules/exports/views.ts','src/modules/four-view/guided-cloud.ts','src/modules/region-suggestions/trunk-colors.ts','src/modules/jornada/closure-client.ts'],{stdio:'inherit'});
if(compilation.status!==0)throw new Error('workflow_compilation_failed');
process.env.NODE_PATH=resolve('node_modules');Module._initPaths();
const require=createRequire(import.meta.url);
const {readDataExport,csv}=require(join(directory,'modules/exports/data.js'));
const {viewExportRows,VIEW_COLUMNS}=require(join(directory,'modules/exports/views.js'));
const {backupArchive}=require(join(directory,'modules/exports/backup.js'));
const {readClosure,changeClosure}=require(join(directory,'modules/jornada/closure-client.js'));
const {createGuidedCloudStore,reviewFingerprint}=require(join(directory,'modules/four-view/guided-cloud.js'));
const {classifyTrunkColors,colorWorkingSize,initialColorConfig}=require(join(directory,'modules/region-suggestions/trunk-colors.js'));
const jar=new Map();
const owner=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(60000),...(init?.signal?[init.signal]:[])])})},cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(v=>jar.set(v.name,v.value))}});
let projectId, ownerId, samSession, failed=false;
const viewIds=[], paths=[];
function checked(stage,result){if(result.error)throw new Error(`${stage}: ${result.error.code||'request_failed'}`);return result.data;}
async function api(path,body,method=body===undefined?'GET':'POST'){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:[...jar].map(([n,v])=>`${n}=${v}`).join('; '),...(method==='DELETE'?{'x-sam-session-ticket':samSession.ticket}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(300000)});
 const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}
 if(!response.ok)throw new Error(`${path}: ${response.status} ${typeof value?.error==='string'?value.error:'request_failed'}`);return value;
}
async function clearOwnRecords(){
 if(viewIds.length)checked('limpieza de vistas',await owner.from('capture_views').delete().in('id',viewIds));
 if(projectId)checked('limpieza de proyecto',await owner.from('projects').delete().eq('id',projectId));
 if(paths.length)checked('limpieza de archivos',await owner.storage.from('lichen-images').remove(paths));
}
try{
 console.log(`Flujo real de cuatro vistas en ${production?'producción':'local'}, con propietario y datos temporales.`);
 const auth=checked('autenticación',await owner.auth.signInAnonymously());ownerId=auth.user.id;
 const create=async(table,row)=>checked(table,await owner.from(table).insert(row).select().single());
 const project=await create('projects',{owner_id:ownerId,name:`Prueba completa ${randomUUID()}`,description:'Prueba técnica desechable; no es evidencia científica.'});projectId=project.id;
 const site=await create('sites',{project_id:projectId,name:'Verificación temporal'});
 const event=await create('sampling_events',{site_id:site.id,name:'Jornada de verificación',sampled_at:new Date().toISOString()});
 const tree=await create('trees',{site_id:site.id,code:'WORKFLOW-CHECK'});
 const sample=await create('tree_samples',{site_id:site.id,tree_id:tree.id,sampling_event_id:event.id});
 const series=checked('serie',await owner.rpc('get_or_create_capture_series',{p_tree_sample_id:sample.id,p_algorithm_version:'workflow-check-v1',p_request_key:randomUUID()}));
 const caps=await api('/api/vision/capabilities');assert(caps.segmentation.enabled&&caps.segmentation.configured&&caps.classification.enabled&&caps.classification.configured);
 const input=imageAt>=0?await readFile(args[imageAt+1]):await sharp({create:{width:461,height:615,channels:3,background:'#668844'}}).jpeg().toBuffer();
 const store=createGuidedCloudStore(owner), outline=[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}];
 const records=[];
 for(const [index,direction]of ['N','E','S','W'].entries()){
  const png=index===1;
  const pipeline=sharp(input).rotate().resize({width:1536,height:1536,fit:'inside',withoutEnlargement:true});
  const bytes=await (png?pipeline.png():pipeline.jpeg()).toBuffer(), meta=await sharp(bytes).metadata();
  const path=`${ownerId}/workflow-check/${randomUUID()}.${png?'png':'jpg'}`;paths.push(path);
  checked('subida',await owner.storage.from('lichen-images').upload(path,bytes,{contentType:png?'image/png':'image/jpeg'}));
  const image=await create('images',{tree_sample_id:sample.id,storage_path:path,original_filename:`check-${direction}.${png?'png':'jpg'}`,mime_type:png?'image/png':'image/jpeg',file_size_bytes:bytes.length,width_px:meta.width,height_px:meta.height});
  const proxyPath=`${ownerId}/analysis-proxies/${image.id}/v1.jpg`;paths.push(proxyPath);
  const view=checked('vista',await owner.rpc('register_capture_view',{p_series_id:series.id,p_image_id:image.id,p_direction:direction,p_algorithm_version:'workflow-check-v1',p_request_key:randomUUID()}));viewIds.push(view.id);
  const ref={ownerId,imageId:image.id,treeSampleId:sample.id,direction};
  const proxy=await api('/api/vision/analysis-proxy',{imageId:image.id});assert.equal(proxy.status,'ready');console.log(`${direction}: copia preparada.`);
  if(index===0){
   samSession=await api('/api/vision/region-suggestions/prepare',ref);
   const segmented=await api('/api/vision/region-suggestions/segment',{...ref,sessionId:samSession.sessionId,ticket:samSession.ticket,points:[{x:.5,y:.3,label:1}]});assert(segmented.candidates.length>0);
   await api(`/api/vision/region-suggestions/sessions/${samSession.sessionId}`,undefined,'DELETE');samSession=null;
   console.log('MobileSAM: preparación, máscaras y liberación de sesión verificadas.');
  }
  const proxyBytes=checked('leer proxy',await owner.storage.from('lichen-images').download(proxyPath));
  const working=colorWorkingSize(proxy.proxyWidth,proxy.proxyHeight);
  const pixels=await sharp(Buffer.from(await proxyBytes.arrayBuffer())).resize(working.width,working.height).ensureAlpha().raw().toBuffer();
  const center=(Math.floor(working.height*.5)*working.width+Math.floor(working.width*.5))*4;
  console.log(`${direction}: copia descargada para cobertura.`);
  const config={...initialColorConfig(),samples:[{x:.5,y:.5,rgb:[pixels[center],pixels[center+1],pixels[center+2]],label:3}]};
  const result=await classifyTrunkColors(new Uint8ClampedArray(pixels),working.width,working.height,outline,config,new AbortController().signal,'lichen-only');assert(result.total>0);
  const ai=await api('/api/vision/region-suggestions',{imageId:image.id,treeSampleId:sample.id,direction,requestToken:randomUUID(),sourceWidth:proxy.proxyWidth,sourceHeight:proxy.proxyHeight,regions:[{regionId:'check-region',box:{x:0,y:0,width:proxy.proxyWidth,height:proxy.proxyHeight},maskAreaPixels:proxy.proxyWidth*proxy.proxyHeight,maskSha:createHash('sha256').update(bytes).digest('hex'),samScore:1}]});
  assert.equal(ai.backend,'ridge_head');assert.equal(ai.suggestions.length,1);assert.equal(ai.suggestions[0].status,'pending');
  const review={version:1,outline,config,analysis:{counts:result.counts,total:result.total,lichen:result.lichen,width:working.width,height:working.height,ai},savedAt:new Date().toISOString()};
  const saved=await store.write(ref,review,0);assert.equal(saved.revision,1);console.log(`${direction}: BioCLIP y guardado completados.`);
  assert.equal(reviewFingerprint((await store.read(ref)).review),reviewFingerprint(review));
  const {data:sessionData}=await owner.auth.getSession();
  const conflict=await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/rpc/save_guided_capture_review', {method:'POST',headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+sessionData.session.access_token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({p_image_id:image.id,p_tree_sample_id:sample.id,p_direction:direction,p_review:{...review,savedAt:new Date(Date.now()+1000).toISOString()},p_expected_revision:2}),signal:AbortSignal.timeout(25000)});
  const stale=await conflict.json(); console.log('Conflicto:',conflict.status,stale.code,stale.message);
  assert.equal(conflict.status,409);assert.equal(stale.code,'PT409');
  records.push({ref,review});
  const counts=Array(11).fill(0);counts[1]=64;
  const ecological={version:1,scale:'uncalibrated',sourceOutline:outline,width:working.width,height:working.height,quadrat:{x:Math.floor(working.width*.4),y:Math.floor(working.height*.4),width:8,height:8},config:{version:2,tolerance:12,samples:[],confirmed:{legacyCount:0,legacyTolerance:12,groups:[{id:'unassigned',label:3,name:'Elige una morfoespecie'}]}},counts,total:64,savedAt:new Date().toISOString()};
  checked('cuadrante',await owner.rpc('save_ecological_quadrat',{p_image_id:image.id,p_event_id:event.id,p_tree_sample_id:sample.id,p_direction:direction,p_review:ecological,p_expected_revision:0}));
  const staleEcology=await owner.rpc('save_ecological_quadrat',{p_image_id:image.id,p_event_id:event.id,p_tree_sample_id:sample.id,p_direction:direction,p_review:{...ecological,savedAt:new Date(Date.now()+1000).toISOString()},p_expected_revision:2});assert.equal(staleEcology.error?.code,'PT409');
  console.log(`${direction}: original privado, preparación, cobertura, BioCLIP, revisión guardada y protección de concurrencia OK.`);
 }
 const morph=checked('catálogo',await owner.rpc('create_jornada_morphospecies',{p_event_id:event.id,p_id:randomUUID()}).single());
 checked('nombre catálogo',await owner.rpc('rename_jornada_morphospecies',{p_event_id:event.id,p_id:morph.id,p_name:'Morfoespecie de prueba',p_expected_revision:1}));
 const staleName=await owner.rpc('rename_jornada_morphospecies',{p_event_id:event.id,p_id:morph.id,p_name:'Nombre desactualizado',p_expected_revision:1});assert.equal(staleName.error?.code,'PT409');
 const closure=await readClosure(owner,event.id);assert(closure.rows.every(row=>row.complete));
 const closed=await changeClosure(owner,closure,'completed',false);assert.equal(closed.changed,true);assert.equal((await readClosure(owner,event.id)).event.status,'completed');
 console.log('Cierre y relectura de jornada completos; conflictos de cuadrantes y nombres devuelven HTTP 409.');
 const snapshot=await api('/api/exports?format=json');assert.equal(snapshot.ownerId,ownerId);assert.equal(Object.keys(snapshot.tables).length,20);
 const rows=viewExportRows(snapshot);assert.equal(rows.length,4);assert(rows.every(row=>row.state==='saved'&&typeof row.coverage_percent==='number'));
 const exportedCsv=await api('/api/exports?format=csv&dataset=views');assert.equal(exportedCsv.replace(/^\uFEFF/,''),csv(rows,VIEW_COLUMNS).replace(/^\uFEFF/,''));
 const outsiderJar=new Map();
 const outsider=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{cookies:{getAll:()=>[...outsiderJar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(v=>outsiderJar.set(v.name,v.value))}});
 checked('otra sesión',await outsider.auth.signInAnonymously());assert.notEqual(checked('identidad distinta',await outsider.auth.getUser()).user.id,ownerId);assert.equal(checked('aislamiento',await outsider.from('projects').select('id').eq('id',projectId)).length,0);await outsider.auth.signOut();
 console.log('Resultados y exportaciones: cuatro vistas confirmadas; aislamiento entre propietarios OK.');
 const backup=await backupArchive(owner,snapshot,()=>{}), archive=inspectArchive(Buffer.from(await backup.arrayBuffer()));assert.equal(archive.manifest.objects.length,8);
 await assert.rejects(restoreArchive(owner,archive),/destination_not_empty/);
 // Destroy only this explicitly disposable run, then recover its same-owner copy.
 await clearOwnRecords();await restoreArchive(owner,archive);
 for(const record of records){const proxy=await api('/api/vision/analysis-proxy',{imageId:record.ref.imageId});assert.equal(proxy.status,'ready');assert.equal(reviewFingerprint((await store.read(record.ref)).review),reviewFingerprint(record.review));}
 const restored=await readDataExport(owner);
 for(const name of Object.keys(snapshot.tables)){
  const normalize=rows=>rows.map(row=>{if(name==='ecological_quadrat_reviews'){const {revision,updated_at,...data}=row;return data;}if(name==='jornada_morphospecies'){const {name_revision,...data}=row;return data;}return row;});
  assert.equal(reviewFingerprint(normalize(restored.tables[name])),reviewFingerprint(normalize(snapshot.tables[name])),`restored_${name}`);
 }
 for(const object of archive.manifest.objects){const file=checked('foto restaurada',await owner.storage.from('lichen-images').download(object.path));assert.equal(createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'),object.sha256);}
 console.log('Recuperación real: 20 tablas, 8 archivos y revisiones; SHA-256 coincide. Las revisiones ecológicas se crean de nuevo mediante sus RPC protegidas.');
}catch(error){failed=true;console.error(error.message);}
finally{
 if(samSession)try{await api(`/api/vision/region-suggestions/sessions/${samSession.sessionId}`,undefined,'DELETE');}catch{failed=true;console.error('session_cleanup_failed');}
 try{await clearOwnRecords();}catch(error){failed=true;console.error(error.message);}
 await owner.auth.signOut();await rm(directory,{recursive:true,force:true});
}
process.exitCode=failed?1:0;if(!failed)console.log('Flujo completo verificado; registros y fotografías temporales retirados. Las identidades anónimas permanecen en Auth.');

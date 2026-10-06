// Explicit, disposable live verification; never reads or edits existing users.
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire, Module } from 'node:module';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
nextEnv.loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const directory=await mkdtemp(join(tmpdir(),'lichendr-demo-check-'));
const compilation=spawnSync(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'--noEmit','false','--incremental','false','--module','commonjs','--moduleResolution','node','--target','es2022','--esModuleInterop','true','--skipLibCheck','true','--outDir',directory,'src/modules/demo/copy.ts'],{stdio:'inherit'});
if(compilation.status!==0)throw Error('demo_compilation_failed');
process.env.NODE_PATH=resolve('node_modules');Module._initPaths();
const require=createRequire(import.meta.url), {createDemoCopy}=require(join(directory,'demo/copy.js'));
const {parseDemoTemplate}=require(join(directory,'demo/template.js'));
const template=parseDemoTemplate(JSON.parse(await readFile('public/demo/v1/review.json','utf8')));
const photo=new Blob([await readFile('public/demo/v1/tree.jpg')],{type:'image/jpeg'});
const client=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(60000)})}});
const db=client(), outsider=client();let projectId, sentinelId;const paths=[];
const checked=r=>{if(r.error)throw Error(r.error.code||'request_failed');return r.data;};
try {
  checked(await db.auth.signInAnonymously());const ownerId=checked(await db.auth.getUser()).user.id;
  sentinelId=checked(await db.from('projects').insert({owner_id:ownerId,name:'Prueba temporal: preservar proyecto existente'}).select('id').single()).id;
  const result=await createDemoCopy(db,template,photo);projectId=result.projectId;
  const reviews=checked(await db.from('guided_capture_reviews').select('*').eq('tree_sample_id',result.treeSampleId));
  assert.equal(reviews.length,4);assert.deepEqual(reviews.map(r=>r.direction).sort(),['E','N','S','W']);
  assert(reviews.every(r=>r.review.savedAt&&r.review.analysis.ai===null));
  const images=checked(await db.from('images').select('*').eq('tree_sample_id',result.treeSampleId));assert.equal(images.length,4);
  for(const image of images){paths.push(image.storage_path,`${ownerId}/analysis-proxies/${image.id}/v1.jpg`);}
  for(const path of paths){const blob=checked(await db.storage.from('lichen-images').download(path));assert.equal(blob.size,photo.size);}
  checked(await outsider.auth.signInAnonymously());assert.equal(checked(await outsider.from('projects').select('id').eq('id',projectId)).length,0);
  assert((await outsider.storage.from('lichen-images').download(paths[0])).error);
  // Inject a failure after the first saved view; compensation must leave the
  // pre-existing sentinel and successful copy untouched.
  let registered=0;
  const broken=new Proxy(db,{get(target,key){if(key==='rpc')return(name,args)=>name==='register_capture_view'&&++registered===2?Promise.resolve({data:null,error:{code:'demo_injected_failure'}}):target.rpc(name,args);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  await assert.rejects(createDemoCopy(broken,template,photo),/registrar una orientación/);
  assert.equal(checked(await db.from('projects').select('id')).length,2);
  assert.equal(checked(await db.from('guided_capture_reviews').select('image_id')).length,4);
  const folders=checked(await db.storage.from('lichen-images').list(`${ownerId}/demo`));assert.equal(folders.length,4);
  assert(checked(await db.from('projects').select('id').eq('id',sentinelId)).length===1);
  console.log('Ejemplo editable: cuatro fotos, ocho archivos, cuatro revisiones, aislamiento RLS y recuperación tras fallo verificados.');
} finally {
  if(projectId){const samples=checked(await db.from('tree_samples').select('id').in('site_id',checked(await db.from('sites').select('id').eq('project_id',projectId)).map(s=>s.id)));const series=checked(await db.from('capture_series').select('id').in('tree_sample_id',samples.map(s=>s.id)));checked(await db.from('capture_views').delete().in('capture_series_id',series.map(s=>s.id)));checked(await db.from('projects').delete().eq('id',projectId));}
  if(sentinelId)checked(await db.from('projects').delete().eq('id',sentinelId));
  if(paths.length)checked(await db.storage.from('lichen-images').remove(paths));
  await db.auth.signOut();await outsider.auth.signOut();await rm(directory,{recursive:true,force:true});
}

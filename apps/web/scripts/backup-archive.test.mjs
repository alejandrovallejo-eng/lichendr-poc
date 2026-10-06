import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectArchive,restoreArchive} from './backup-archive.mjs';
import {DATABASE_TABLES} from '../src/lib/supabase/readiness.mjs';
const ownerId='11111111-1111-4111-8111-111111111111';
function fixture(){
 const snapshot={schemaVersion:1,scope:'current_user',ownerId,tables:Object.fromEntries(Object.keys(DATABASE_TABLES).map(name=>[name,[]]))};
 const bytes=Buffer.from('photograph');
 const manifest={version:1,scope:'current_user',ownerId,objects:[{path:ownerId+'/image.jpg',archivePath:'files/000001.bin',size:bytes.length,contentType:'image/jpeg',sha256:createHash('sha256').update(bytes).digest('hex')}]};
 return {snapshot,manifest,files:new Map([['files/000001.bin',bytes]])};
}
function tar(archive){
 const files=[['records.json',Buffer.from(JSON.stringify(archive.snapshot))],['manifest.json',Buffer.from(JSON.stringify(archive.manifest))],...archive.files];
 const parts=[];
 for(const[name,bytes]of files){const h=Buffer.alloc(512);h.write(name);h.write(bytes.length.toString(8).padStart(11,'0'),124);h.fill(32,148,156);h[156]=48;h.write(h.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);parts.push(h,bytes,Buffer.alloc((512-bytes.length%512)%512));}
 return Buffer.concat([...parts,Buffer.alloc(1024)]);
}
test('archive verifies photographs and rejects modified bytes',()=>{const a=fixture();assert.equal(inspectArchive(tar(a)).manifest.objects.length,1);const bytes=tar(a),index=bytes.indexOf('photograph');bytes[index]^=1;assert.throws(()=>inspectArchive(bytes),/integrity/);});
test('archive rejects traversal, unlisted files and duplicate object mappings',()=>{const a=fixture();a.manifest.objects[0].path=ownerId+'/../image.jpg';assert.throws(()=>inspectArchive(tar(a)),/scope/);const b=fixture();b.manifest.objects.push({...b.manifest.objects[0],path:ownerId+'/another.jpg'});assert.throws(()=>inspectArchive(tar(b)),/archive_object/);const c=fixture();c.files.set('files/000002.bin',Buffer.from('unlisted'));assert.throws(()=>inspectArchive(tar(c)),/unlisted/);});
test('restore rejects a different owner before any table access',async()=>{const db={auth:{getUser:async()=>({data:{user:{id:'other'}}})}};await assert.rejects(restoreArchive(db,fixture()),/original_owner/);});
test('restore rejects incomplete hierarchy and obsolete guided reviews before writes',async()=>{const a=fixture();a.snapshot.tables.sites.push({id:'s',project_id:'missing'});const db={auth:{getUser:async()=>({data:{user:{id:ownerId}}})}};await assert.rejects(restoreArchive(db,a),/incomplete_hierarchy/);const b=fixture();b.snapshot.tables.projects=[{id:'p',owner_id:ownerId}];b.snapshot.tables.sites=[{id:'s',project_id:'p'}];b.snapshot.tables.sampling_events=[{id:'e',site_id:'s'}];b.snapshot.tables.trees=[{id:'t',site_id:'s'}];b.snapshot.tables.tree_samples=[{id:'ts',site_id:'s',tree_id:'t',sampling_event_id:'e'}];b.snapshot.tables.images=[{id:'i',tree_sample_id:'ts'}];b.snapshot.tables.guided_capture_reviews=[{image_id:'i',tree_sample_id:'ts',owner_id:ownerId,direction:'N'}];await assert.rejects(restoreArchive(db,b),/history_requires_admin/);});
test('a failed capture insert never deletes an unconfirmed capture id',async()=>{
 const a=fixture();a.manifest.objects=[];a.snapshot.tables.projects=[{id:'p',owner_id:ownerId}];a.snapshot.tables.sites=[{id:'s',project_id:'p'}];a.snapshot.tables.sampling_events=[{id:'e',site_id:'s'}];a.snapshot.tables.trees=[{id:'t',site_id:'s'}];a.snapshot.tables.tree_samples=[{id:'ts',site_id:'s',tree_id:'t',sampling_event_id:'e'}];a.snapshot.tables.images=[{id:'i',tree_sample_id:'ts'}];a.snapshot.tables.capture_series=[{id:'series',tree_sample_id:'ts'}];a.snapshot.tables.capture_views=[{id:'existing-view',capture_series_id:'series',image_id:'i'}];
 const deleted=[];const db={storage:{from:()=>({list:async()=>({data:[],error:null})})},auth:{getUser:async()=>({data:{user:{id:ownerId}}})},from:name=>({select:()=>({in:async()=>({data:[],error:null})}),insert:async()=>({error:name==='capture_views'?{code:'23505'}:null}),delete:()=>({in:async(_,ids)=>{deleted.push([name,ids]);return{error:null}}})})};
 await assert.rejects(restoreArchive(db,a),/23505/);assert.deepEqual(deleted,[['projects',['p']]]);
});

test('restore accepts SDK not-found HEAD results only after verifying Storage and never upserts',async()=>{
 const a=fixture();a.snapshot.tables.projects=[{id:'p',owner_id:ownerId}];const uploaded=[];
 const bucket={list:async()=>({data:[],error:null}),exists:async()=>({data:false,error:{status:400,statusCode:'NoSuchKey'}}),upload:async(path,bytes,options)=>{uploaded.push({path,bytes,options});return{error:null}}};
 const db={auth:{getUser:async()=>({data:{user:{id:ownerId}}})},storage:{from:()=>bucket},from:()=>({select:()=>({in:async()=>({data:[],error:null})}),insert:async()=>({error:null})})};
 await restoreArchive(db,a);assert.equal(uploaded.length,1);assert.equal(uploaded[0].options.upsert,false);assert.deepEqual(uploaded[0].bytes,Buffer.from('photograph'));
 bucket.list=async()=>({data:null,error:{status:401}});await assert.rejects(restoreArchive(db,a),/storage_unavailable/);
});

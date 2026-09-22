import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Isolated PostgreSQL fixtures; never connects to a user database.
const db = new PGlite();
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const image='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tree='cccccccc-cccc-4ccc-8ccc-cccccccccccc', project='dddddddd-dddd-4ddd-8ddd-dddddddddddd', site='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', series='ffffffff-ffff-4fff-8fff-ffffffffffff';
try {
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
    create table public.projects(id uuid primary key,owner_id uuid);
    create table public.sites(id uuid primary key,project_id uuid);
    create table public.tree_samples(id uuid primary key,site_id uuid);
    create table public.images(id uuid primary key,tree_sample_id uuid);
    create table public.capture_series(id uuid primary key,tree_sample_id uuid);
    create table public.capture_views(image_id uuid primary key,capture_series_id uuid,direction text,active boolean);
    grant select on all tables in schema public to authenticated;
    insert into auth.users values('${owner}'),('${other}');
    insert into public.projects values('${project}','${owner}');
    insert into public.sites values('${site}','${project}');
    insert into public.tree_samples values('${tree}','${site}');
    insert into public.images values('${image}','${tree}'),('${second}','${tree}');
    insert into public.capture_series values('${series}','${tree}');
    insert into public.capture_views values('${image}','${series}','N',true),('${second}','${series}','E',false);
  `);
  await db.exec(await readFile(process.argv[2],'utf8'));
  await db.exec(await readFile(process.argv[3],'utf8'));
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
  const draft={version:1,outline:[{x:.1,y:.1}],config:{version:1,tolerance:12,samples:[]},analysis:null,savedAt:null};
  const save=async(id,dir,review,revision)=> (await db.query('select * from public.save_guided_capture_review($1::uuid,$2::uuid,$3,$4::jsonb,$5)',[id,tree,dir,JSON.stringify(review),revision])).rows[0];
  const first=await save(image,'N',draft,0);assert.equal(first.revision,1);assert.deepEqual(first.review,draft);
  assert.equal((await save(image,'N',draft,0)).revision,1,'lost response retry is idempotent');
  const changed={...draft,outline:[{x:.2,y:.2}]};
  assert.equal((await save(image,'N',changed,1)).revision,2);
  await assert.rejects(save(image,'N',draft,1),e=>e.code==='40001','stale update conflicts');
  assert.equal((await db.query('select revision from public.guided_capture_reviews')).rows[0].revision,2);
  const expanded={...changed,config:{version:2,tolerance:12,samples:Array.from({length:24},()=>({x:.2,y:.2,rgb:[100,120,50],label:3,tolerance:12,excluded:[]})),
    confirmed:{legacyCount:0,legacyTolerance:12,groups:[{id:'group-a',label:3,name:'Liquen A'}]}}};
  const expandedRow=await save(image,'N',expanded,2);
  assert.equal(expandedRow.review.config.samples.length,24,'v2 permits 24 accepted tones');
  await assert.rejects(save(image,'N',{...expanded,config:{...expanded.config,samples:[...expanded.config.samples,expanded.config.samples[0]]}},3),e=>e.code==='23514','25 tones rejected');
  await assert.rejects(save(image,'N',{...changed,config:{version:1,samples:Array(7).fill({})}},3),e=>e.code==='23514','v1 limit remains six');
  await assert.rejects(save(image,'N',{...expanded,config:{...expanded.config,confirmed:{groups:Array(9).fill({})}}},3),e=>e.code==='23514','nine groups rejected');
  // Restore the fixture revision used by the remaining isolation checks.
  await db.exec('reset role; update public.guided_capture_reviews set revision=2; set role authenticated;');
  await assert.rejects(save(second,'E',draft,0),e=>e.code==='42501','inactive photo rejected');
  await assert.rejects(save(image,'S',draft,2),e=>e.code==='40001','wrong direction rejected');
  await assert.rejects(save(image,'N',{version:1},2),e=>e.code==='23514','incomplete document rejected');
  await assert.rejects(save(image,'N',{...draft,padding:'x'.repeat(200001)},2),e=>e.code==='22023','oversized document rejected');
  await db.exec(`set request.jwt.claim.sub='${other}';`);
  assert.equal((await db.query('select * from public.guided_capture_reviews')).rows.length,0,'other user cannot read');
  await assert.rejects(save(image,'N',draft,0),e=>e.code==='42501','other user cannot insert');
  await assert.rejects(save(image,'N',draft,2),e=>e.code==='40001','other user cannot update');
  await assert.rejects(db.query(`insert into public.guided_capture_reviews(image_id,owner_id,tree_sample_id,direction,review) values($1,$2,$3,'E',$4)`,[second,other,tree,JSON.stringify(draft)]),e=>e.code==='42501');
  await db.exec('reset role; set role anon;');
  await assert.rejects(save(image,'N',draft,0),e=>e.code==='42501','anonymous database role cannot call save');
  console.log('PASS: real PostgreSQL migration, save/read, CAS conflicts, idempotent retry, malformed/oversized rejection, owner isolation, inactive/wrong-view safeguards, anon denied');
} finally { await db.close(); }

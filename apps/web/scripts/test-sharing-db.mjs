import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { randomUUID } from 'node:crypto';
const db=new PGlite({extensions:{pgcrypto}});
const admin='d99aebab-a3ab-44f5-a11d-f360cea00471', director=randomUUID(), stranger=randomUUID(), anonymous=randomUUID();
const role=async(id,as='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec(`set role ${as}`);};
const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;
    create table auth.users(id uuid primary key,is_anonymous boolean default false,raw_user_meta_data jsonb default '{}');
    create table auth.identities(user_id uuid references auth.users(id),provider text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to authenticated,anon;
    grant select,insert,update,delete on storage.objects to authenticated;`);
  for(const id of [admin,director,stranger,anonymous])await db.query('insert into auth.users(id,is_anonymous) values($1,$2)',[id,id===anonymous]);
  for(const id of [admin,director,stranger])await db.query("insert into auth.identities values($1,'google')",[id]);
  const migrationDir=new URL('../../../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(migrationDir)).filter(f=>f.endsWith('.sql')).sort()) {
    try{await db.exec(await readFile(new URL(file,migrationDir),'utf8'));}catch(error){throw Error(`${file}: ${error.message}`);}
  }
  await role(anonymous);await assert.rejects(q('select (public.create_review_project($1,$2)).id',['No permitido',randomUUID()]),/google_account_required/);
  await role(director);const request=randomUUID();
  const [{id:project}]=await q('select (public.create_review_project($1,$2)).id',['Espacio compartido de prueba',request]);
  assert.equal((await q('select (public.create_review_project($1,$2)).id',['Reintento',request]))[0].id,project);
  const [{id:site}]=await q('insert into public.sites(project_id,name)values($1,$2)returning id',[project,'Sitio']);
  const [{id:event}]=await q('insert into public.sampling_events(site_id,name,sampled_at)values($1,$2,now())returning id',[site,'Jornada']);
  const [{id:tree}]=await q('insert into public.trees(site_id,code)values($1,$2)returning id',[site,'EJEMPLO']);
  const [{id:sample}]=await q('insert into public.tree_samples(site_id,sampling_event_id,tree_id)values($1,$2,$3)returning id',[site,event,tree]);
  const series=(await q('select to_jsonb(public.get_or_create_capture_series($1,$2,$3)) as value',[sample,'review-test',randomUUID()]))[0].value.id;
  const template=JSON.parse(await readFile(new URL('../public/demo/v1/review.json',import.meta.url),'utf8'));
  const imageIds=[];
  for(const direction of ['N','E','S','W']){
    const path=`${director}/demo/${randomUUID()}.jpg`;
    const [{id:image}]=await q("insert into public.images(tree_sample_id,storage_path,original_filename,mime_type,file_size_bytes)values($1,$2,'ejemplo.jpg','image/jpeg',1)returning id",[sample,path]);imageIds.push(image);
    await q('select public.register_capture_view($1,$2,$3,$4,$5)',[series,image,direction,'review-test',randomUUID()]);
    await q('select public.save_guided_capture_review($1,$2,$3,$4::jsonb,0)',[image,sample,direction,JSON.stringify(template.review)]);
    for(const name of [path,`${director}/analysis-proxies/${image}/v1.jpg`])await q("insert into storage.objects(bucket_id,name)values('lichen-images',$1)",[name]);
  }
  await q("insert into storage.objects(bucket_id,name)values('lichen-images',$1)",[`${director}/unregistered-private.jpg`]);
  const [{id:privateProject}]=await q("insert into public.projects(owner_id,name)values($1,'Privado')returning id",[director]);
  await role(stranger);
  const victimPath=`${stranger}/private.jpg`;await q("insert into storage.objects(bucket_id,name)values('lichen-images',$1)",[victimPath]);
  await role(director);
  // An owner cannot make the reviewer read another user's Storage object by
  // pointing an image record at that path.
  await q("insert into public.images(tree_sample_id,storage_path,original_filename,mime_type,file_size_bytes)values($1,$2,'invalid.jpg','image/jpeg',1)",[sample,victimPath]);
  await role(admin);
  assert.equal((await q('select public.list_review_projects() as value'))[0].value.length,1);
  const source=(await q('select public.read_review_project($1) as value',[project]))[0].value;
  assert.equal(source.reviews.length,4);assert.equal(source.images.length,5);assert.equal(source.projects[0].owner_id,director);
  assert.equal((await q('select * from public.projects')).length,0,'normal exports remain owner-scoped');
  assert.equal((await q('select * from public.guided_capture_reviews')).length,0);
  assert.equal((await q('select * from storage.objects')).length,8,'only linked photo and proxy objects are readable');
  assert.equal((await q('select public.can_review_object($1) as value',[victimPath]))[0].value,false);
  await assert.rejects(q('select public.read_review_project($1)',[privateProject]),/review_project_not_available/);
  await assert.rejects(q('select public.save_guided_capture_review($1,$2,$3,$4::jsonb,0)',[imageIds[0],sample,'N',JSON.stringify(template.review)]),/row-level security/);
  assert.equal((await q('delete from public.projects where id=$1 returning id',[project])).length,0);
  await assert.rejects(q('insert into public.project_review_access(project_id,reviewer_id,created_by,creation_key)values($1,$2,$3,$4)',[privateProject,admin,director,randomUUID()]),/permission denied/);
  await role(stranger);assert.equal((await q('select public.list_review_projects() as value'))[0].value.length,0);
  await assert.rejects(q('select public.read_review_project($1)',[project]),/review_project_not_available/);
  await role('', 'anon');await assert.rejects(q('select public.list_review_projects()'),/permission denied/);
  await role(director);assert.equal((await q('delete from public.project_review_access where project_id=$1 returning project_id',[project])).length,1);
  await role(admin);assert.equal((await q('select public.list_review_projects() as value'))[0].value.length,0);
  assert.equal((await q('select * from storage.objects')).length,0);
  await assert.rejects(q('select public.read_review_project($1)',[project]),/review_project_not_available/);
  // Admin's own demo remains idempotent as well.
  const ownRequest=randomUUID(), own=(await q('select (public.create_review_project($1,$2)).id',['Propio',ownRequest]))[0].id;
  assert.equal((await q('select (public.create_review_project($1,$2)).id',['Propio',ownRequest]))[0].id,own);
  console.log('PostgreSQL: migraciones completas, Google requerido, cuatro revisiones, idempotencia, aislamiento de exportaciones, Storage limitado, edición protegida y revocación verificados.');
}finally{await db.close();}

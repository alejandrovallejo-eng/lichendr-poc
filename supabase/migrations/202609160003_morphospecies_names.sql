-- Optional catalogue names only: no changes to saved masks, samples or coverage.
begin;
alter table public.jornada_morphospecies
  add column custom_name text check(custom_name is null or
    (char_length(custom_name) between 1 and 80 and custom_name=btrim(custom_name) and custom_name !~ '[[:cntrl:]]')),
  add column name_revision integer not null default 1 check(name_revision>0);

create or replace function public.create_jornada_morphospecies(p_event_id uuid,p_id uuid)
returns public.jornada_morphospecies language plpgsql security definer set search_path = '' as $$
declare r public.jornada_morphospecies; n integer;
begin
  if not public.ecology_owns_event(p_event_id) then raise exception 'ecology_forbidden' using errcode='42501'; end if;
  perform 1 from public.sampling_events where id=p_event_id for update;
  select * into r from public.jornada_morphospecies where id=p_id and event_id=p_event_id and owner_id=auth.uid();
  if r.id is not null then return r; end if;
  select coalesce(max(ordinal),0)+1 into n from public.jornada_morphospecies where event_id=p_event_id;
  if n>64 then raise exception 'ecology_catalog_full' using errcode='22023'; end if;
  insert into public.jornada_morphospecies(id,event_id,owner_id,ordinal) values(p_id,p_event_id,auth.uid(),n) returning * into r;
  return r;
end; $$;

create function public.rename_jornada_morphospecies(p_event_id uuid,p_id uuid,p_name text,p_expected_revision integer)
returns public.jornada_morphospecies language plpgsql security definer set search_path = '' as $$
declare r public.jornada_morphospecies; chosen text:=nullif(btrim(p_name),'');
begin
  if not public.ecology_owns_event(p_event_id) then raise exception 'ecology_forbidden' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<1 or char_length(chosen)>80 or chosen ~ '[[:cntrl:]]' then
    raise exception 'ecology_invalid_name' using errcode='22023'; end if;
  select * into r from public.jornada_morphospecies where id=p_id and event_id=p_event_id and owner_id=auth.uid() for update;
  if r.id is null then raise exception 'ecology_forbidden' using errcode='42501'; end if;
  -- Retrying an acknowledged-by-server save is safe even after a lost response.
  if r.custom_name is not distinct from chosen then return r; end if;
  if r.name_revision<>p_expected_revision then raise exception 'ecology_name_conflict' using errcode='40001'; end if;
  update public.jornada_morphospecies set custom_name=chosen,name_revision=name_revision+1 where id=r.id returning * into r;
  return r;
end; $$;
revoke all on function public.create_jornada_morphospecies(uuid,uuid) from public,anon;
grant execute on function public.create_jornada_morphospecies(uuid,uuid) to authenticated;
revoke all on function public.rename_jornada_morphospecies(uuid,uuid,text,integer) from public,anon;
grant execute on function public.rename_jornada_morphospecies(uuid,uuid,text,integer) to authenticated;
commit;

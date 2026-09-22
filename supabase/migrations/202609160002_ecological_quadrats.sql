-- Additive exploratory analysis. Original images, trunk reviews and metrics are untouched.
begin;
create table public.jornada_morphospecies (
  id uuid primary key, event_id uuid not null references public.sampling_events(id) on delete cascade,
  owner_id uuid not null references auth.users(id), ordinal integer not null check (ordinal between 1 and 64),
  unique(event_id, ordinal), unique(event_id,id)
);
create table public.ecological_quadrat_reviews (
  image_id uuid primary key references public.images(id) on delete cascade,
  event_id uuid not null references public.sampling_events(id) on delete cascade,
  tree_sample_id uuid not null references public.tree_samples(id) on delete cascade,
  owner_id uuid not null references auth.users(id), direction text not null check(direction in ('N','E','S','W')),
  review jsonb not null check(octet_length(review::text) <= 200000),
  revision integer not null check(revision > 0), updated_at timestamptz not null default now()
);
create index ecological_quadrat_event on public.ecological_quadrat_reviews(event_id);

create function public.ecology_owns_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.sampling_events e join public.sites s on s.id=e.site_id
    join public.projects p on p.id=s.project_id where e.id=p_event and p.owner_id=auth.uid()
  );
$$;
revoke all on function public.ecology_owns_event(uuid) from public,anon;
grant execute on function public.ecology_owns_event(uuid) to authenticated;
alter table public.jornada_morphospecies enable row level security;
alter table public.ecological_quadrat_reviews enable row level security;
create policy ecology_catalog_read on public.jornada_morphospecies for select to authenticated
  using(owner_id=auth.uid() and public.ecology_owns_event(event_id));
create policy ecology_review_read on public.ecological_quadrat_reviews for select to authenticated
  using(owner_id=auth.uid() and public.ecology_owns_event(event_id));
-- No direct writes: the two bounded RPCs below enforce ownership, context and CAS.
revoke all on public.jornada_morphospecies,public.ecological_quadrat_reviews from anon,authenticated;
grant select on public.jornada_morphospecies,public.ecological_quadrat_reviews to authenticated;

create function public.create_jornada_morphospecies(p_event_id uuid,p_id uuid)
returns public.jornada_morphospecies language plpgsql security definer set search_path = '' as $$
declare r public.jornada_morphospecies; n integer;
begin
  if not public.ecology_owns_event(p_event_id) then raise exception 'ecology_forbidden' using errcode='42501'; end if;
  -- Serialises names even when two tabs add to the same jornada simultaneously.
  perform 1 from public.sampling_events where id=p_event_id for update;
  select * into r from public.jornada_morphospecies where id=p_id and event_id=p_event_id and owner_id=auth.uid();
  if r.id is not null then return r; end if;
  select coalesce(max(ordinal),0)+1 into n from public.jornada_morphospecies where event_id=p_event_id;
  if n>64 then raise exception 'ecology_catalog_full' using errcode='22023'; end if;
  insert into public.jornada_morphospecies values(p_id,p_event_id,auth.uid(),n) returning * into r;
  return r;
end; $$;
revoke all on function public.create_jornada_morphospecies(uuid,uuid) from public,anon;
grant execute on function public.create_jornada_morphospecies(uuid,uuid) to authenticated;

create function public.save_ecological_quadrat(p_image_id uuid,p_event_id uuid,p_tree_sample_id uuid,p_direction text,p_review jsonb,p_expected_revision integer)
returns public.ecological_quadrat_reviews language plpgsql security definer set search_path = '' as $$
declare r public.ecological_quadrat_reviews; source jsonb; g jsonb; s jsonb; q jsonb;
  w integer; h integer; x integer; y integer; qw integer; qh integer; tally bigint; i integer; groups jsonb;
begin
  if not public.ecology_owns_event(p_event_id) then raise exception 'ecology_forbidden' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<0 or p_review is null or octet_length(p_review::text)>200000 then
    raise exception 'ecology_invalid' using errcode='22023'; end if;
  -- Exact current view, owned project, same jornada/site; not an obsolete capture series.
  select gr.review into source from public.guided_capture_reviews gr
    join public.images im on im.id=gr.image_id and im.tree_sample_id=gr.tree_sample_id
    join public.tree_samples t on t.id=gr.tree_sample_id
    join public.sampling_events e on e.id=t.sampling_event_id and e.site_id=t.site_id
    where gr.image_id=p_image_id and gr.tree_sample_id=p_tree_sample_id and gr.direction=p_direction
      and gr.owner_id=auth.uid() and e.id=p_event_id
      and gr.review->>'savedAt' is not null and gr.review->'analysis' <> 'null'::jsonb
      and 1=(select count(*) from public.capture_views v where v.image_id=p_image_id and v.direction=p_direction and v.active
        and v.capture_series_id=(select c.id from public.capture_series c where c.tree_sample_id=t.id order by c.created_at desc,c.id desc limit 1))
    for share of gr;
  if source is null then raise exception 'ecology_source_unavailable' using errcode='42501'; end if;
  if not coalesce(p_review->>'version'='1' and p_review->>'scale'='uncalibrated'
    and p_review->'sourceOutline'=source->'outline'
    and p_review->'width'=source->'analysis'->'width' and p_review->'height'=source->'analysis'->'height'
    and p_review->'config'->>'version'='2' and p_review->'config'->'confirmed'->>'legacyCount'='0'
    and jsonb_typeof(p_review->'config'->'samples')='array' and jsonb_array_length(p_review->'config'->'samples')<=24
    and jsonb_typeof(p_review->'config'->'confirmed'->'groups')='array'
    and jsonb_array_length(p_review->'config'->'confirmed'->'groups') between 1 and 8
    and jsonb_typeof(p_review->'counts')='array' and jsonb_array_length(p_review->'counts')=11
    and p_review->>'savedAt' is not null,false) then raise exception 'ecology_invalid_or_changed_trunk' using errcode='22023'; end if;
  perform (p_review->>'savedAt')::timestamptz;
  w:=(p_review->>'width')::integer; h:=(p_review->>'height')::integer; q:=p_review->'quadrat';
  x:=(q->>'x')::integer; y:=(q->>'y')::integer; qw:=(q->>'width')::integer; qh:=(q->>'height')::integer;
  if not coalesce(w between 1 and 1024 and h between 1 and 1024 and x>=0 and y>=0 and qw>=4 and qh>=4 and x+qw<=w and y+qh<=h and (p_review->>'total')::integer=qw*qh,false) then
    raise exception 'ecology_invalid_quadrat' using errcode='22023'; end if;
  groups:=p_review->'config'->'confirmed'->'groups';
  if (select count(distinct a->>'id') from jsonb_array_elements(groups) a)<>jsonb_array_length(groups)
    or (select count(distinct a->>'label') from jsonb_array_elements(groups) a)<>jsonb_array_length(groups) then
    raise exception 'ecology_duplicate_group' using errcode='22023'; end if;
  for g in select * from jsonb_array_elements(groups) loop
    if not coalesce((g->>'label')::integer between 3 and 10,false) then raise exception 'ecology_invalid_label' using errcode='22023'; end if;
    if g->>'id'='unassigned' and jsonb_array_length(groups)=1 and jsonb_array_length(p_review->'config'->'samples')=0 then continue; end if;
    if not exists(select 1 from public.jornada_morphospecies m where m.id::text=g->>'id' and m.event_id=p_event_id and m.owner_id=auth.uid()) then
      raise exception 'ecology_foreign_morphospecies' using errcode='42501'; end if;
  end loop;
  for s in select * from jsonb_array_elements(p_review->'config'->'samples') loop
    if not coalesce((s->>'x')::numeric*w>=x and (s->>'x')::numeric*w<x+qw and (s->>'y')::numeric*h>=y and (s->>'y')::numeric*h<y+qh
      and exists(select 1 from jsonb_array_elements(groups) a where a->>'label'=s->>'label' and a->>'id'<>'unassigned'),false) then
      raise exception 'ecology_invalid_sample' using errcode='22023'; end if;
  end loop;
  tally:=0;
  for i in 0..10 loop
    if not coalesce((p_review->'counts'->>i)::integer>=0,false) then raise exception 'ecology_invalid_count' using errcode='22023'; end if;
    if (i in (0,2) and (p_review->'counts'->>i)::integer<>0) or (i>=3 and (p_review->'counts'->>i)::integer>0
      and not exists(select 1 from jsonb_array_elements(p_review->'config'->'samples') a where (a->>'label')::integer=i)) then
      raise exception 'ecology_invalid_count' using errcode='22023'; end if;
    tally:=tally+(p_review->'counts'->>i)::integer;
  end loop;
  if tally<>qw*qh then raise exception 'ecology_invalid_total' using errcode='22023'; end if;
  if p_expected_revision=0 then
    insert into public.ecological_quadrat_reviews values(p_image_id,p_event_id,p_tree_sample_id,auth.uid(),p_direction,p_review,1,now())
      on conflict(image_id) do nothing returning * into r;
  else
    update public.ecological_quadrat_reviews set review=p_review,revision=revision+1,updated_at=now()
      where image_id=p_image_id and event_id=p_event_id and tree_sample_id=p_tree_sample_id and direction=p_direction
      and owner_id=auth.uid() and revision=p_expected_revision returning * into r;
  end if;
  if r.image_id is not null then return r; end if;
  select * into r from public.ecological_quadrat_reviews where image_id=p_image_id and event_id=p_event_id and tree_sample_id=p_tree_sample_id
    and direction=p_direction and owner_id=auth.uid() and review=p_review;
  if r.image_id is not null then return r; end if;
  raise exception 'ecology_conflict' using errcode='40001';
end; $$;
revoke all on function public.save_ecological_quadrat(uuid,uuid,uuid,text,jsonb,integer) from public,anon;
grant execute on function public.save_ecological_quadrat(uuid,uuid,uuid,text,jsonb,integer) to authenticated;
commit;

-- Opt-in review spaces. Contributors retain ownership and all existing write
-- policies. The configured reviewer receives SELECT on this project only.
begin;
create table public.review_workspace_settings (
  singleton boolean primary key default true check (singleton),
  reviewer_id uuid not null references auth.users(id)
);
alter table public.review_workspace_settings enable row level security;
revoke all on public.review_workspace_settings from public, anon, authenticated;
insert into public.review_workspace_settings(singleton, reviewer_id)
values (true, 'd99aebab-a3ab-44f5-a11d-f360cea00471');

create table public.project_review_access (
  project_id uuid primary key references public.projects(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  creation_key uuid not null,
  created_at timestamptz not null default now(),
  unique (created_by, creation_key)
);
create index project_review_access_reviewer on public.project_review_access(reviewer_id);
alter table public.project_review_access enable row level security;
revoke all on public.project_review_access from public, anon, authenticated;
grant select, delete on public.project_review_access to authenticated;
create policy project_review_access_read on public.project_review_access for select to authenticated
using (reviewer_id = (select auth.uid()) or created_by = (select auth.uid()));
create policy project_review_access_revoke on public.project_review_access for delete to authenticated
using (reviewer_id = (select auth.uid()) or created_by = (select auth.uid()));

create function public.can_review_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.project_review_access a
    join public.projects p on p.id = a.project_id and p.owner_id = a.created_by
    where a.project_id = p_project_id and a.reviewer_id = auth.uid()
  );
$$;
create function public.review_project_for_site(p_site_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.project_id from public.sites s
  where s.id = p_site_id and public.can_review_project(s.project_id);
$$;
create function public.review_project_for_sample(p_sample_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.project_id from public.tree_samples t join public.sites s on s.id = t.site_id
  where t.id = p_sample_id and public.can_review_project(s.project_id);
$$;
create function public.can_review_image(p_image_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.images i where i.id = p_image_id
    and public.review_project_for_sample(i.tree_sample_id) is not null);
$$;
create function public.can_review_object(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.images i
    join public.tree_samples t on t.id = i.tree_sample_id
    join public.sites s on s.id = t.site_id
    join public.projects p on p.id = s.project_id
    where public.can_review_project(p.id) and (
      (p_path = i.storage_path and pg_catalog.split_part(i.storage_path, '/', 1) = p.owner_id::text) or
      p_path = p.owner_id::text || '/analysis-proxies/' || i.id::text || '/v1.jpg'
    )
  );
$$;
create function public.create_review_project(p_name text, p_request_key uuid)
returns public.projects language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid(); reviewer uuid; existing public.projects; created public.projects;
begin
  if who is null or not exists(select 1 from auth.users u join auth.identities i on i.user_id = u.id
    where u.id = who and coalesce(u.is_anonymous, false) = false and i.provider = 'google') then
    raise exception 'google_account_required' using errcode = '42501';
  end if;
  if p_request_key is null or p_name is null or char_length(btrim(p_name)) not between 1 and 120 then
    raise exception 'invalid_review_project' using errcode = '22023';
  end if;
  -- Serialise repeated clicks, concurrent tabs and a retry after lost response.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(who::text || p_request_key::text, 0));
  select p.* into existing from public.project_review_access a join public.projects p on p.id = a.project_id
    where a.created_by = who and a.creation_key = p_request_key and p.owner_id = who;
  if existing.id is not null then return existing; end if;
  select reviewer_id into reviewer from public.review_workspace_settings where singleton;
  if reviewer is null then raise exception 'reviewer_not_configured' using errcode = '55000'; end if;
  insert into public.projects(owner_id, name, description)
  values(who, btrim(p_name), 'Espacio compartido: el administrador de LichenDR puede consultar las fotografías y resultados de este proyecto. El creador conserva la edición y puede retirar el acceso.') returning * into created;
  insert into public.project_review_access(project_id, reviewer_id, created_by, creation_key)
  values(created.id, reviewer, who, p_request_key);
  return created;
end;
$$;
revoke all on function public.can_review_project(uuid), public.review_project_for_site(uuid),
  public.review_project_for_sample(uuid), public.can_review_image(uuid), public.can_review_object(text),
  public.create_review_project(text, uuid) from public, anon;
grant execute on function public.can_review_project(uuid), public.review_project_for_site(uuid),
  public.review_project_for_sample(uuid), public.can_review_image(uuid), public.can_review_object(text),
  public.create_review_project(text, uuid) to authenticated;

-- Existing public-table policies remain owner-only, including exports/backups.
-- Reviewers read a bounded project snapshot through these dedicated RPCs.
create function public.list_review_projects() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
    select p.id, p.name, p.created_at, p.owner_id,
      coalesce(nullif(left(u.raw_user_meta_data->>'full_name', 120), ''), 'Participante') as contributor_name,
      (select count(*) from public.images i join public.tree_samples t on t.id = i.tree_sample_id
        join public.sites s on s.id = t.site_id where s.project_id = p.id) as photo_count
    from public.project_review_access a join public.projects p on p.id = a.project_id and p.owner_id = a.created_by
    join auth.users u on u.id = p.owner_id
    where a.reviewer_id = auth.uid() and a.created_by <> auth.uid()
    order by a.created_at desc limit 500
  ) x;
$$;
create function public.read_review_project(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.can_review_project(p_project_id) then
    raise exception 'review_project_not_available' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'projects', (select jsonb_agg(to_jsonb(x)) from (select id, name, owner_id from public.projects where id = p_project_id) x),
    'sites', coalesce((select jsonb_agg(to_jsonb(x)) from (select id, name, project_id from public.sites where project_id = p_project_id) x),'[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(x)) from (select e.id, e.name, e.site_id, e.sampled_at from public.sampling_events e join public.sites s on s.id = e.site_id where s.project_id = p_project_id) x),'[]'::jsonb),
    'trees', coalesce((select jsonb_agg(to_jsonb(x)) from (select t.id, t.code, t.site_id from public.trees t join public.sites s on s.id = t.site_id where s.project_id = p_project_id) x),'[]'::jsonb),
    'samples', coalesce((select jsonb_agg(to_jsonb(x)) from (select t.id, t.tree_id, t.site_id, t.sampling_event_id from public.tree_samples t join public.sites s on s.id = t.site_id where s.project_id = p_project_id) x),'[]'::jsonb),
    'series', coalesce((select jsonb_agg(to_jsonb(x)) from (select c.id, c.tree_sample_id, c.created_at from public.capture_series c join public.tree_samples t on t.id = c.tree_sample_id join public.sites s on s.id = t.site_id where s.project_id = p_project_id) x),'[]'::jsonb),
    'captures', coalesce((select jsonb_agg(to_jsonb(x)) from (select v.id, v.capture_series_id, v.image_id, v.direction, v.active from public.capture_views v join public.capture_series c on c.id = v.capture_series_id join public.tree_samples t on t.id = c.tree_sample_id join public.sites s on s.id = t.site_id where s.project_id = p_project_id) x),'[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(x)) from (select r.image_id, r.tree_sample_id, r.owner_id, r.direction, r.review, r.revision from public.guided_capture_reviews r join public.tree_samples t on t.id = r.tree_sample_id join public.sites s on s.id = t.site_id where s.project_id = p_project_id) x),'[]'::jsonb),
    'images', coalesce((select jsonb_agg(to_jsonb(x)) from (select i.id, i.tree_sample_id, i.storage_path, i.original_filename, i.created_at from public.images i join public.tree_samples t on t.id = i.tree_sample_id join public.sites s on s.id = t.site_id where s.project_id = p_project_id) x),'[]'::jsonb)
  ) into result;
  if octet_length(result::text) > 3000000 then raise exception 'review_project_too_large' using errcode = '54000'; end if;
  return result;
end;
$$;
revoke all on function public.list_review_projects(), public.read_review_project(uuid) from public, anon;
grant execute on function public.list_review_projects(), public.read_review_project(uuid) to authenticated;
create policy storage_review_read on storage.objects for select to authenticated
using(bucket_id = 'lichen-images' and public.can_review_object(name));
commit;

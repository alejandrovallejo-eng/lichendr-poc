create table if not exists public.sampling_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null,
  sampled_at timestamptz not null default now(),
  observer_names text,
  weather_notes text,
  protocol_version text not null default 'poc-v1',
  status text not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sampling_events_name_not_blank check (btrim(name) <> ''),
  constraint sampling_events_name_trimmed check (name = btrim(name)),
  constraint sampling_events_name_max_length check (char_length(name) <= 120),
  constraint sampling_events_protocol_version_not_blank check (btrim(protocol_version) <> ''),
  constraint sampling_events_protocol_version_max_length check (char_length(protocol_version) <= 50),
  constraint sampling_events_status_allowed check (status in ('draft', 'completed'))
);

create index if not exists idx_sampling_events_site_id on public.sampling_events(site_id);
create index if not exists idx_sampling_events_site_id_sampled_at_desc on public.sampling_events(site_id, sampled_at desc);
create unique index if not exists idx_sampling_events_site_id_name_lower on public.sampling_events(site_id, lower(name));

create or replace function public.set_updated_at()
returns trigger as $$
declare
  row_ref alias for new;
begin
  row_ref.updated_at = now();
  return row_ref;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.sampling_events;
create trigger set_updated_at
before update on public.sampling_events
for each row execute function public.set_updated_at();

alter table public.sampling_events enable row level security;

drop policy if exists sampling_events_select_authenticated on public.sampling_events;
create policy sampling_events_select_authenticated on public.sampling_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.sampling_events.site_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists sampling_events_insert_authenticated on public.sampling_events;
create policy sampling_events_insert_authenticated on public.sampling_events
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = site_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists sampling_events_update_authenticated on public.sampling_events;
create policy sampling_events_update_authenticated on public.sampling_events
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.sampling_events.site_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = site_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists sampling_events_delete_authenticated on public.sampling_events;
create policy sampling_events_delete_authenticated on public.sampling_events
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.sampling_events.site_id
        and p.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.sampling_events to authenticated;
grant execute on function public.set_updated_at() to authenticated;

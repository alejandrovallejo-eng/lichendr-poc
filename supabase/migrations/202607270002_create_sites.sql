create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  description text,
  country_code text not null default 'DO',
  province text,
  municipality text,
  latitude double precision,
  longitude double precision,
  gps_accuracy_m double precision,
  location_source text not null default 'unknown',
  radius_m integer not null default 100,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sites_name_not_blank check (btrim(name) <> ''),
  constraint sites_name_trimmed check (name = btrim(name)),
  constraint sites_name_max_length check (char_length(name) <= 120),
  constraint sites_latitude_range check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint sites_longitude_range check (longitude is null or (longitude >= -180 and longitude <= 180)),
  constraint sites_gps_accuracy_non_negative check (gps_accuracy_m is null or gps_accuracy_m >= 0),
  constraint sites_lat_lon_both_null_or_present check (
    (latitude is null and longitude is null) or
    (latitude is not null and longitude is not null)
  ),
  constraint sites_location_source_allowed check (location_source in ('unknown', 'manual', 'exif', 'gps')),
  constraint sites_radius_allowed check (radius_m in (50, 100, 250, 500, 1000)),
  constraint sites_country_code_do check (country_code = 'DO')
);

create index if not exists idx_sites_project_id on public.sites(project_id);
create unique index if not exists idx_sites_project_id_name_lower on public.sites(project_id, lower(name));

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.sites;
create trigger set_updated_at
before update on public.sites
for each row execute function public.set_updated_at();

alter table public.sites enable row level security;

drop policy if exists sites_select_authenticated on public.sites;
create policy sites_select_authenticated on public.sites
  for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = public.sites.project_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists sites_insert_authenticated on public.sites;
create policy sites_insert_authenticated on public.sites
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists sites_update_authenticated on public.sites;
create policy sites_update_authenticated on public.sites
  for update
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = public.sites.project_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists sites_delete_authenticated on public.sites;
create policy sites_delete_authenticated on public.sites
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = public.sites.project_id
        and p.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.sites to authenticated;
grant execute on function public.set_updated_at() to authenticated;

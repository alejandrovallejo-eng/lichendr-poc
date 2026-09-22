create table if not exists public.trees (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  code text not null,
  species_name text,
  species_confidence text not null default 'unknown',
  latitude double precision,
  longitude double precision,
  gps_accuracy_m double precision,
  location_source text not null default 'unknown',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trees_code_not_blank check (btrim(code) <> ''),
  constraint trees_code_trimmed check (code = btrim(code)),
  constraint trees_code_max_length check (char_length(code) <= 80),
  constraint trees_species_confidence_allowed check (species_confidence in ('unknown', 'low', 'medium', 'high')),
  constraint trees_location_source_allowed check (location_source in ('unknown', 'manual', 'exif', 'gps')),
  constraint trees_latitude_range check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint trees_longitude_range check (longitude is null or (longitude >= -180 and longitude <= 180)),
  constraint trees_lat_lon_both_null_or_present check (
    (latitude is null and longitude is null) or
    (latitude is not null and longitude is not null)
  ),
  constraint trees_gps_accuracy_non_negative check (gps_accuracy_m is null or gps_accuracy_m >= 0)
);

create index if not exists idx_trees_site_id on public.trees(site_id);
create unique index if not exists idx_trees_site_id_code_lower on public.trees(site_id, lower(code));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trees_id_site_id_unique'
      and conrelid = 'public.trees'::regclass
      and contype = 'u'
  ) then
    alter table public.trees
      add constraint trees_id_site_id_unique
      unique (id, site_id);
  end if;
end
$$;

drop trigger if exists set_updated_at on public.trees;
create trigger set_updated_at
before update on public.trees
for each row
execute function public.set_updated_at();

alter table public.trees enable row level security;

drop policy if exists trees_select_authenticated on public.trees;
create policy trees_select_authenticated on public.trees
  for select
  to authenticated
  using (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.trees.site_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists trees_insert_authenticated on public.trees;
create policy trees_insert_authenticated on public.trees
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = site_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists trees_update_authenticated on public.trees;
create policy trees_update_authenticated on public.trees
  for update
  to authenticated
  using (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.trees.site_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = site_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists trees_delete_authenticated on public.trees;
create policy trees_delete_authenticated on public.trees
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.trees.site_id
        and p.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.trees to authenticated;

grant execute on function public.set_updated_at() to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sampling_events_id_site_id_unique'
      and conrelid = 'public.sampling_events'::regclass
      and contype = 'u'
  ) then
    alter table public.sampling_events
      add constraint sampling_events_id_site_id_unique
      unique (id, site_id);
  end if;
end
$$;

create table if not exists public.tree_samples (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  sampling_event_id uuid not null,
  tree_id uuid not null,
  substrate_type text not null default 'tree_bark',
  trunk_orientation text not null default 'unknown',
  sampling_height_m double precision,
  shade_level text not null default 'unknown',
  confidence_level text not null default 'unknown',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tree_samples_substrate_type_allowed check (substrate_type in ('tree_bark', 'dead_wood', 'rock', 'soil', 'concrete', 'other', 'unknown')),
  constraint tree_samples_trunk_orientation_allowed check (trunk_orientation in ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'multiple', 'unknown')),
  constraint tree_samples_shade_level_allowed check (shade_level in ('unknown', 'low', 'medium', 'high')),
  constraint tree_samples_confidence_level_allowed check (confidence_level in ('unknown', 'low', 'medium', 'high')),
  constraint tree_samples_height_non_negative check (sampling_height_m is null or sampling_height_m >= 0),
  constraint tree_samples_unique_tree_per_event unique (sampling_event_id, tree_id),
  constraint tree_samples_tree_site_fk foreign key (tree_id, site_id) references public.trees(id, site_id) on delete cascade,
  constraint tree_samples_event_site_fk foreign key (sampling_event_id, site_id) references public.sampling_events(id, site_id) on delete cascade
);

create index if not exists idx_tree_samples_site_id on public.tree_samples(site_id);
create index if not exists idx_tree_samples_tree_id on public.tree_samples(tree_id);
create index if not exists idx_tree_samples_sampling_event_id on public.tree_samples(sampling_event_id);


drop trigger if exists set_updated_at on public.tree_samples;
create trigger set_updated_at
before update on public.tree_samples
for each row
execute function public.set_updated_at();

alter table public.tree_samples enable row level security;

drop policy if exists tree_samples_select_authenticated on public.tree_samples;
create policy tree_samples_select_authenticated on public.tree_samples
  for select
  to authenticated
  using (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.tree_samples.site_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists tree_samples_insert_authenticated on public.tree_samples;
create policy tree_samples_insert_authenticated on public.tree_samples
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = site_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists tree_samples_update_authenticated on public.tree_samples;
create policy tree_samples_update_authenticated on public.tree_samples
  for update
  to authenticated
  using (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.tree_samples.site_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = site_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists tree_samples_delete_authenticated on public.tree_samples;
create policy tree_samples_delete_authenticated on public.tree_samples
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.tree_samples.site_id
        and p.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.tree_samples to authenticated;
grant execute on function public.set_updated_at() to authenticated;

-- Additive migration for Phase 1 Environmental Quality.
-- Audits and reuses existing columns instead of duplicating them:
--   - public.sites: latitude, longitude, radius_m, notes (site identity/location).
--   - public.sampling_events: sampled_at (event timing/provenance).
--   - public.trees: species_name, species_confidence, latitude, longitude (tree identity).
--   - public.tree_samples: sampling_height_m, trunk_orientation, notes (sampling context already captured).
-- This migration only adds normalized storage for context that is NOT already captured above,
-- plus optional pollutant measurements. It does not compute, store or imply any environmental
-- estimate, index or score; all new fields are descriptive field/laboratory observations.

-- 1) Site-level environmental context (one row per site).
create table if not exists public.site_environmental_contexts (
  site_id uuid primary key references public.sites(id) on delete cascade,
  land_use_type text not null default 'unknown',
  pollution_source_proximity text not null default 'unknown',
  dominant_wind_direction text not null default 'unknown',
  ambient_temperature_c double precision,
  relative_humidity_percent double precision,
  context_source text not null default 'unknown',
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_environmental_contexts_land_use_type_allowed
    check (land_use_type in ('unknown', 'urban', 'peri_urban', 'rural', 'industrial', 'protected_area', 'agricultural', 'coastal')),
  constraint site_environmental_contexts_pollution_source_proximity_allowed
    check (pollution_source_proximity in ('unknown', 'none_nearby', 'low', 'medium', 'high')),
  constraint site_environmental_contexts_dominant_wind_direction_allowed
    check (dominant_wind_direction in ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'variable', 'unknown')),
  -- Documented range: -10C to 50C covers the ambient field conditions reported across the
  -- European lichen biomonitoring protocol's multi-country meta-analysis (Counoy et al. 2025,
  -- 15 countries) and the Dominican Republic's tropical climate. Temperature is recorded as a
  -- descriptive climatic confounder only; it is never converted or used to derive an index.
  constraint site_environmental_contexts_ambient_temperature_range
    check (ambient_temperature_c is null or (ambient_temperature_c >= -10 and ambient_temperature_c <= 50)),
  constraint site_environmental_contexts_relative_humidity_range
    check (relative_humidity_percent is null or (relative_humidity_percent >= 0 and relative_humidity_percent <= 100)),
  constraint site_environmental_contexts_context_source_allowed
    check (context_source in ('unknown', 'field_observation', 'public_data', 'estimated', 'other'))
);

create index if not exists idx_site_environmental_contexts_land_use_type
  on public.site_environmental_contexts(land_use_type);
create index if not exists idx_site_environmental_contexts_pollution_source_proximity
  on public.site_environmental_contexts(pollution_source_proximity);

drop trigger if exists set_updated_at on public.site_environmental_contexts;
create trigger set_updated_at
before update on public.site_environmental_contexts
for each row execute function public.set_updated_at();

alter table public.site_environmental_contexts enable row level security;

drop policy if exists site_environmental_contexts_select_authenticated on public.site_environmental_contexts;
create policy site_environmental_contexts_select_authenticated on public.site_environmental_contexts
  for select
  to authenticated
  using (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.site_environmental_contexts.site_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists site_environmental_contexts_insert_authenticated on public.site_environmental_contexts;
create policy site_environmental_contexts_insert_authenticated on public.site_environmental_contexts
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

drop policy if exists site_environmental_contexts_update_authenticated on public.site_environmental_contexts;
create policy site_environmental_contexts_update_authenticated on public.site_environmental_contexts
  for update
  to authenticated
  using (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.site_environmental_contexts.site_id
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

drop policy if exists site_environmental_contexts_delete_authenticated on public.site_environmental_contexts;
create policy site_environmental_contexts_delete_authenticated on public.site_environmental_contexts
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.site_environmental_contexts.site_id
        and p.owner_id = auth.uid()
    )
  );

revoke all on table public.site_environmental_contexts from anon;
grant select, insert, update, delete on public.site_environmental_contexts to authenticated;

-- 2) Tree-sample-level scientific context (one row per tree sample).
create table if not exists public.tree_sample_scientific_contexts (
  tree_sample_id uuid primary key references public.tree_samples(id) on delete cascade,
  diameter_at_breast_height_cm double precision,
  bark_ph double precision,
  bark_ph_method text not null default 'unknown',
  light_exposure_category text not null default 'unknown',
  context_source text not null default 'unknown',
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tree_sample_scientific_contexts_dbh_positive
    check (diameter_at_breast_height_cm is null or diameter_at_breast_height_cm > 0),
  constraint tree_sample_scientific_contexts_bark_ph_range
    check (bark_ph is null or (bark_ph >= 0 and bark_ph <= 14)),
  constraint tree_sample_scientific_contexts_bark_ph_method_allowed
    check (bark_ph_method in ('unknown', 'field_probe', 'laboratory_analysis', 'estimated')),
  constraint tree_sample_scientific_contexts_light_exposure_category_allowed
    check (light_exposure_category in ('unknown', 'full_sun', 'partial_shade', 'full_shade')),
  constraint tree_sample_scientific_contexts_context_source_allowed
    check (context_source in ('unknown', 'field_observation', 'public_data', 'estimated', 'other'))
);

create index if not exists idx_tree_sample_scientific_contexts_light_exposure_category
  on public.tree_sample_scientific_contexts(light_exposure_category);

drop trigger if exists set_updated_at on public.tree_sample_scientific_contexts;
create trigger set_updated_at
before update on public.tree_sample_scientific_contexts
for each row execute function public.set_updated_at();

alter table public.tree_sample_scientific_contexts enable row level security;

drop policy if exists tree_sample_scientific_contexts_select_authenticated on public.tree_sample_scientific_contexts;
create policy tree_sample_scientific_contexts_select_authenticated on public.tree_sample_scientific_contexts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = public.tree_sample_scientific_contexts.tree_sample_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists tree_sample_scientific_contexts_insert_authenticated on public.tree_sample_scientific_contexts;
create policy tree_sample_scientific_contexts_insert_authenticated on public.tree_sample_scientific_contexts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = tree_sample_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists tree_sample_scientific_contexts_update_authenticated on public.tree_sample_scientific_contexts;
create policy tree_sample_scientific_contexts_update_authenticated on public.tree_sample_scientific_contexts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = public.tree_sample_scientific_contexts.tree_sample_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = tree_sample_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists tree_sample_scientific_contexts_delete_authenticated on public.tree_sample_scientific_contexts;
create policy tree_sample_scientific_contexts_delete_authenticated on public.tree_sample_scientific_contexts
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = public.tree_sample_scientific_contexts.tree_sample_id
        and p.owner_id = auth.uid()
    )
  );

revoke all on table public.tree_sample_scientific_contexts from anon;
grant select, insert, update, delete on public.tree_sample_scientific_contexts to authenticated;

-- 3) Optional pollutant measurements (zero or many rows per sampling event).
-- Reuses the existing composite unique constraint sampling_events_id_site_id_unique
-- (created in 202607270004_create_trees_and_tree_samples.sql) for the composite foreign key.
create table if not exists public.pollutant_measurements (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  sampling_event_id uuid not null,
  pollutant text not null,
  value_numeric double precision not null,
  unit text not null,
  measurement_method text not null default 'unknown',
  source_reference text,
  measured_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pollutant_measurements_pollutant_not_blank check (btrim(pollutant) <> ''),
  constraint pollutant_measurements_pollutant_trimmed check (pollutant = btrim(pollutant)),
  constraint pollutant_measurements_pollutant_max_length check (char_length(pollutant) <= 100),
  -- Physical concentrations cannot be negative. Units are intentionally NOT constrained or
  -- converted here: `unit` is free text and no check ties a pollutant to a required unit.
  constraint pollutant_measurements_value_non_negative check (value_numeric >= 0),
  constraint pollutant_measurements_unit_not_blank check (btrim(unit) <> ''),
  constraint pollutant_measurements_unit_trimmed check (unit = btrim(unit)),
  constraint pollutant_measurements_unit_max_length check (char_length(unit) <= 40),
  constraint pollutant_measurements_measurement_method_allowed
    check (measurement_method in ('unknown', 'field_instrument', 'public_monitoring_station', 'laboratory_analysis', 'estimated', 'other')),
  constraint pollutant_measurements_source_reference_trimmed
    check (source_reference is null or source_reference = btrim(source_reference)),
  constraint pollutant_measurements_source_reference_max_length
    check (source_reference is null or char_length(source_reference) <= 255),
  constraint pollutant_measurements_event_site_fk foreign key (sampling_event_id, site_id)
    references public.sampling_events(id, site_id) on delete cascade
);

create index if not exists idx_pollutant_measurements_site_id
  on public.pollutant_measurements(site_id);
create index if not exists idx_pollutant_measurements_sampling_event_id
  on public.pollutant_measurements(sampling_event_id);
create index if not exists idx_pollutant_measurements_pollutant
  on public.pollutant_measurements(pollutant);
create index if not exists idx_pollutant_measurements_measured_at_desc
  on public.pollutant_measurements(measured_at desc);

drop trigger if exists set_updated_at on public.pollutant_measurements;
create trigger set_updated_at
before update on public.pollutant_measurements
for each row execute function public.set_updated_at();

alter table public.pollutant_measurements enable row level security;

drop policy if exists pollutant_measurements_select_authenticated on public.pollutant_measurements;
create policy pollutant_measurements_select_authenticated on public.pollutant_measurements
  for select
  to authenticated
  using (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.pollutant_measurements.site_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists pollutant_measurements_insert_authenticated on public.pollutant_measurements;
create policy pollutant_measurements_insert_authenticated on public.pollutant_measurements
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

drop policy if exists pollutant_measurements_update_authenticated on public.pollutant_measurements;
create policy pollutant_measurements_update_authenticated on public.pollutant_measurements
  for update
  to authenticated
  using (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.pollutant_measurements.site_id
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

drop policy if exists pollutant_measurements_delete_authenticated on public.pollutant_measurements;
create policy pollutant_measurements_delete_authenticated on public.pollutant_measurements
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.sites s
      join public.projects p on p.id = s.project_id
      where s.id = public.pollutant_measurements.site_id
        and p.owner_id = auth.uid()
    )
  );

revoke all on table public.pollutant_measurements from anon;
grant select, insert, update, delete on public.pollutant_measurements to authenticated;

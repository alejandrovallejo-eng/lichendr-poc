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
  land_use_classification text,
  -- Nullable boolean: true = confirmed reference/control candidate, false = confirmed not a
  -- candidate, null = reference status not yet assessed ("unknown"). Kept as a real boolean
  -- (not a text enum) so "unknown" is represented by SQL NULL rather than a string literal.
  is_reference_candidate boolean,
  measured_at timestamptz,
  provenance text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_environmental_contexts_land_use_classification_not_blank
    check (land_use_classification is null or btrim(land_use_classification) <> ''),
  constraint site_environmental_contexts_land_use_classification_trimmed
    check (land_use_classification is null or land_use_classification = btrim(land_use_classification)),
  constraint site_environmental_contexts_land_use_classification_max_length
    check (land_use_classification is null or char_length(land_use_classification) <= 160),
  constraint site_environmental_contexts_provenance_not_blank
    check (provenance is null or btrim(provenance) <> ''),
  constraint site_environmental_contexts_provenance_trimmed
    check (provenance is null or provenance = btrim(provenance)),
  constraint site_environmental_contexts_provenance_max_length
    check (provenance is null or char_length(provenance) <= 255)
);

create index if not exists idx_site_environmental_contexts_is_reference_candidate
  on public.site_environmental_contexts(is_reference_candidate);

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
  sampled_width_cm double precision,
  sampled_height_cm double precision,
  -- Host-tree structural context (diameter at breast height) measured at sampling time.
  -- Does not duplicate species identity, which already exists on public.trees
  -- (species_name, species_confidence).
  dbh_cm double precision,
  bark_ph double precision,
  bark_texture text,
  canopy_cover_percent double precision,
  air_temperature_c double precision,
  relative_humidity_percent double precision,
  measured_at timestamptz,
  provenance text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tree_sample_scientific_contexts_sampled_width_positive
    check (sampled_width_cm is null or sampled_width_cm > 0),
  constraint tree_sample_scientific_contexts_sampled_height_positive
    check (sampled_height_cm is null or sampled_height_cm > 0),
  constraint tree_sample_scientific_contexts_dbh_positive
    check (dbh_cm is null or dbh_cm > 0),
  constraint tree_sample_scientific_contexts_bark_ph_range
    check (bark_ph is null or (bark_ph >= 0 and bark_ph <= 14)),
  constraint tree_sample_scientific_contexts_bark_texture_not_blank
    check (bark_texture is null or btrim(bark_texture) <> ''),
  constraint tree_sample_scientific_contexts_bark_texture_trimmed
    check (bark_texture is null or bark_texture = btrim(bark_texture)),
  constraint tree_sample_scientific_contexts_bark_texture_max_length
    check (bark_texture is null or char_length(bark_texture) <= 120),
  constraint tree_sample_scientific_contexts_canopy_cover_range
    check (canopy_cover_percent is null or (canopy_cover_percent >= 0 and canopy_cover_percent <= 100)),
  -- Operational validation range (-10C to 50C): this is a plausibility check for field air
  -- temperature entries, intended only to catch obvious data-entry errors (e.g. a misplaced
  -- digit or unit mix-up). It is NOT derived from Counoy et al. (2025) or any other cited
  -- paper as an established scientific range; no source specifies this exact range. Out-of-range
  -- values are rejected outright (the insert/update fails) — never clamped, adjusted, or
  -- silently changed.
  constraint tree_sample_scientific_contexts_air_temperature_range
    check (air_temperature_c is null or (air_temperature_c >= -10 and air_temperature_c <= 50)),
  constraint tree_sample_scientific_contexts_relative_humidity_range
    check (relative_humidity_percent is null or (relative_humidity_percent >= 0 and relative_humidity_percent <= 100)),
  constraint tree_sample_scientific_contexts_provenance_not_blank
    check (provenance is null or btrim(provenance) <> ''),
  constraint tree_sample_scientific_contexts_provenance_trimmed
    check (provenance is null or provenance = btrim(provenance)),
  constraint tree_sample_scientific_contexts_provenance_max_length
    check (provenance is null or char_length(provenance) <= 255)
);

create index if not exists idx_tree_sample_scientific_contexts_measured_at
  on public.tree_sample_scientific_contexts(measured_at);

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

-- 3) Optional pollutant measurements (zero or many rows per site; sampling_event_id is
-- nullable but must remain site-consistent whenever it is provided).
-- Reuses the existing composite unique constraint sampling_events_id_site_id_unique
-- (created in 202607270004_create_trees_and_tree_samples.sql) for the composite foreign key.
-- Because sampling_event_id is nullable, Postgres MATCH SIMPLE semantics skip the composite
-- FK check whenever sampling_event_id is null, while still enforcing that a provided
-- sampling_event_id belongs to the same site_id.
create table if not exists public.pollutant_measurements (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  sampling_event_id uuid,
  measured_at timestamptz not null,
  pollutant_code text not null,
  value double precision not null,
  unit text not null,
  averaging_period text,
  instrument_method text,
  data_source text not null,
  qa_qc_status text not null default 'not_assessed',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pollutant_measurements_pollutant_code_allowed
    check (pollutant_code in ('PM2.5', 'PM10', 'NO2', 'SO2', 'NH3', 'O3', 'CO')),
  -- `value` intentionally has no sign/range constraint: it stores the raw numeric instrument
  -- output as-is (drift, calibration offsets, or sensor artifacts can produce negative raw
  -- readings). Reliability is assessed via `qa_qc_status`, not by rejecting the value at
  -- insert time. Units are intentionally NOT constrained or converted here: `unit` is free
  -- text and no check ties a pollutant code to a required unit.
  constraint pollutant_measurements_unit_not_blank check (btrim(unit) <> ''),
  constraint pollutant_measurements_unit_trimmed check (unit = btrim(unit)),
  constraint pollutant_measurements_unit_max_length check (char_length(unit) <= 40),
  constraint pollutant_measurements_averaging_period_trimmed
    check (averaging_period is null or averaging_period = btrim(averaging_period)),
  constraint pollutant_measurements_averaging_period_max_length
    check (averaging_period is null or char_length(averaging_period) <= 40),
  constraint pollutant_measurements_instrument_method_trimmed
    check (instrument_method is null or instrument_method = btrim(instrument_method)),
  constraint pollutant_measurements_instrument_method_max_length
    check (instrument_method is null or char_length(instrument_method) <= 160),
  constraint pollutant_measurements_data_source_not_blank check (btrim(data_source) <> ''),
  constraint pollutant_measurements_data_source_trimmed check (data_source = btrim(data_source)),
  constraint pollutant_measurements_data_source_max_length check (char_length(data_source) <= 120),
  constraint pollutant_measurements_qa_qc_status_allowed
    check (qa_qc_status in ('not_assessed', 'provisional', 'validated', 'rejected')),
  constraint pollutant_measurements_sampling_event_site_fk foreign key (sampling_event_id, site_id)
    references public.sampling_events(id, site_id) on delete cascade
);

create index if not exists idx_pollutant_measurements_site_id
  on public.pollutant_measurements(site_id);
create index if not exists idx_pollutant_measurements_sampling_event_id
  on public.pollutant_measurements(sampling_event_id);
create index if not exists idx_pollutant_measurements_pollutant_code
  on public.pollutant_measurements(pollutant_code);
create index if not exists idx_pollutant_measurements_measured_at_desc
  on public.pollutant_measurements(measured_at desc);
create index if not exists idx_pollutant_measurements_qa_qc_status
  on public.pollutant_measurements(qa_qc_status);

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

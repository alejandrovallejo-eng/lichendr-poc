create table if not exists public.annotation_metrics (
  annotation_set_id uuid primary key references public.annotation_sets(id) on delete cascade,
  trunk_area_pixels bigint,
  lichen_union_area_pixels bigint,
  lichen_outside_trunk_pixels bigint,
  overlapping_lichen_pixels bigint,
  coverage_percent numeric,
  accepted_region_count integer not null default 0,
  lichen_region_count integer not null default 0,
  morphotype_count integer not null default 0,
  calculation_method text not null,
  calculation_version text not null,
  quality_flags jsonb not null default '[]'::jsonb,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annotation_metrics_trunk_area_non_negative
    check (trunk_area_pixels is null or trunk_area_pixels >= 0),
  constraint annotation_metrics_lichen_union_area_non_negative
    check (lichen_union_area_pixels is null or lichen_union_area_pixels >= 0),
  constraint annotation_metrics_lichen_outside_trunk_non_negative
    check (lichen_outside_trunk_pixels is null or lichen_outside_trunk_pixels >= 0),
  constraint annotation_metrics_overlap_non_negative
    check (overlapping_lichen_pixels is null or overlapping_lichen_pixels >= 0),
  constraint annotation_metrics_coverage_range
    check (coverage_percent is null or coverage_percent between 0 and 100),
  constraint annotation_metrics_lichen_union_within_trunk
    check (
      trunk_area_pixels is null
      or lichen_union_area_pixels is null
      or lichen_union_area_pixels <= trunk_area_pixels
    ),
  constraint annotation_metrics_coverage_requires_trunk
    check (
      trunk_area_pixels is not null
      or coverage_percent is null
    ),
  constraint annotation_metrics_zero_trunk_has_no_coverage
    check (
      trunk_area_pixels is null
      or trunk_area_pixels <> 0
      or coverage_percent is null
    ),
  constraint annotation_metrics_coverage_matches_areas
    check (
      coverage_percent is null
      or (
        trunk_area_pixels > 0
        and lichen_union_area_pixels is not null
        and abs(
          coverage_percent
          - (lichen_union_area_pixels::numeric / trunk_area_pixels::numeric * 100)
        ) <= 0.01
      )
    ),
  constraint annotation_metrics_accepted_region_count_non_negative
    check (accepted_region_count >= 0),
  constraint annotation_metrics_lichen_region_count_non_negative
    check (lichen_region_count >= 0),
  constraint annotation_metrics_lichen_region_count_within_accepted
    check (lichen_region_count <= accepted_region_count),
  constraint annotation_metrics_morphotype_count_non_negative
    check (morphotype_count >= 0),
  constraint annotation_metrics_morphotype_count_within_lichen
    check (morphotype_count <= lichen_region_count),
  constraint annotation_metrics_calculation_method_not_blank
    check (btrim(calculation_method) <> ''),
  constraint annotation_metrics_calculation_method_trimmed
    check (calculation_method = btrim(calculation_method)),
  constraint annotation_metrics_calculation_version_not_blank
    check (btrim(calculation_version) <> ''),
  constraint annotation_metrics_calculation_version_trimmed
    check (calculation_version = btrim(calculation_version)),
  constraint annotation_metrics_quality_flags_container
    check (jsonb_typeof(quality_flags) in ('array', 'object'))
);

create index if not exists idx_annotation_metrics_calculated_at_desc
  on public.annotation_metrics(calculated_at desc);

drop trigger if exists set_updated_at on public.annotation_metrics;
create trigger set_updated_at
before update on public.annotation_metrics
for each row execute function public.set_updated_at();

alter table public.annotation_metrics enable row level security;

drop policy if exists annotation_metrics_select_authenticated on public.annotation_metrics;
create policy annotation_metrics_select_authenticated on public.annotation_metrics
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.annotation_sets a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = public.annotation_metrics.annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists annotation_metrics_insert_authenticated on public.annotation_metrics;
create policy annotation_metrics_insert_authenticated on public.annotation_metrics
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.annotation_sets a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists annotation_metrics_update_authenticated on public.annotation_metrics;
create policy annotation_metrics_update_authenticated on public.annotation_metrics
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.annotation_sets a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = public.annotation_metrics.annotation_set_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.annotation_sets a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists annotation_metrics_delete_authenticated on public.annotation_metrics;
create policy annotation_metrics_delete_authenticated on public.annotation_metrics
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.annotation_sets a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = public.annotation_metrics.annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

revoke all on table public.annotation_metrics from anon;
grant select, insert, update, delete on public.annotation_metrics to authenticated;

create extension if not exists "pgcrypto";

alter table public.annotation_sets
  drop constraint if exists annotation_sets_status_allowed;
alter table public.annotation_sets
  add constraint annotation_sets_status_allowed
  check (status in ('draft', 'provisional_ai', 'completed'));

alter table public.annotation_regions
  add column if not exists confidence double precision,
  add column if not exists algorithm_version text,
  add column if not exists template_version text,
  add column if not exists quality_flags jsonb not null default '[]'::jsonb;

alter table public.annotation_regions
  drop constraint if exists annotation_regions_source_allowed;
alter table public.annotation_regions
  add constraint annotation_regions_source_allowed
  check (source in ('mobile_sam', 'manual', 'color_assisted', 'automatic_four_view'));
alter table public.annotation_regions
  drop constraint if exists annotation_regions_confidence_range;
alter table public.annotation_regions
  add constraint annotation_regions_confidence_range
  check (confidence is null or confidence between 0 and 1);
alter table public.annotation_regions
  drop constraint if exists annotation_regions_quality_flags_container;
alter table public.annotation_regions
  add constraint annotation_regions_quality_flags_container
  check (jsonb_typeof(quality_flags) in ('array', 'object'));

create table if not exists public.capture_series (
  id uuid primary key default gen_random_uuid(),
  tree_sample_id uuid not null references public.tree_samples(id) on delete cascade,
  request_key uuid not null default gen_random_uuid() unique,
  template_version text not null default 'LICHENDR-FRAME-0.2',
  algorithm_version text not null,
  status text not null default 'capturing',
  review_status text not null default 'pending',
  total_valid_area_cm2 numeric,
  total_lichen_area_cm2 numeric,
  tree_lichen_coverage_percent numeric,
  occupied_cells integer,
  provisional_morphotype_richness integer,
  valid_view_count integer not null default 0,
  pending_view_count integer not null default 4,
  calculated_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capture_series_template_version_not_blank check (btrim(template_version) <> ''),
  constraint capture_series_algorithm_version_not_blank check (btrim(algorithm_version) <> ''),
  constraint capture_series_status_allowed
    check (status in ('capturing', 'processing', 'needs_retake', 'provisional_ai', 'confirmed')),
  constraint capture_series_review_status_allowed
    check (review_status in ('pending', 'confirmed', 'correction_requested')),
  constraint capture_series_areas_non_negative check (
    (total_valid_area_cm2 is null or total_valid_area_cm2 >= 0)
    and (total_lichen_area_cm2 is null or total_lichen_area_cm2 >= 0)
    and (total_valid_area_cm2 is null or total_valid_area_cm2 <= 2000)
    and (total_lichen_area_cm2 is null or total_lichen_area_cm2 <= 2000)
    and (
      total_lichen_area_cm2 is null
      or (total_valid_area_cm2 is not null and total_lichen_area_cm2 <= total_valid_area_cm2)
    )
  ),
  constraint capture_series_coverage_range
    check (tree_lichen_coverage_percent is null or tree_lichen_coverage_percent between 0 and 100),
  constraint capture_series_occupied_cells_range check (occupied_cells is null or occupied_cells between 0 and 20),
  constraint capture_series_richness_non_negative
    check (provisional_morphotype_richness is null or provisional_morphotype_richness >= 0),
  constraint capture_series_view_counts_range
    check (valid_view_count between 0 and 4 and pending_view_count between 0 and 4),
  constraint capture_series_view_counts_sum check (valid_view_count + pending_view_count = 4),
  constraint capture_series_complete_requires_four_valid check (
    status not in ('provisional_ai', 'confirmed') or (valid_view_count = 4 and pending_view_count = 0)
  )
);

create unique index if not exists idx_capture_series_one_open_per_algorithm
  on public.capture_series(tree_sample_id, algorithm_version)
  where status in ('capturing', 'processing', 'needs_retake', 'provisional_ai');
create index if not exists idx_capture_series_tree_sample on public.capture_series(tree_sample_id);
create index if not exists idx_capture_series_created_at_desc on public.capture_series(created_at desc);

create table if not exists public.capture_views (
  id uuid primary key default gen_random_uuid(),
  capture_series_id uuid not null references public.capture_series(id) on delete cascade,
  image_id uuid not null unique references public.images(id) on delete restrict,
  annotation_set_id uuid references public.annotation_sets(id) on delete set null,
  request_key uuid not null default gen_random_uuid() unique,
  direction text not null,
  active boolean not null default true,
  replaces_view_id uuid references public.capture_views(id) on delete set null,
  processing_status text not null default 'uploaded',
  template_version text not null default 'LICHENDR-FRAME-0.2',
  algorithm_version text not null,
  source text not null default 'mobile_sam_cielab',
  model_name text not null default 'MobileSAM vit_t',
  model_version text,
  rectified_storage_path text,
  union_mask_storage_path text,
  valid_area_cm2 numeric,
  lichen_union_area_cm2 numeric,
  lichen_coverage_percent numeric,
  component_count integer,
  occupied_cells integer,
  provisional_morphotype_richness integer,
  morphotype_coverage jsonb not null default '{}'::jsonb,
  reprojection_error_px double precision,
  quality_score double precision,
  quality_flags jsonb not null default '[]'::jsonb,
  confidence double precision,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capture_views_direction_allowed check (direction in ('N', 'E', 'S', 'W')),
  constraint capture_views_processing_status_allowed
    check (processing_status in ('uploaded', 'processing', 'repeat_photo', 'provisional_ai', 'confirmed', 'failed')),
  constraint capture_views_versions_not_blank
    check (btrim(template_version) <> '' and btrim(algorithm_version) <> ''),
  constraint capture_views_source_not_blank check (btrim(source) <> ''),
  constraint capture_views_model_not_blank check (btrim(model_name) <> ''),
  constraint capture_views_paths_trimmed check (
    (rectified_storage_path is null or rectified_storage_path = btrim(rectified_storage_path))
    and (union_mask_storage_path is null or union_mask_storage_path = btrim(union_mask_storage_path))
  ),
  constraint capture_views_areas_non_negative check (
    (valid_area_cm2 is null or valid_area_cm2 >= 0)
    and (lichen_union_area_cm2 is null or lichen_union_area_cm2 >= 0)
    and (valid_area_cm2 is null or valid_area_cm2 <= 500)
    and (lichen_union_area_cm2 is null or lichen_union_area_cm2 <= 500)
    and (
      lichen_union_area_cm2 is null
      or (valid_area_cm2 is not null and lichen_union_area_cm2 <= valid_area_cm2)
    )
  ),
  constraint capture_views_coverage_range
    check (lichen_coverage_percent is null or lichen_coverage_percent between 0 and 100),
  constraint capture_views_counts_non_negative check (
    (component_count is null or component_count >= 0)
    and (provisional_morphotype_richness is null or provisional_morphotype_richness >= 0)
  ),
  constraint capture_views_occupied_cells_range check (occupied_cells is null or occupied_cells between 0 and 5),
  constraint capture_views_reprojection_non_negative
    check (reprojection_error_px is null or reprojection_error_px >= 0),
  constraint capture_views_quality_score_range check (quality_score is null or quality_score between 0 and 1),
  constraint capture_views_confidence_range check (confidence is null or confidence between 0 and 1),
  constraint capture_views_quality_flags_array check (jsonb_typeof(quality_flags) = 'array'),
  constraint capture_views_morphotype_coverage_object check (jsonb_typeof(morphotype_coverage) = 'object'),
  constraint capture_views_not_self_replacement check (replaces_view_id is null or replaces_view_id <> id)
);

create unique index if not exists idx_capture_views_active_direction
  on public.capture_views(capture_series_id, direction)
  where active;
create index if not exists idx_capture_views_series on public.capture_views(capture_series_id);
create index if not exists idx_capture_views_annotation_set on public.capture_views(annotation_set_id);

drop trigger if exists set_updated_at on public.capture_series;
create trigger set_updated_at before update on public.capture_series
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.capture_views;
create trigger set_updated_at before update on public.capture_views
  for each row execute function public.set_updated_at();

alter table public.capture_series enable row level security;
alter table public.capture_views enable row level security;

drop policy if exists capture_series_select_authenticated on public.capture_series;
create policy capture_series_select_authenticated on public.capture_series
  for select to authenticated using (
    exists (
      select 1 from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = public.capture_series.tree_sample_id and p.owner_id = auth.uid()
    )
  );
drop policy if exists capture_series_insert_authenticated on public.capture_series;
create policy capture_series_insert_authenticated on public.capture_series
  for insert to authenticated with check (
    exists (
      select 1 from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = tree_sample_id and p.owner_id = auth.uid()
    )
  );
drop policy if exists capture_series_update_authenticated on public.capture_series;
create policy capture_series_update_authenticated on public.capture_series
  for update to authenticated
  using (
    exists (
      select 1 from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = public.capture_series.tree_sample_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = tree_sample_id and p.owner_id = auth.uid()
    )
  );
drop policy if exists capture_series_delete_authenticated on public.capture_series;
create policy capture_series_delete_authenticated on public.capture_series
  for delete to authenticated using (
    exists (
      select 1 from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = public.capture_series.tree_sample_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists capture_views_select_authenticated on public.capture_views;
create policy capture_views_select_authenticated on public.capture_views
  for select to authenticated using (
    exists (
      select 1 from public.capture_series cs
      join public.tree_samples ts on ts.id = cs.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where cs.id = public.capture_views.capture_series_id and p.owner_id = auth.uid()
    )
  );
drop policy if exists capture_views_insert_authenticated on public.capture_views;
create policy capture_views_insert_authenticated on public.capture_views
  for insert to authenticated with check (
    exists (
      select 1 from public.capture_series cs
      join public.tree_samples ts on ts.id = cs.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      join public.images i
        on i.id = public.capture_views.image_id
       and i.tree_sample_id = cs.tree_sample_id
      where cs.id = public.capture_views.capture_series_id
        and p.owner_id = auth.uid()
        and (
          public.capture_views.annotation_set_id is null
          or exists (
            select 1 from public.annotation_sets aset
            where aset.id = public.capture_views.annotation_set_id
              and aset.image_id = public.capture_views.image_id
          )
        )
    )
  );
drop policy if exists capture_views_update_authenticated on public.capture_views;
create policy capture_views_update_authenticated on public.capture_views
  for update to authenticated
  using (
    exists (
      select 1 from public.capture_series cs
      join public.tree_samples ts on ts.id = cs.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where cs.id = public.capture_views.capture_series_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.capture_series cs
      join public.tree_samples ts on ts.id = cs.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      join public.images i
        on i.id = public.capture_views.image_id
       and i.tree_sample_id = cs.tree_sample_id
      where cs.id = public.capture_views.capture_series_id
        and p.owner_id = auth.uid()
        and (
          public.capture_views.annotation_set_id is null
          or exists (
            select 1 from public.annotation_sets aset
            where aset.id = public.capture_views.annotation_set_id
              and aset.image_id = public.capture_views.image_id
          )
        )
    )
  );
drop policy if exists capture_views_delete_authenticated on public.capture_views;
create policy capture_views_delete_authenticated on public.capture_views
  for delete to authenticated using (
    exists (
      select 1 from public.capture_series cs
      join public.tree_samples ts on ts.id = cs.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where cs.id = public.capture_views.capture_series_id and p.owner_id = auth.uid()
    )
  );

create or replace function public.get_or_create_capture_series(
  p_tree_sample_id uuid,
  p_algorithm_version text,
  p_request_key uuid,
  p_template_version text default 'LICHENDR-FRAME-0.2'
) returns public.capture_series
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.capture_series;
begin
  insert into public.capture_series (
    tree_sample_id, algorithm_version, request_key, template_version
  ) values (
    p_tree_sample_id, btrim(p_algorithm_version), p_request_key, btrim(p_template_version)
  )
  on conflict (tree_sample_id, algorithm_version)
    where status in ('capturing', 'processing', 'needs_retake', 'provisional_ai')
  do nothing
  returning * into result;

  if result.id is null then
    select * into result
    from public.capture_series
    where tree_sample_id = p_tree_sample_id
      and algorithm_version = btrim(p_algorithm_version)
      and status in ('capturing', 'processing', 'needs_retake', 'provisional_ai')
    order by created_at desc
    limit 1;
  end if;
  return result;
end;
$$;

create or replace function public.register_capture_view(
  p_series_id uuid,
  p_image_id uuid,
  p_direction text,
  p_algorithm_version text,
  p_request_key uuid
) returns public.capture_views
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.capture_views;
  previous_id uuid;
begin
  select * into result from public.capture_views where request_key = p_request_key;
  if result.id is not null then
    return result;
  end if;
  select id into previous_id
  from public.capture_views
  where capture_series_id = p_series_id and direction = p_direction and active
  for update;
  update public.capture_views set active = false
  where id = previous_id;
  insert into public.capture_views (
    capture_series_id, image_id, direction, algorithm_version, request_key, replaces_view_id
  ) values (
    p_series_id, p_image_id, p_direction, btrim(p_algorithm_version), p_request_key, previous_id
  )
  returning * into result;
  return result;
end;
$$;

create or replace function public.confirm_capture_series(
  p_series_id uuid
) returns public.capture_series
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.capture_series;
  active_valid integer;
begin
  select count(*) into active_valid
  from public.capture_views
  where capture_series_id = p_series_id
    and active
    and processing_status = 'provisional_ai';
  if active_valid <> 4 then
    raise exception 'La serie requiere cuatro vistas válidas.';
  end if;

  update public.annotation_sets
  set status = 'completed', completed_at = coalesce(completed_at, now())
  where id in (
    select annotation_set_id
    from public.capture_views
    where capture_series_id = p_series_id and active and annotation_set_id is not null
  );
  update public.capture_views
  set processing_status = 'confirmed'
  where capture_series_id = p_series_id and active;
  update public.capture_series
  set status = 'confirmed',
      review_status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, now())
  where id = p_series_id
    and valid_view_count = 4
    and pending_view_count = 0
  returning * into result;
  if result.id is null then
    raise exception 'La serie no está lista para confirmar.';
  end if;
  return result;
end;
$$;

revoke all on table public.capture_series from public, anon;
revoke all on table public.capture_views from public, anon;
revoke all on function public.get_or_create_capture_series(uuid, text, uuid, text) from public, anon;
revoke all on function public.register_capture_view(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.confirm_capture_series(uuid) from public, anon;

grant select, insert, update on public.capture_series to authenticated;
grant select, insert, update on public.capture_views to authenticated;
grant execute on function public.get_or_create_capture_series(uuid, text, uuid, text) to authenticated;
grant execute on function public.register_capture_view(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.confirm_capture_series(uuid) to authenticated;

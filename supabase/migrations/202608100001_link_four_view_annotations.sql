-- Additive integration of calibrated four-view capture, trunk sizing, annotations, and final metrics.

alter table public.capture_views
  add column if not exists rectified_width_px integer,
  add column if not exists rectified_height_px integer,
  add column if not exists valid_pixel_count bigint,
  add column if not exists cm2_per_pixel numeric,
  add column if not exists pixels_per_cm numeric,
  add column if not exists calibration_method text,
  add column if not exists confirmed_corners jsonb,
  add column if not exists excluded_area_cm2 numeric,
  add column if not exists trunk_width_cm numeric,
  add column if not exists trunk_width_min_cm numeric,
  add column if not exists trunk_width_max_cm numeric,
  add column if not exists trunk_left_x_normalized numeric,
  add column if not exists trunk_right_x_normalized numeric,
  add column if not exists trunk_scale_cm_per_pixel numeric,
  add column if not exists trunk_estimation_method text,
  add column if not exists trunk_confidence text,
  add column if not exists trunk_quality_flags jsonb not null default '[]'::jsonb;

alter table public.capture_series
  add column if not exists field_circumference_cm numeric,
  add column if not exists field_diameter_cm numeric,
  add column if not exists field_measurement_height_m numeric,
  add column if not exists trunk_estimated_width_cm numeric,
  add column if not exists trunk_estimated_circumference_cm numeric,
  add column if not exists trunk_estimate_min_cm numeric,
  add column if not exists trunk_estimate_max_cm numeric,
  add column if not exists trunk_confidence text,
  add column if not exists trunk_views_used text[] not null default '{}'::text[],
  add column if not exists trunk_geometric_assumption text,
  add column if not exists trunk_measurement_method text,
  add column if not exists trunk_algorithm_version text,
  add column if not exists trunk_quality_flags jsonb not null default '[]'::jsonb;

alter table public.annotation_sets
  add column if not exists capture_view_id uuid references public.capture_views(id) on delete cascade,
  add column if not exists target_storage_path text,
  add column if not exists target_width_px integer,
  add column if not exists target_height_px integer;

alter table public.annotation_regions drop constraint if exists annotation_regions_classification_allowed;
alter table public.annotation_regions add constraint annotation_regions_classification_allowed check (
  classification in ('lichen', 'bark', 'moss', 'algae', 'paint', 'damage', 'shadow', 'glare', 'unknown')
);

create unique index if not exists idx_annotation_sets_capture_view
  on public.annotation_sets(capture_view_id)
  where capture_view_id is not null;

alter table public.capture_series drop constraint if exists capture_series_status_allowed;
alter table public.capture_views drop constraint if exists capture_views_processing_status_allowed;

update public.capture_views
set rectified_width_px = coalesce(rectified_width_px, 400),
    rectified_height_px = coalesce(rectified_height_px, 2000),
    valid_pixel_count = coalesce(valid_pixel_count, 800000),
    cm2_per_pixel = coalesce(cm2_per_pixel, 500.0 / 800000.0),
    pixels_per_cm = coalesce(pixels_per_cm, 40),
    calibration_method = coalesce(calibration_method, 'legacy_four_view')
where rectified_storage_path is not null;

update public.annotation_sets annotation_set
set capture_view_id = view.id,
    target_storage_path = view.rectified_storage_path,
    target_width_px = view.rectified_width_px,
    target_height_px = view.rectified_height_px
from public.capture_views view
where view.annotation_set_id = annotation_set.id
  and annotation_set.capture_view_id is null
  and view.rectified_storage_path is not null;

update public.capture_series
set status = case
  when status = 'confirmed' then 'completed'
  when status = 'provisional_ai' then 'annotation_pending'
  when valid_view_count = 4 and pending_view_count = 0 then 'capture_calibrated'
  else 'capture_draft'
end;

update public.capture_views
set processing_status = case
  when processing_status = 'confirmed' then 'annotation_completed'
  when processing_status = 'provisional_ai' then 'annotation_pending'
  when rectified_storage_path is not null then 'calibrated'
  else processing_status
end;

alter table public.capture_series drop constraint if exists capture_series_status_allowed;
alter table public.capture_series alter column status set default 'capture_draft';
alter table public.capture_series add constraint capture_series_status_allowed check (
  status in (
    'capture_draft',
    'capture_calibrated',
    'annotation_pending',
    'annotation_in_progress',
    'annotation_completed',
    'analysis_ready',
    'completed'
  )
);
alter table public.capture_series drop constraint if exists capture_series_complete_requires_four_valid;
alter table public.capture_series add constraint capture_series_complete_requires_four_valid check (
  status not in ('capture_calibrated', 'annotation_pending', 'annotation_in_progress', 'annotation_completed', 'analysis_ready', 'completed')
  or (valid_view_count = 4 and pending_view_count = 0)
);
drop index if exists public.idx_capture_series_one_open_per_algorithm;
create unique index idx_capture_series_one_open_per_algorithm
  on public.capture_series(tree_sample_id, algorithm_version)
  where status <> 'completed';

alter table public.capture_views drop constraint if exists capture_views_processing_status_allowed;
alter table public.capture_views add constraint capture_views_processing_status_allowed check (
  processing_status in (
    'uploaded',
    'processing',
    'repeat_photo',
    'calibrated',
    'annotation_pending',
    'annotation_in_progress',
    'annotation_completed',
    'failed'
  )
);
alter table public.capture_views add constraint capture_views_rectified_dimensions_positive check (
  (rectified_width_px is null and rectified_height_px is null)
  or (rectified_width_px > 0 and rectified_height_px > 0)
);
alter table public.capture_views add constraint capture_views_valid_pixels_range check (
  valid_pixel_count is null
  or (
    valid_pixel_count > 0
    and rectified_width_px is not null
    and rectified_height_px is not null
    and valid_pixel_count <= rectified_width_px::bigint * rectified_height_px::bigint
  )
);
alter table public.capture_views add constraint capture_views_scale_positive check (
  (cm2_per_pixel is null or cm2_per_pixel > 0)
  and (pixels_per_cm is null or pixels_per_cm > 0)
  and (trunk_scale_cm_per_pixel is null or trunk_scale_cm_per_pixel > 0)
);
alter table public.capture_views add constraint capture_views_calibration_method_allowed check (
  calibration_method is null
  or calibration_method in ('automatic', 'manual_confirmed', 'manual_provisional', 'legacy_four_view')
);
alter table public.capture_views add constraint capture_views_confirmed_corners_array check (
  confirmed_corners is null
  or (jsonb_typeof(confirmed_corners) = 'array' and jsonb_array_length(confirmed_corners) = 4)
);
alter table public.capture_views add constraint capture_views_excluded_area_range check (
  excluded_area_cm2 is null or excluded_area_cm2 between 0 and 500
);
alter table public.capture_views add constraint capture_views_trunk_widths_valid check (
  (trunk_width_cm is null or trunk_width_cm > 0)
  and (trunk_width_min_cm is null or trunk_width_min_cm > 0)
  and (trunk_width_max_cm is null or trunk_width_max_cm > 0)
  and (trunk_width_min_cm is null or trunk_width_cm is null or trunk_width_min_cm <= trunk_width_cm)
  and (trunk_width_max_cm is null or trunk_width_cm is null or trunk_width_max_cm >= trunk_width_cm)
);
alter table public.capture_views add constraint capture_views_trunk_edges_valid check (
  (trunk_left_x_normalized is null and trunk_right_x_normalized is null)
  or (
    trunk_left_x_normalized between 0 and 1
    and trunk_right_x_normalized between 0 and 1
    and trunk_left_x_normalized < trunk_right_x_normalized
  )
);
alter table public.capture_views add constraint capture_views_trunk_method_allowed check (
  trunk_estimation_method is null
  or trunk_estimation_method in ('automatic', 'manual_corrected')
);
alter table public.capture_views add constraint capture_views_trunk_confidence_allowed check (
  trunk_confidence is null or trunk_confidence in ('low', 'medium', 'high')
);
alter table public.capture_views add constraint capture_views_trunk_quality_flags_array check (
  jsonb_typeof(trunk_quality_flags) = 'array'
);

alter table public.capture_series add constraint capture_series_field_measurement_positive check (
  (field_circumference_cm is null or field_circumference_cm > 0)
  and (field_diameter_cm is null or field_diameter_cm > 0)
  and (field_measurement_height_m is null or field_measurement_height_m > 0)
);
alter table public.capture_series add constraint capture_series_trunk_estimate_valid check (
  (trunk_estimated_width_cm is null or trunk_estimated_width_cm > 0)
  and (trunk_estimated_circumference_cm is null or trunk_estimated_circumference_cm > 0)
  and (trunk_estimate_min_cm is null or trunk_estimate_min_cm > 0)
  and (trunk_estimate_max_cm is null or trunk_estimate_max_cm > 0)
  and (
    trunk_estimate_min_cm is null
    or trunk_estimated_circumference_cm is null
    or trunk_estimate_min_cm <= trunk_estimated_circumference_cm
  )
  and (
    trunk_estimate_max_cm is null
    or trunk_estimated_circumference_cm is null
    or trunk_estimate_max_cm >= trunk_estimated_circumference_cm
  )
);
alter table public.capture_series add constraint capture_series_trunk_confidence_allowed check (
  trunk_confidence is null or trunk_confidence in ('low', 'medium', 'high')
);
alter table public.capture_series add constraint capture_series_trunk_method_allowed check (
  trunk_measurement_method is null
  or trunk_measurement_method in ('field_tape', 'frame_assisted_ai_estimate')
);
alter table public.capture_series add constraint capture_series_trunk_views_allowed check (
  trunk_views_used <@ array['N', 'E', 'S', 'W']::text[]
);
alter table public.capture_series add constraint capture_series_trunk_quality_flags_array check (
  jsonb_typeof(trunk_quality_flags) = 'array'
);

alter table public.annotation_sets add constraint annotation_sets_target_complete check (
  (capture_view_id is null and target_storage_path is null and target_width_px is null and target_height_px is null)
  or (
    capture_view_id is not null
    and target_storage_path is not null
    and btrim(target_storage_path) <> ''
    and target_width_px > 0
    and target_height_px > 0
  )
);

create or replace function public.validate_capture_annotation_target()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  target public.capture_views;
begin
  if new.capture_view_id is null then
    return new;
  end if;
  select * into target from public.capture_views where id = new.capture_view_id and active;
  if target.id is null
     or target.image_id <> new.image_id
     or target.rectified_storage_path is distinct from new.target_storage_path
     or target.rectified_width_px is distinct from new.target_width_px
     or target.rectified_height_px is distinct from new.target_height_px then
    raise exception 'El target de anotación no coincide con la vista rectificada.';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_capture_annotation_target on public.annotation_sets;
create trigger validate_capture_annotation_target
before insert or update of capture_view_id, image_id, target_storage_path, target_width_px, target_height_px
on public.annotation_sets
for each row execute function public.validate_capture_annotation_target();

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
    tree_sample_id, algorithm_version, request_key, template_version, status
  ) values (
    p_tree_sample_id, btrim(p_algorithm_version), p_request_key, btrim(p_template_version), 'capture_draft'
  )
  on conflict (tree_sample_id, algorithm_version)
    where status <> 'completed'
  do nothing
  returning * into result;

  if result.id is null then
    select * into result
    from public.capture_series
    where tree_sample_id = p_tree_sample_id
      and algorithm_version = btrim(p_algorithm_version)
      and status <> 'completed'
    order by created_at desc
    limit 1;
  end if;
  return result;
end;
$$;

create or replace function public.refresh_capture_series_metrics(
  p_series_id uuid
) returns public.capture_series
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.capture_series;
  completed_views integer;
  calibrated_views integer;
  lichen_area numeric;
  sampled_area numeric;
begin
  update public.capture_views view
  set processing_status = case
        when annotation.status = 'completed' and metrics.annotation_set_id is not null then 'annotation_completed'
        else 'annotation_in_progress'
      end,
      lichen_union_area_cm2 = case
        when annotation.status = 'completed' and metrics.lichen_union_area_pixels is not null
          then metrics.lichen_union_area_pixels * view.cm2_per_pixel
        else null
      end,
      lichen_coverage_percent = case
        when annotation.status = 'completed'
             and metrics.lichen_union_area_pixels is not null
             and view.valid_area_cm2 > 0
          then metrics.lichen_union_area_pixels * view.cm2_per_pixel / view.valid_area_cm2 * 100
        else null
      end,
      excluded_area_cm2 = case
        when annotation.status = 'completed' and metrics.lichen_outside_trunk_pixels is not null
          then metrics.lichen_outside_trunk_pixels * view.cm2_per_pixel
        else null
      end,
      component_count = case when annotation.status = 'completed' then metrics.lichen_region_count else null end,
      provisional_morphotype_richness = case when annotation.status = 'completed' then metrics.morphotype_count else null end,
      quality_flags = case
        when annotation.status = 'completed' then view.quality_flags || coalesce(metrics.quality_flags, '[]'::jsonb)
        else view.quality_flags
      end
  from public.annotation_sets annotation
  left join public.annotation_metrics metrics on metrics.annotation_set_id = annotation.id
  where view.capture_series_id = p_series_id
    and view.active
    and annotation.id = view.annotation_set_id;

  select
    count(*) filter (where rectified_storage_path is not null),
    count(*) filter (where processing_status = 'annotation_completed'),
    sum(lichen_union_area_cm2) filter (where processing_status = 'annotation_completed'),
    sum(valid_area_cm2) filter (where processing_status = 'annotation_completed')
  into calibrated_views, completed_views, lichen_area, sampled_area
  from public.capture_views
  where capture_series_id = p_series_id and active;

  update public.capture_series
  set valid_view_count = calibrated_views,
      pending_view_count = 4 - calibrated_views,
      status = case
        when completed_views = 4 then 'analysis_ready'
        when completed_views > 0 then 'annotation_in_progress'
        when calibrated_views = 4 then 'annotation_pending'
        else 'capture_draft'
      end,
      total_valid_area_cm2 = case when completed_views = 4 then sampled_area else calibrated_views * 500 end,
      total_lichen_area_cm2 = case when completed_views = 4 then lichen_area else null end,
      tree_lichen_coverage_percent = case
        when completed_views = 4 and sampled_area > 0 then lichen_area / sampled_area * 100
        else null
      end,
      occupied_cells = null,
      provisional_morphotype_richness = case
        when completed_views = 4 then (
          select coalesce(sum(provisional_morphotype_richness), 0)
          from public.capture_views
          where capture_series_id = p_series_id and active
        )
        else null
      end,
      calculated_at = case when completed_views = 4 then now() else null end
  where id = p_series_id
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
begin
  perform public.refresh_capture_series_metrics(p_series_id);
  update public.capture_series
  set status = 'completed',
      review_status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, now())
  where id = p_series_id and status = 'analysis_ready'
  returning * into result;
  if result.id is null then
    raise exception 'Las cuatro vistas deben estar anotadas antes de completar la evaluación.';
  end if;
  return result;
end;
$$;

revoke all on function public.validate_capture_annotation_target() from public, anon;
revoke all on function public.refresh_capture_series_metrics(uuid) from public, anon;
grant execute on function public.refresh_capture_series_metrics(uuid) to authenticated;
grant execute on function public.validate_capture_annotation_target() to authenticated;

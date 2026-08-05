alter table public.annotation_regions
  add column if not exists representative_color_hex text,
  add column if not exists color_tolerance_delta_e numeric,
  add column if not exists region_role text;

alter table public.annotation_regions
  drop constraint if exists annotation_regions_source_allowed;

alter table public.annotation_regions
  add constraint annotation_regions_source_allowed
  check (source in ('mobile_sam', 'manual', 'color_assisted'));

alter table public.annotation_regions
  drop constraint if exists annotation_regions_representative_color_hex_format;

alter table public.annotation_regions
  add constraint annotation_regions_representative_color_hex_format
  check (
    representative_color_hex is null
    or representative_color_hex ~ '^#[0-9A-Fa-f]{6}$'
  );

alter table public.annotation_regions
  drop constraint if exists annotation_regions_color_tolerance_non_negative,
  drop constraint if exists annotation_regions_color_tolerance_range;

alter table public.annotation_regions
  add constraint annotation_regions_color_tolerance_range
  check (
    color_tolerance_delta_e is null
    or color_tolerance_delta_e between 0 and 50
  );

alter table public.annotation_regions
  drop constraint if exists annotation_regions_region_role_allowed;

alter table public.annotation_regions
  add constraint annotation_regions_region_role_allowed
  check (region_role is null or region_role = 'trunk');

alter table public.annotation_regions
  drop constraint if exists annotation_regions_trunk_role_requires_bark;

alter table public.annotation_regions
  add constraint annotation_regions_trunk_role_requires_bark
  check (region_role is null or classification = 'bark');

create unique index if not exists idx_annotation_regions_one_accepted_trunk
  on public.annotation_regions(annotation_set_id)
  where region_role = 'trunk' and status = 'accepted';

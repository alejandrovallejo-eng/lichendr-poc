create table if not exists public.annotation_regions (
  id uuid primary key default gen_random_uuid(),
  annotation_set_id uuid not null references public.annotation_sets(id) on delete cascade,
  classification text not null,
  morphotype_id uuid,
  source text not null default 'mobile_sam',
  model_name text not null,
  model_version text,
  mask_bucket text not null default 'lichen-images',
  mask_path text not null,
  mask_width_px integer not null,
  mask_height_px integer not null,
  area_pixels bigint not null,
  score double precision,
  positive_points jsonb not null default '[]'::jsonb,
  negative_points jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annotation_regions_classification_allowed
    check (classification in ('lichen', 'bark', 'moss', 'algae', 'shadow', 'glare', 'unknown')),
  constraint annotation_regions_morphotype_requires_lichen
    check (morphotype_id is null or classification = 'lichen'),
  constraint annotation_regions_source_allowed check (source = 'mobile_sam'),
  constraint annotation_regions_model_name_not_blank check (btrim(model_name) <> ''),
  constraint annotation_regions_model_name_trimmed check (model_name = btrim(model_name)),
  constraint annotation_regions_mask_bucket_allowed check (mask_bucket = 'lichen-images'),
  constraint annotation_regions_mask_path_not_blank check (btrim(mask_path) <> ''),
  constraint annotation_regions_mask_path_trimmed check (mask_path = btrim(mask_path)),
  constraint annotation_regions_mask_path_unique unique (mask_path),
  constraint annotation_regions_mask_width_positive check (mask_width_px > 0),
  constraint annotation_regions_mask_height_positive check (mask_height_px > 0),
  constraint annotation_regions_area_pixels_positive check (area_pixels > 0),
  constraint annotation_regions_score_non_negative check (score is null or score >= 0),
  constraint annotation_regions_positive_points_array check (jsonb_typeof(positive_points) = 'array'),
  constraint annotation_regions_negative_points_array check (jsonb_typeof(negative_points) = 'array'),
  constraint annotation_regions_status_allowed check (status in ('draft', 'accepted', 'rejected')),
  constraint annotation_regions_morphotype_fk foreign key (morphotype_id, annotation_set_id)
    references public.morphotypes(id, annotation_set_id)
    on delete restrict
);

create index if not exists idx_annotation_regions_annotation_set_id
  on public.annotation_regions(annotation_set_id);
create index if not exists idx_annotation_regions_morphotype_id
  on public.annotation_regions(morphotype_id);
create index if not exists idx_annotation_regions_classification
  on public.annotation_regions(classification);

drop trigger if exists set_updated_at on public.annotation_regions;
create trigger set_updated_at
before update on public.annotation_regions
for each row execute function public.set_updated_at();

alter table public.annotation_regions enable row level security;

drop policy if exists annotation_regions_select_authenticated on public.annotation_regions;
create policy annotation_regions_select_authenticated on public.annotation_regions
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
      where a.id = public.annotation_regions.annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists annotation_regions_insert_authenticated on public.annotation_regions;
create policy annotation_regions_insert_authenticated on public.annotation_regions
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

drop policy if exists annotation_regions_update_authenticated on public.annotation_regions;
create policy annotation_regions_update_authenticated on public.annotation_regions
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
      where a.id = public.annotation_regions.annotation_set_id
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

drop policy if exists annotation_regions_delete_authenticated on public.annotation_regions;
create policy annotation_regions_delete_authenticated on public.annotation_regions
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
      where a.id = public.annotation_regions.annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.annotation_regions to authenticated;
grant execute on function public.set_updated_at() to authenticated;

create extension if not exists "pgcrypto";

create table if not exists public.annotation_sets (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null references public.images(id) on delete cascade,
  method text not null default 'systematic_point_count',
  status text not null default 'draft',
  version integer not null default 1,
  grid_rows integer not null default 10,
  grid_columns integer not null default 10,
  roi_x double precision,
  roi_y double precision,
  roi_width double precision,
  roi_height double precision,
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annotation_sets_method_allowed check (method = 'systematic_point_count'),
  constraint annotation_sets_status_allowed check (status in ('draft', 'completed')),
  constraint annotation_sets_version_positive check (version > 0),
  constraint annotation_sets_grid_rows_between_2_and_30 check (grid_rows between 2 and 30),
  constraint annotation_sets_grid_columns_between_2_and_30 check (grid_columns between 2 and 30),
  constraint annotation_sets_roi_all_or_none check (
    (roi_x is null and roi_y is null and roi_width is null and roi_height is null) or
    (roi_x is not null and roi_y is not null and roi_width is not null and roi_height is not null)
  ),
  constraint annotation_sets_roi_x_range check (roi_x is null or (roi_x >= 0 and roi_x <= 1)),
  constraint annotation_sets_roi_y_range check (roi_y is null or (roi_y >= 0 and roi_y <= 1)),
  constraint annotation_sets_roi_width_range check (roi_width is null or (roi_width > 0 and roi_width <= 1)),
  constraint annotation_sets_roi_height_range check (roi_height is null or (roi_height > 0 and roi_height <= 1)),
  constraint annotation_sets_roi_x_plus_width check (roi_x is null or roi_width is null or roi_x + roi_width <= 1),
  constraint annotation_sets_roi_y_plus_height check (roi_y is null or roi_height is null or roi_y + roi_height <= 1),
  constraint annotation_sets_image_id_version_unique unique (image_id, version)
);

create table if not exists public.morphotypes (
  id uuid primary key default gen_random_uuid(),
  annotation_set_id uuid not null references public.annotation_sets(id) on delete cascade,
  label text not null,
  growth_form text not null default 'unknown',
  color_hex text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint morphotypes_label_not_blank check (btrim(label) <> ''),
  constraint morphotypes_label_trimmed check (label = btrim(label)),
  constraint morphotypes_label_max_length check (char_length(label) <= 80),
  constraint morphotypes_growth_form_allowed check (growth_form in ('crustose', 'foliose', 'fruticose', 'squamulose', 'unknown')),
  constraint morphotypes_color_hex_format check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  constraint morphotypes_id_annotation_set_id_unique unique (id, annotation_set_id)
);

create unique index if not exists idx_morphotypes_annotation_set_label_lower
on public.morphotypes(annotation_set_id, lower(label));

create table if not exists public.annotation_points (
  id uuid primary key default gen_random_uuid(),
  annotation_set_id uuid not null references public.annotation_sets(id) on delete cascade,
  morphotype_id uuid,
  point_index integer not null,
  x_normalized double precision not null,
  y_normalized double precision not null,
  classification text not null default 'unknown',
  confidence_level text not null default 'medium',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annotation_points_point_index_positive check (point_index > 0),
  constraint annotation_points_x_normalized_range check (x_normalized >= 0 and x_normalized <= 1),
  constraint annotation_points_y_normalized_range check (y_normalized >= 0 and y_normalized <= 1),
  constraint annotation_points_classification_allowed check (classification in ('lichen', 'bark', 'moss', 'algae', 'shadow', 'glare', 'unknown')),
  constraint annotation_points_confidence_level_allowed check (confidence_level in ('low', 'medium', 'high')),
  constraint annotation_points_morphotype_requires_lichen check (morphotype_id is null or classification = 'lichen'),
  constraint annotation_points_annotation_set_id_point_index_unique unique (annotation_set_id, point_index),
  constraint annotation_points_morphotype_fk foreign key (morphotype_id, annotation_set_id)
    references public.morphotypes(id, annotation_set_id)
    on delete restrict
);

create index if not exists idx_annotation_sets_image_id on public.annotation_sets(image_id);
create index if not exists idx_annotation_sets_status on public.annotation_sets(status);
create index if not exists idx_annotation_sets_created_at_desc on public.annotation_sets(created_at desc);

create index if not exists idx_morphotypes_annotation_set_id on public.morphotypes(annotation_set_id);
create index if not exists idx_morphotypes_growth_form on public.morphotypes(growth_form);

create index if not exists idx_annotation_points_annotation_set_id on public.annotation_points(annotation_set_id);
create index if not exists idx_annotation_points_morphotype_id on public.annotation_points(morphotype_id);
create index if not exists idx_annotation_points_classification on public.annotation_points(classification);

drop trigger if exists set_updated_at on public.annotation_sets;
create trigger set_updated_at
before update on public.annotation_sets
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.morphotypes;
create trigger set_updated_at
before update on public.morphotypes
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.annotation_points;
create trigger set_updated_at
before update on public.annotation_points
for each row execute function public.set_updated_at();

alter table public.annotation_sets enable row level security;
alter table public.morphotypes enable row level security;
alter table public.annotation_points enable row level security;

drop policy if exists annotation_sets_select_authenticated on public.annotation_sets;
create policy annotation_sets_select_authenticated on public.annotation_sets
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.images i
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where i.id = public.annotation_sets.image_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists annotation_sets_insert_authenticated on public.annotation_sets;
create policy annotation_sets_insert_authenticated on public.annotation_sets
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.images i
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where i.id = image_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists annotation_sets_update_authenticated on public.annotation_sets;
create policy annotation_sets_update_authenticated on public.annotation_sets
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.images i
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where i.id = public.annotation_sets.image_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.images i
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where i.id = image_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists annotation_sets_delete_authenticated on public.annotation_sets;
create policy annotation_sets_delete_authenticated on public.annotation_sets
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.images i
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where i.id = public.annotation_sets.image_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists morphotypes_select_authenticated on public.morphotypes;
create policy morphotypes_select_authenticated on public.morphotypes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.annotation_sets as a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = public.morphotypes.annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists morphotypes_insert_authenticated on public.morphotypes;
create policy morphotypes_insert_authenticated on public.morphotypes
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.annotation_sets as a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists morphotypes_update_authenticated on public.morphotypes;
create policy morphotypes_update_authenticated on public.morphotypes
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.annotation_sets as a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = public.morphotypes.annotation_set_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.annotation_sets as a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists morphotypes_delete_authenticated on public.morphotypes;
create policy morphotypes_delete_authenticated on public.morphotypes
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.annotation_sets as a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = public.morphotypes.annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists annotation_points_select_authenticated on public.annotation_points;
create policy annotation_points_select_authenticated on public.annotation_points
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.annotation_sets as a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = public.annotation_points.annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists annotation_points_insert_authenticated on public.annotation_points;
create policy annotation_points_insert_authenticated on public.annotation_points
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.annotation_sets as a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists annotation_points_update_authenticated on public.annotation_points;
create policy annotation_points_update_authenticated on public.annotation_points
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.annotation_sets as a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = public.annotation_points.annotation_set_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.annotation_sets as a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists annotation_points_delete_authenticated on public.annotation_points;
create policy annotation_points_delete_authenticated on public.annotation_points
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.annotation_sets as a
      join public.images i on i.id = a.image_id
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where a.id = public.annotation_points.annotation_set_id
        and p.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.annotation_sets to authenticated;
grant select, insert, update, delete on public.morphotypes to authenticated;
grant select, insert, update, delete on public.annotation_points to authenticated;
grant execute on function public.set_updated_at() to authenticated;

create extension if not exists "pgcrypto";

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lichen-images',
  'lichen-images',
  false,
  20 * 1024 * 1024,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/tiff'
  ]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.images (
  id uuid primary key default gen_random_uuid(),
  tree_sample_id uuid not null references public.tree_samples(id) on delete cascade,
  storage_bucket text not null default 'lichen-images',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  file_size_bytes bigint not null,
  width_px integer,
  height_px integer,
  image_order integer not null default 1,
  caption text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint images_storage_bucket_allowed check (storage_bucket = 'lichen-images'),
  constraint images_storage_path_not_blank check (btrim(storage_path) <> ''),
  constraint images_storage_path_trimmed check (storage_path = btrim(storage_path)),
  constraint images_storage_path_unique unique (storage_path),
  constraint images_original_filename_not_blank check (btrim(original_filename) <> ''),
  constraint images_original_filename_trimmed check (original_filename = btrim(original_filename)),
  constraint images_original_filename_max_length check (char_length(original_filename) <= 255),
  constraint images_mime_type_allowed check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/tiff')),
  constraint images_file_size_positive check (file_size_bytes > 0),
  constraint images_file_size_max check (file_size_bytes <= 20 * 1024 * 1024),
  constraint images_width_positive check (width_px is null or width_px > 0),
  constraint images_height_positive check (height_px is null or height_px > 0),
  constraint images_image_order_positive check (image_order > 0)
);

create index if not exists idx_images_tree_sample_id on public.images(tree_sample_id);
create index if not exists idx_images_tree_sample_id_image_order on public.images(tree_sample_id, image_order);
create index if not exists idx_images_created_at_desc on public.images(created_at desc);

drop trigger if exists set_updated_at on public.images;
create trigger set_updated_at
before update on public.images
for each row
execute function public.set_updated_at();

alter table public.images enable row level security;

drop policy if exists images_select_authenticated on public.images;
create policy images_select_authenticated on public.images
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = public.images.tree_sample_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists images_insert_authenticated on public.images;
create policy images_insert_authenticated on public.images
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

drop policy if exists images_update_authenticated on public.images;
create policy images_update_authenticated on public.images
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = public.images.tree_sample_id
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

drop policy if exists images_delete_authenticated on public.images;
create policy images_delete_authenticated on public.images
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.tree_samples ts
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where ts.id = public.images.tree_sample_id
        and p.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.images to authenticated;

grant execute on function public.set_updated_at() to authenticated;

create table if not exists public.image_metadata (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null unique references public.images(id) on delete cascade,
  extraction_status text not null default 'pending',
  captured_at timestamptz,
  captured_at_local text,
  timezone_offset text,
  latitude double precision,
  longitude double precision,
  gps_accuracy_m double precision,
  location_source text not null default 'unknown',
  camera_make text,
  camera_model text,
  lens_model text,
  orientation smallint,
  focal_length_mm double precision,
  aperture_f_number double precision,
  exposure_time_seconds double precision,
  iso_speed integer,
  software text,
  raw_exif jsonb not null default '{}'::jsonb,
  extraction_error text,
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint image_metadata_extraction_status_allowed check (extraction_status in ('pending', 'extracted', 'partial', 'no_exif', 'failed')),
  constraint image_metadata_location_source_allowed check (location_source in ('unknown', 'exif', 'manual', 'gps')),
  constraint image_metadata_latitude_range check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint image_metadata_longitude_range check (longitude is null or (longitude >= -180 and longitude <= 180)),
  constraint image_metadata_lat_lon_both_null_or_present check (
    (latitude is null and longitude is null) or
    (latitude is not null and longitude is not null)
  ),
  constraint image_metadata_coordinates_require_location check (
    (location_source = 'unknown' and latitude is null and longitude is null) or
    (location_source in ('exif', 'manual', 'gps') and latitude is not null and longitude is not null)
  ),
  constraint image_metadata_gps_accuracy_non_negative check (gps_accuracy_m is null or gps_accuracy_m >= 0),
  constraint image_metadata_orientation_range check (orientation is null or (orientation >= 1 and orientation <= 8)),
  constraint image_metadata_focal_length_positive check (focal_length_mm is null or focal_length_mm > 0),
  constraint image_metadata_aperture_positive check (aperture_f_number is null or aperture_f_number > 0),
  constraint image_metadata_exposure_positive check (exposure_time_seconds is null or exposure_time_seconds > 0),
  constraint image_metadata_iso_positive check (iso_speed is null or iso_speed > 0)
);

create index if not exists idx_image_metadata_image_id on public.image_metadata(image_id);
create index if not exists idx_image_metadata_captured_at on public.image_metadata(captured_at);
create index if not exists idx_image_metadata_latitude_longitude on public.image_metadata(latitude, longitude);

drop trigger if exists set_updated_at on public.image_metadata;
create trigger set_updated_at
before update on public.image_metadata
for each row
execute function public.set_updated_at();

alter table public.image_metadata enable row level security;

drop policy if exists image_metadata_select_authenticated on public.image_metadata;
create policy image_metadata_select_authenticated on public.image_metadata
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.images i
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where i.id = public.image_metadata.image_id
        and p.owner_id = auth.uid()
    )
  );

drop policy if exists image_metadata_insert_authenticated on public.image_metadata;
create policy image_metadata_insert_authenticated on public.image_metadata
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

drop policy if exists image_metadata_update_authenticated on public.image_metadata;
create policy image_metadata_update_authenticated on public.image_metadata
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.images i
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where i.id = public.image_metadata.image_id
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

drop policy if exists image_metadata_delete_authenticated on public.image_metadata;
create policy image_metadata_delete_authenticated on public.image_metadata
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.images i
      join public.tree_samples ts on ts.id = i.tree_sample_id
      join public.sites s on s.id = ts.site_id
      join public.projects p on p.id = s.project_id
      where i.id = public.image_metadata.image_id
        and p.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.image_metadata to authenticated;

drop policy if exists lichen_images_storage_select_authenticated on storage.objects;
create policy lichen_images_storage_select_authenticated on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'lichen-images'
    and ((storage.foldername(name))[1]) = auth.uid()::text
  );

drop policy if exists lichen_images_storage_insert_authenticated on storage.objects;
create policy lichen_images_storage_insert_authenticated on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'lichen-images'
    and ((storage.foldername(name))[1]) = auth.uid()::text
  );

drop policy if exists lichen_images_storage_update_authenticated on storage.objects;
create policy lichen_images_storage_update_authenticated on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'lichen-images'
    and ((storage.foldername(name))[1]) = auth.uid()::text
  )
  with check (
    bucket_id = 'lichen-images'
    and ((storage.foldername(name))[1]) = auth.uid()::text
  );

drop policy if exists lichen_images_storage_delete_authenticated on storage.objects;
create policy lichen_images_storage_delete_authenticated on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'lichen-images'
    and ((storage.foldername(name))[1]) = auth.uid()::text
  );

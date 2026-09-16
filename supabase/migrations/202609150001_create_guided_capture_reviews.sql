-- Exploratory guided reviews are deliberately separate from calibrated metrics.
-- No existing policy, annotation, photograph or scientific status is changed.
begin;

create table public.guided_capture_reviews (
  image_id uuid primary key references public.images(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  tree_sample_id uuid not null references public.tree_samples(id) on delete cascade,
  direction text not null check (direction in ('N', 'E', 'S', 'W')),
  review jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint guided_review_bounded check (
    coalesce(jsonb_typeof(review) = 'object' and octet_length(review::text) <= 200000
    and review->>'version' = '1'
    and jsonb_typeof(review->'outline') = 'array'
    and jsonb_array_length(review->'outline') <= 64
    and jsonb_typeof(review->'config') = 'object'
    and jsonb_typeof(review->'config'->'samples') = 'array'
    and jsonb_array_length(review->'config'->'samples') <= 6, false)
  )
);

create index guided_capture_reviews_owner_sample
  on public.guided_capture_reviews(owner_id, tree_sample_id);
alter table public.guided_capture_reviews enable row level security;

create policy guided_reviews_read_own on public.guided_capture_reviews
for select to authenticated using (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.images i
    join public.tree_samples t on t.id = i.tree_sample_id
    join public.sites s on s.id = t.site_id
    join public.projects p on p.id = s.project_id
    where i.id = image_id and t.id = guided_capture_reviews.tree_sample_id
      and p.owner_id = (select auth.uid())
  )
);

create policy guided_reviews_insert_own_active on public.guided_capture_reviews
for insert to authenticated with check (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.capture_views v
    join public.capture_series c on c.id = v.capture_series_id
    join public.images i on i.id = v.image_id
    join public.tree_samples t on t.id = i.tree_sample_id
    join public.sites s on s.id = t.site_id
    join public.projects p on p.id = s.project_id
    where v.image_id = guided_capture_reviews.image_id and v.active
      and v.direction = guided_capture_reviews.direction
      and c.tree_sample_id = t.id and t.id = guided_capture_reviews.tree_sample_id
      and p.owner_id = (select auth.uid())
  )
);

create policy guided_reviews_update_own_active on public.guided_capture_reviews
for update to authenticated using (owner_id = (select auth.uid())) with check (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.capture_views v
    join public.capture_series c on c.id = v.capture_series_id
    join public.images i on i.id = v.image_id
    join public.tree_samples t on t.id = i.tree_sample_id
    join public.sites s on s.id = t.site_id
    join public.projects p on p.id = s.project_id
    where v.image_id = guided_capture_reviews.image_id and v.active
      and v.direction = guided_capture_reviews.direction
      and c.tree_sample_id = t.id and t.id = guided_capture_reviews.tree_sample_id
      and p.owner_id = (select auth.uid())
  )
);

revoke all on public.guided_capture_reviews from anon, authenticated;
grant select, insert, update on public.guided_capture_reviews to authenticated;

-- Compare-and-swap: a stale tab cannot silently replace a newer review.
-- Repeating an identical write after a lost response is idempotent.
create function public.save_guided_capture_review(
  p_image_id uuid, p_tree_sample_id uuid, p_direction text,
  p_review jsonb, p_expected_revision integer
) returns public.guided_capture_reviews
language plpgsql security invoker set search_path = '' as $$
declare
  written public.guided_capture_reviews;
begin
  if auth.uid() is null then
    raise exception 'guided_review_unauthorized' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0
    or p_review is null or jsonb_typeof(p_review) <> 'object'
    or octet_length(p_review::text) > 200000 then
    raise exception 'guided_review_invalid' using errcode = '22023';
  end if;
  if p_expected_revision = 0 then
    insert into public.guided_capture_reviews(image_id, owner_id, tree_sample_id, direction, review)
    values(p_image_id, auth.uid(), p_tree_sample_id, p_direction, p_review)
    on conflict (image_id) do nothing returning * into written;
  else
    update public.guided_capture_reviews set review = p_review,
      revision = revision + 1, updated_at = now()
    where image_id = p_image_id and owner_id = auth.uid()
      and tree_sample_id = p_tree_sample_id and direction = p_direction
      and revision = p_expected_revision
    returning * into written;
  end if;
  if written.image_id is not null then return written; end if;
  select * into written from public.guided_capture_reviews
    where image_id = p_image_id and owner_id = auth.uid()
      and tree_sample_id = p_tree_sample_id and direction = p_direction
      and review = p_review;
  if written.image_id is not null then return written; end if;
  raise exception 'guided_review_conflict' using errcode = '40001';
end;
$$;
revoke all on function public.save_guided_capture_review(uuid,uuid,text,jsonb,integer) from public, anon;
grant execute on function public.save_guided_capture_review(uuid,uuid,text,jsonb,integer) to authenticated;
commit;

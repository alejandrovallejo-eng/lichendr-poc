create extension if not exists "pgcrypto";

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  country_code text not null default 'DO',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_name_not_blank check (btrim(name) <> ''),
  constraint projects_name_trimmed check (name = btrim(name)),
  constraint projects_name_max_length check (char_length(name) <= 120),
  constraint projects_status_allowed check (status in ('active', 'archived'))
);

create index if not exists idx_projects_owner_id on public.projects(owner_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.projects;
create trigger set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

create policy if not exists projects_select_owner on public.projects
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy if not exists projects_insert_owner on public.projects
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy if not exists projects_update_owner on public.projects
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy if not exists projects_delete_owner on public.projects
  for delete
  to authenticated
  using (owner_id = auth.uid());

grant select, insert, update, delete on public.projects to authenticated;
grant execute on function public.set_updated_at() to authenticated;

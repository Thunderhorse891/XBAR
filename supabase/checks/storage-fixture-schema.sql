-- Disposable-database fixture for the storage policy checks. NEVER run this
-- against a real project: it creates stand-ins for Supabase's auth and storage
-- schemas.
--
-- It reproduces only what the storage migrations and checks touch: the auth
-- and storage objects RLS reads, the workspace tables the access functions
-- read, the two access functions themselves (as defined in
-- 20260605_harden_workspace_rls.sql), and the storage policies exactly as they
-- stood in production on 2026-10-01 (read from pg_policies), so the migrations
-- are exercised from the real starting state rather than an idealised one.
--
-- Used by .github/workflows/storage-database.yml:
--   fixture -> 20261001090000 (expand) -> 20261001090100 (contract)
--   -> supabase/checks/workspace-keyed-storage.sql

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end;
$roles$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz
);
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null,
  owner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;

create table if not exists public.workspaces (
  id uuid primary key,
  owner_user_id uuid not null references auth.users (id),
  workspace_key text not null default ''
);
create table if not exists public.workspace_profiles (workspace_id uuid primary key references public.workspaces (id));
create table if not exists public.workspace_subscription_profiles (
  workspace_id uuid primary key references public.workspaces (id),
  tier text not null default 'Starter',
  billing_state text not null default 'Inactive'
);
create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces (id),
  user_id uuid references auth.users (id),
  email text not null default '',
  role text not null default 'Owner',
  status text not null default 'invited',
  primary key (workspace_id, email)
);
create table if not exists public.horses (
  workspace_id uuid not null references public.workspaces (id),
  horse_id text not null,
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (workspace_id, horse_id)
);
create table if not exists public.shared_listings (
  workspace_id uuid not null references public.workspaces (id),
  listing_id text not null,
  horse_id text not null default '',
  share_path text not null default '',
  state text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, listing_id)
);
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants table privileges to `authenticated` and lets RLS decide;
-- the old gallery read policy queries horses as the caller, so it needs both.
grant select, insert, update, delete on all tables in schema public to authenticated;
alter table public.horses enable row level security;

create or replace function public.xbar_has_workspace_access(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_user_id = auth.uid()
  ) or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.xbar_can_manage_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_user_id = auth.uid()
  ) or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'Admin'
  );
$$;

revoke all on function public.xbar_has_workspace_access(uuid) from public;
revoke all on function public.xbar_can_manage_workspace(uuid) from public;
grant execute on function public.xbar_has_workspace_access(uuid) to authenticated;
grant execute on function public.xbar_can_manage_workspace(uuid) to authenticated;

create policy "horses workspace read" on public.horses for select to authenticated
  using (public.xbar_has_workspace_access(workspace_id));

-- Production storage policies as of 2026-10-01 -------------------------------

create policy "horse documents insert workspace" on storage.objects for insert to authenticated
  with check (bucket_id = 'horse-documents' and case
    when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.xbar_can_manage_workspace(split_part(name, '/', 1)::uuid) else false end);
create policy "horse documents read own" on storage.objects for select to authenticated
  using (bucket_id = 'horse-documents' and auth.uid()::text = split_part(name, '/', 1));
create policy "horse documents select workspace" on storage.objects for select to authenticated
  using (bucket_id = 'horse-documents' and case
    when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.xbar_has_workspace_access(split_part(name, '/', 1)::uuid) else false end);
create policy "horse documents update own" on storage.objects for update to authenticated
  using (bucket_id = 'horse-documents' and auth.uid()::text = split_part(name, '/', 1))
  with check (bucket_id = 'horse-documents' and auth.uid()::text = split_part(name, '/', 1));
create policy "horse documents update workspace" on storage.objects for update to authenticated
  using (bucket_id = 'horse-documents' and case
    when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.xbar_can_manage_workspace(split_part(name, '/', 1)::uuid) else false end)
  with check (bucket_id = 'horse-documents' and case
    when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.xbar_can_manage_workspace(split_part(name, '/', 1)::uuid) else false end);
create policy "horse documents upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'horse-documents' and auth.uid()::text = split_part(name, '/', 1));
create policy "horse media select workspace" on storage.objects for select to authenticated
  using (bucket_id = 'horse-media' and (
    auth.uid()::text = split_part(name, '/', 1)
    or exists (
      select 1 from public.horses h
      where public.xbar_has_workspace_access(h.workspace_id)
        and jsonb_typeof(h.payload -> 'gallery') = 'array'
        and exists (
          select 1 from jsonb_array_elements(h.payload -> 'gallery') g(asset)
          where g.asset ->> 'storagePath' = objects.name
        )
    )
  ));
create policy "horse media update own" on storage.objects for update to authenticated
  using (bucket_id = 'horse-media' and auth.uid()::text = split_part(name, '/', 1))
  with check (bucket_id = 'horse-media' and auth.uid()::text = split_part(name, '/', 1));
create policy "horse media upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'horse-media' and auth.uid()::text = split_part(name, '/', 1));

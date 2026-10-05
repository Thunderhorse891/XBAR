-- Isolated CI only. Never execute this bootstrap against a Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create table auth.users (
  id uuid primary key, email text unique, email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}', raw_app_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner uuid, metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

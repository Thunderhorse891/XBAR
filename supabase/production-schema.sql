create extension if not exists pgcrypto;

create table if not exists public.workspace_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_key text not null default 'primary',
  payload jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, workspace_key)
);

alter table public.workspace_snapshots enable row level security;

create policy if not exists "workspace snapshots select own"
on public.workspace_snapshots
for select
to authenticated
using (auth.uid() = user_id);

create policy if not exists "workspace snapshots insert own"
on public.workspace_snapshots
for insert
to authenticated
with check (auth.uid() = user_id);

create policy if not exists "workspace snapshots update own"
on public.workspace_snapshots
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('horse-media', 'horse-media', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('horse-documents', 'horse-documents', false)
on conflict (id) do nothing;

create policy if not exists "horse media upload own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'horse-media'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy if not exists "horse media update own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'horse-media'
  and auth.uid()::text = split_part(name, '/', 1)
)
with check (
  bucket_id = 'horse-media'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy if not exists "horse documents upload own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'horse-documents'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy if not exists "horse documents read own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'horse-documents'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy if not exists "horse documents update own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'horse-documents'
  and auth.uid()::text = split_part(name, '/', 1)
)
with check (
  bucket_id = 'horse-documents'
  and auth.uid()::text = split_part(name, '/', 1)
);

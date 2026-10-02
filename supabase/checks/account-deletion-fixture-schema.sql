-- Disposable test database only: minimal referenced tables, no production data.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users (id uuid primary key, email text);
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  workspace_key text not null default 'primary'
);
create table public.workspace_memberships (
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid, email text, role text, status text
);
create table public.workspace_invitations (
  workspace_id uuid references public.workspaces(id) on delete cascade, status text
);
create table public.workspace_billing_customers (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  checkout_lock_at timestamptz, checkout_lock_token text
);

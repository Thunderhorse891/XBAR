-- DISPOSABLE database only. Load storage-fixture-schema.sql first.
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'role')
$$;
grant execute on function auth.role() to anon,authenticated,service_role;
alter table public.workspace_subscription_profiles add column payload jsonb not null default '{}'::jsonb;
create table public.documents(workspace_id uuid,document_id text,size_bytes bigint not null default 0,payload jsonb not null default '{}');
create table public.sale_packets(workspace_id uuid,packet_id text,size_bytes bigint not null default 0);
create table public.workspace_invitations(workspace_id uuid,invitation_id text,email text,role text,status text);
grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
-- The tests exercise actual persisted access helpers and enforcement functions,
-- not test-only replacements for authorization/calculation logic.

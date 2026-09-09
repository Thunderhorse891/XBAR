-- Executable check for the private-share token fail-closed fix.
--
-- The static guards in tests/api/supabaseRpcSurface.test.mjs pin the shape of
-- the SQL; this runs it. Load against a throwaway PostgreSQL 16 database:
--
--     psql "$DATABASE_URL" -f supabase/checks/share-token-fail-closed.sql
--
-- It creates only the columns the two functions touch, so it does not need the
-- full production schema. Load the function definitions under test first --
-- either from supabase/production-schema.sql or from the migration -- then run
-- this file and read the four rows it prints.
--
-- Observed on PostgreSQL 16.13 with this repository's definitions:
--
--   before the fix                      after the fix
--   private, no token : RESOLVED (leak)  private, no token : refused
--   private, wrong    : refused          private, wrong    : refused
--   private, correct  : resolved         private, correct  : resolved
--   public link       : resolved         public link       : resolved
--
-- The last two rows are the controls: the fix must not close a legitimate
-- tokened listing or a Public Link, which is tokenless by design.

create schema if not exists public;
drop table if exists public.public_share_events, public.shared_listings, public.horses, public.documents, public.ownership_records cascade;
create table public.shared_listings (
  workspace_id uuid not null, listing_id text not null, horse_id text not null,
  share_path text not null default '', state text not null default '',
  access_mode text not null default 'Private Token', share_token text not null default '',
  payload jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(),
  primary key (workspace_id, listing_id));
create table public.horses (workspace_id uuid not null, horse_id text not null, payload jsonb not null default '{}'::jsonb);
create table public.ownership_records (workspace_id uuid not null, horse_id text not null, ownership_record_id text not null,
  transfer_status text default '', compliance_deadline text default '', payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now());
create table public.documents (workspace_id uuid not null, horse_id text not null, document_id text not null,
  title text default '', document_type text default '', source text default '', state text default 'Ready',
  confidence numeric default 0, duplicate_risk text default '', payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now());
create table public.public_share_events (workspace_id uuid not null, listing_id text, horse_id text, share_path text,
  event_type text, access_mode text, metadata jsonb);

insert into public.horses values ('11111111-1111-1111-1111-111111111111','h1','{"name":"Secret Horse"}'::jsonb);
-- The row the column defaults produce: Private Token, no token supplied.
insert into public.shared_listings (workspace_id, listing_id, horse_id, share_path, state, payload)
values ('11111111-1111-1111-1111-111111111111','l1','h1','/verify/leaky','Live','{}'::jsonb);
-- A correctly-tokened private listing, and a public link, as controls.
insert into public.shared_listings (workspace_id, listing_id, horse_id, share_path, state, share_token, payload)
values ('11111111-1111-1111-1111-111111111111','l2','h1','/verify/tokened','Live','s3cret','{}'::jsonb);
insert into public.shared_listings (workspace_id, listing_id, horse_id, share_path, state, access_mode, payload)
values ('11111111-1111-1111-1111-111111111111','l3','h1','/verify/public','Live','Public Link','{}'::jsonb);

select 'private, no token supplied : ' || case when public.xbar_resolve_public_listing('/verify/leaky', null) is null then 'refused' else 'RESOLVED -- LEAK' end as result
union all select 'private, wrong token       : ' || case when public.xbar_resolve_public_listing('/verify/tokened','nope') is null then 'refused' else 'RESOLVED -- LEAK' end
union all select 'private, correct token     : ' || case when public.xbar_resolve_public_listing('/verify/tokened','s3cret') is null then 'refused -- REGRESSION' else 'resolved (expected)' end
union all select 'public link, no token      : ' || case when public.xbar_resolve_public_listing('/verify/public', null) is null then 'refused -- REGRESSION' else 'resolved (expected)' end;

-- The tracker must not record a view it would not resolve.
select public.xbar_track_public_share_view('/verify/leaky', null);
select 'view events recorded for the untokened private listing: ' || count(*) as result from public.public_share_events;

import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
// Disposable in-memory PostgreSQL only. No production connection.
// Optional tool: PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node supabase/checks/run-distinct-free-tier.mjs
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const sql = (path) => readFileSync(new URL(path, root), 'utf8');
const db = new PGlite();
await db.exec(`create role authenticated;
create table workspace_subscription_profiles(workspace_id uuid primary key, tier text not null default 'Starter',billing_state text not null default 'Manual Billing',payload jsonb not null default '{}');
create table horses(workspace_id uuid,horse_id text,payload jsonb not null default '{}',primary key(workspace_id,horse_id));
create table documents(workspace_id uuid,document_id text,state text,payload jsonb not null default '{}',size_bytes bigint not null default 0 check(size_bytes>=0),primary key(workspace_id,document_id));
create table sale_packets(workspace_id uuid,packet_id text,payload jsonb not null default '{}',size_bytes bigint not null default 0 check(size_bytes>=0),primary key(workspace_id,packet_id));
create table shared_listings(workspace_id uuid,listing_id text,state text,payload jsonb not null default '{}',updated_at timestamptz default now(),published_at timestamptz,primary key(workspace_id,listing_id));
create table sales_leads(workspace_id uuid,lead_id text,payload jsonb not null default '{}',primary key(workspace_id,lead_id));
create table workspace_memberships(workspace_id uuid,email text,user_id uuid,role text,status text,unique(workspace_id,email));
create table workspace_invitations(workspace_id uuid,invitation_id text,email text,role text,status text,primary key(workspace_id,invitation_id));`);
await db.exec(sql('supabase/migrations/20260926000000_trial_dates_fail_closed.sql'));
if (process.argv.includes('--baseline')) {
  const oldHelpers = sql('supabase/migrations/20260924130000_trial_entitlement.sql');
  await db.exec(
    oldHelpers.slice(
      oldHelpers.indexOf('create or replace function public.xbar_subscription_limits'),
      oldHelpers.indexOf('-- Re-assert'),
    ),
  );
  const commercial = sql('supabase/migrations/20260611_commercial_entitlements.sql');
  await db.exec(
    commercial.slice(
      commercial.indexOf('create or replace function public.xbar_enforce_commercial_resource_limits'),
      commercial.indexOf('drop trigger if exists trg_horses'),
    ),
  );
  const storage = sql('supabase/migrations/20260724_storage_limit_enforcement.sql');
  await db.exec(
    storage.slice(
      storage.indexOf('create or replace function public.xbar_enforce_storage_limit'),
      storage.indexOf('drop trigger if exists trg_documents_enforce_storage'),
    ),
  );
  await db.exec(sql('supabase/migrations/20261002090000_seat_reservation_consumed_on_accept.sql'));
} else {
  await db.exec(sql('supabase/migrations/20261112120000_distinct_free_tier.sql'));
}
for (const table of ['horses', 'documents', 'sale_packets', 'shared_listings', 'sales_leads'])
  await db.exec(
    `create trigger enforce_commercial before insert or update on ${table} for each row execute function xbar_enforce_commercial_resource_limits();`,
  );
for (const table of ['documents', 'sale_packets'])
  await db.exec(
    `create trigger enforce_storage before insert or update on ${table} for each row execute function xbar_enforce_storage_limit();`,
  );
for (const table of ['workspace_memberships', 'workspace_invitations'])
  await db.exec(
    `create trigger enforce_seats before insert or update on ${table} for each row execute function xbar_enforce_workspace_seat_limits();`,
  );
await db.exec(sql('supabase/checks/distinct-free-tier.sql'));
console.log(
  'PASS: disposable PGlite Free tier matrix, quotas, trial boundary, above-cap edits/upserts and downgrade preservation. Concurrency and real RLS not tested.',
);
await db.close();

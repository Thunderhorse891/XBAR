-- Disposable-database fixture for the record-table policy checks. NEVER run
-- this against a real project. Run it AFTER storage-fixture-schema.sql, which
-- provides auth.users, the workspace tables and the two access functions.
--
-- It adds what the staff-write check touches: the record tables the app saves,
-- with the columns production has (read 2026-10-02), and production's existing
-- manager-only write and member read policies on them -- so the migration
-- under test is exercised against the real starting state.

alter table public.horses add column if not exists barn_name text not null default '';
alter table public.horses add column if not exists segment text not null default '';
alter table public.horses add column if not exists status text not null default '';
alter table public.horses add column if not exists registration_number text not null default '';
alter table public.horses add column if not exists owner_name text not null default '';
alter table public.horses add column if not exists breed text;
alter table public.horses add column if not exists color text;
alter table public.horses add column if not exists updated_at timestamptz not null default now();

alter table public.workspace_profiles add column if not exists ranch_name text not null default '';
alter table public.workspace_profiles add column if not exists payload jsonb not null default '{}'::jsonb;

create table if not exists public.documents (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  document_id text not null,
  horse_id text not null default '',
  title text not null default '',
  state text not null default '',
  payload jsonb not null default '{}'::jsonb,
  primary key (workspace_id, document_id)
);
create table if not exists public.intake_batches (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  intake_batch_id text not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (workspace_id, intake_batch_id)
);
create table if not exists public.ownership_records (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ownership_record_id text not null,
  horse_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  primary key (workspace_id, ownership_record_id)
);
create table if not exists public.expense_receipts (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  receipt_id text not null,
  horse_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  primary key (workspace_id, receipt_id)
);
create table if not exists public.ranch_assets (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  asset_id text not null,
  name text not null default '',
  payload jsonb not null default '{}'::jsonb,
  primary key (workspace_id, asset_id)
);
create table if not exists public.sales_leads (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id text not null,
  horse_id text not null default '',
  lead_name text not null default '',
  payload jsonb not null default '{}'::jsonb,
  primary key (workspace_id, lead_id)
);

grant select, insert, update, delete on all tables in schema public to authenticated;

do $policies$
declare
  record_table text;
begin
  foreach record_table in array array[
    'horses', 'documents', 'intake_batches', 'ownership_records',
    'expense_receipts', 'ranch_assets', 'sales_leads', 'shared_listings'
  ] loop
    execute format('alter table public.%I enable row level security', record_table);
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = record_table
        and policyname = record_table || ' workspace manage'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.xbar_can_manage_workspace(workspace_id)) with check (public.xbar_can_manage_workspace(workspace_id))',
        record_table || ' workspace manage', record_table
      );
    end if;
    if record_table <> 'horses' and not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = record_table
        and policyname = record_table || ' workspace read'
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.xbar_has_workspace_access(workspace_id))',
        record_table || ' workspace read', record_table
      );
    end if;
  end loop;
end;
$policies$;

alter table public.workspace_profiles enable row level security;
create policy "workspace profiles own workspace" on public.workspace_profiles
  for all to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_profiles.workspace_id and w.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.workspaces w where w.id = workspace_profiles.workspace_id and w.owner_user_id = auth.uid()));
create policy "workspace profiles select members" on public.workspace_profiles
  for select to authenticated
  using (public.xbar_has_workspace_access(workspace_id));

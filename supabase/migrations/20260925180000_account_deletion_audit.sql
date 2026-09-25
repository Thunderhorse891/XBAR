-- HELD: production requires Erin's reviewed rollout approval. Apply before the
-- matching account-delete handler; absence safely disables account deletion.
begin;
create table public.account_deletion_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  actor_user_id uuid not null,
  workspace_ids uuid[] not null default '{}',
  phase text not null check (phase in ('started','completed','failed')),
  created_at timestamptz not null default now()
);
-- No auth/workspace FK: deletion cascades must not erase these receipts.
alter table public.account_deletion_events enable row level security;
revoke all on public.account_deletion_events from public, anon, authenticated, service_role;
grant insert, select on public.account_deletion_events to service_role;
create index account_deletion_events_operation on public.account_deletion_events(operation_id,created_at);
comment on table public.account_deletion_events is
 'Minimal deletion receipts. Service-role append/read only. Retention and erasure require reviewed administrative action.';
commit;
-- Rollback: first restore the prior handler (losing durable auditing), archive
-- these receipts securely, then remove the table only with explicit approval.

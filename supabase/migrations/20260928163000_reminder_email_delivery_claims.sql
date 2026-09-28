begin;

-- Durable at-most-one email attempt per workspace/reminder/due date. A pending
-- row is deliberately not leased or automatically reclaimed: a crashed sender
-- may already have reached the provider. Only reconciled outcomes may be reset.
create table if not exists public.reminder_email_deliveries (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reminder_id text not null,
  due_date date not null,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (workspace_id, reminder_id, due_date)
);
alter table public.reminder_email_deliveries enable row level security;
revoke all on public.reminder_email_deliveries from public, anon, authenticated;
grant select, insert, update on public.reminder_email_deliveries to service_role;

commit;

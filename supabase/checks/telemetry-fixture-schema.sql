-- Isolated test database only. Copy of the production runtime event columns
-- and policies; run after storage-fixture-schema.sql supplies auth/workspaces.
create table public.runtime_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  channel text not null default 'web',
  severity text not null default 'info',
  event_name text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);
alter table public.runtime_events enable row level security;
grant select, insert on public.runtime_events to authenticated;
create policy "runtime events workspace read" on public.runtime_events
for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
create policy "runtime events workspace insert" on public.runtime_events
for insert to authenticated with check
(public.xbar_has_workspace_access(workspace_id) and (user_id is null or user_id = auth.uid()));

-- Historical synthetic events survive the migration with identity intact.
insert into public.runtime_events(id,event_name,payload,created_at) values
('eeeeeeee-0000-4000-8000-000000000001','navigation.page_view',
 '{"pathname":"/share/example?token=SYNTHETIC_OLD#code=SYNTHETIC_OLD","search":"?token=SYNTHETIC_OLD","nested":{"code":"SYNTHETIC_OLD"}}', '2026-01-01'),
('eeeeeeee-0000-4000-8000-000000000002','documents.saved','{"count":3}', '2026-01-02');

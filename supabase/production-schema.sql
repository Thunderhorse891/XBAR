create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  workspace_key text not null default 'primary',
  name text not null default 'Primary Ranch',
  business_name text not null default 'XBAR',
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, workspace_key)
);

create table if not exists public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'Owner',
  status text not null default 'active',
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, user_id)
);

create table if not exists public.workspace_profiles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  ranch_name text not null default 'Primary Ranch',
  business_name text not null default 'XBAR',
  default_owner_name text not null default '',
  default_owner_entity text not null default '',
  ranch_manager_name text not null default '',
  operations_email text not null default '',
  default_barn text not null default '',
  default_pasture text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.horses (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  horse_id text not null,
  name text not null,
  barn_name text not null default '',
  segment text not null default '',
  status text not null default '',
  registration_number text not null default '',
  owner_name text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, horse_id)
);

create table if not exists public.documents (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id text not null,
  horse_id text not null default '',
  title text not null,
  document_type text not null default '',
  source text not null default '',
  state text not null default '',
  confidence double precision not null default 0,
  duplicate_risk text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, document_id)
);

create table if not exists public.intake_batches (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  intake_batch_id text not null,
  label text not null,
  source text not null default '',
  state text not null default '',
  received_at text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, intake_batch_id)
);

create table if not exists public.ownership_records (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ownership_record_id text not null,
  horse_id text not null default '',
  legal_owner text not null default '',
  transfer_status text not null default '',
  compliance_deadline text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, ownership_record_id)
);

create table if not exists public.expense_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  receipt_id text not null,
  horse_id text not null default '',
  title text not null default '',
  category text not null default '',
  vendor text not null default '',
  amount double precision not null default 0,
  receipt_date text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, receipt_id)
);

create table if not exists public.ranch_assets (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  asset_id text not null,
  name text not null,
  category text not null default '',
  status text not null default '',
  location text not null default '',
  condition text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, asset_id)
);

create table if not exists public.sales_leads (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id text not null,
  horse_id text not null default '',
  lead_name text not null default '',
  channel text not null default '',
  stage text not null default '',
  last_touch text not null default '',
  next_follow_up text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, lead_id)
);

create table if not exists public.shared_listings (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  listing_id text not null,
  horse_id text not null default '',
  share_path text not null default '',
  state text not null default '',
  channels text[] not null default '{}'::text[],
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, listing_id)
);

create table if not exists public.workspace_subscription_profiles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  tier text not null default 'Starter',
  billing_state text not null default 'Manual Billing',
  monthly_rate double precision not null default 0,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_workspaces_owner_key on public.workspaces(owner_user_id, workspace_key);
create index if not exists idx_workspace_memberships_user on public.workspace_memberships(user_id);
create index if not exists idx_horses_workspace_status on public.horses(workspace_id, status);
create index if not exists idx_horses_workspace_registration on public.horses(workspace_id, registration_number);
create index if not exists idx_documents_workspace_horse on public.documents(workspace_id, horse_id);
create index if not exists idx_documents_workspace_state on public.documents(workspace_id, state);
create index if not exists idx_ownership_workspace_horse on public.ownership_records(workspace_id, horse_id);
create index if not exists idx_expense_receipts_workspace_horse on public.expense_receipts(workspace_id, horse_id);
create index if not exists idx_expense_receipts_workspace_date on public.expense_receipts(workspace_id, receipt_date);
create index if not exists idx_assets_workspace_status on public.ranch_assets(workspace_id, status);
create index if not exists idx_sales_workspace_stage on public.sales_leads(workspace_id, stage);
create index if not exists idx_shared_listings_workspace_state on public.shared_listings(workspace_id, state);

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.workspace_profiles enable row level security;
alter table public.horses enable row level security;
alter table public.documents enable row level security;
alter table public.intake_batches enable row level security;
alter table public.ownership_records enable row level security;
alter table public.expense_receipts enable row level security;
alter table public.ranch_assets enable row level security;
alter table public.sales_leads enable row level security;
alter table public.shared_listings enable row level security;
alter table public.workspace_subscription_profiles enable row level security;

create policy if not exists "workspaces select own"
on public.workspaces
for select
to authenticated
using (auth.uid() = owner_user_id);

create policy if not exists "workspaces insert own"
on public.workspaces
for insert
to authenticated
with check (auth.uid() = owner_user_id);

create policy if not exists "workspaces update own"
on public.workspaces
for update
to authenticated
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

create policy if not exists "workspace memberships select own or owner"
on public.workspace_memberships
for select
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "workspace memberships insert own or owner"
on public.workspace_memberships
for insert
to authenticated
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "workspace memberships update own or owner"
on public.workspace_memberships
for update
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "workspace profiles own workspace"
on public.workspace_profiles
for all
to authenticated
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "horses own workspace"
on public.horses
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = horses.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = horses.workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = horses.workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "documents own workspace"
on public.documents
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = documents.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = documents.workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = documents.workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "intake batches own workspace"
on public.intake_batches
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = intake_batches.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = intake_batches.workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = intake_batches.workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "ownership records own workspace"
on public.ownership_records
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = ownership_records.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = ownership_records.workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = ownership_records.workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "expense receipts own workspace"
on public.expense_receipts
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = expense_receipts.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = expense_receipts.workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = expense_receipts.workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "ranch assets own workspace"
on public.ranch_assets
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = ranch_assets.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = ranch_assets.workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = ranch_assets.workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "sales leads own workspace"
on public.sales_leads
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = sales_leads.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = sales_leads.workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = sales_leads.workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "shared listings own workspace"
on public.shared_listings
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = shared_listings.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = shared_listings.workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = shared_listings.workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "workspace subscription profiles own workspace"
on public.workspace_subscription_profiles
for all
to authenticated
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = auth.uid()
  )
);

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

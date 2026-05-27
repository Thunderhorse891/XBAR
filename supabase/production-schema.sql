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
  user_id uuid references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  role text not null default 'Owner',
  status text not null default 'active',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, user_id)
);

alter table if exists public.workspace_memberships alter column user_id drop not null;
alter table if exists public.workspace_memberships add column if not exists email text not null default '';
alter table if exists public.workspace_memberships add column if not exists display_name text not null default '';
alter table if exists public.workspace_memberships add column if not exists payload jsonb not null default '{}'::jsonb;

create unique index if not exists idx_workspace_memberships_workspace_email_unique on public.workspace_memberships(workspace_id, email);

create table if not exists public.workspace_invitations (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invitation_id text not null,
  email text not null,
  role text not null default 'Owner',
  status text not null default 'pending',
  invited_by_user_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, invitation_id)
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
create index if not exists idx_workspace_memberships_workspace_email on public.workspace_memberships(workspace_id, email);
create index if not exists idx_workspace_invitations_workspace_email on public.workspace_invitations(workspace_id, email);
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
alter table public.workspace_invitations enable row level security;
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

create policy if not exists "workspaces select active memberships"
on public.workspaces
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = workspaces.id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
);

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
    from public.workspace_memberships m
    where m.workspace_id = workspace_memberships.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "workspace invitations select own or workspace access"
on public.workspace_invitations
for select
to authenticated
using (
  lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_invitations.workspace_id
      and w.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = workspace_invitations.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
);

create policy if not exists "workspace invitations insert owner or admin"
on public.workspace_invitations
for insert
to authenticated
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_invitations.workspace_id
      and w.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = workspace_invitations.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'Admin'
  )
);

create policy if not exists "workspace invitations update owner admin or invitee"
on public.workspace_invitations
for update
to authenticated
using (
  lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_invitations.workspace_id
      and w.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = workspace_invitations.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'Admin'
  )
)
with check (
  lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_invitations.workspace_id
      and w.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = workspace_invitations.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'Admin'
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

create policy if not exists "workspace profiles select active memberships"
on public.workspace_profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = workspace_profiles.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
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

create policy if not exists "subscription profiles select active memberships"
on public.workspace_subscription_profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = workspace_subscription_profiles.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_subscription_profiles.workspace_id
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

alter table if exists public.shared_listings add column if not exists access_mode text not null default 'Private Token';
alter table if exists public.shared_listings add column if not exists share_token text not null default '';
alter table if exists public.shared_listings add column if not exists token_issued_at timestamptz not null default timezone('utc', now());
alter table if exists public.shared_listings add column if not exists published_at timestamptz;

create table if not exists public.document_processing_jobs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id text not null,
  document_id text not null default '',
  horse_id text not null default '',
  provider text not null default 'local-parser',
  status text not null default 'queued',
  extracted_text text not null default '',
  entities jsonb not null default '{}'::jsonb,
  processing_error text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, job_id)
);

create table if not exists public.public_share_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  listing_id text not null default '',
  horse_id text not null default '',
  share_path text not null default '',
  event_type text not null default 'view',
  access_mode text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  viewed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspace_billing_customers (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  stripe_customer_id text not null default '',
  stripe_subscription_id text not null default '',
  stripe_price_id text not null default '',
  seat_count integer not null default 0,
  entitlement_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspace_subscription_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  stripe_event_id text not null unique,
  event_type text not null default '',
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.runtime_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  channel text not null default 'web',
  severity text not null default 'info',
  event_name text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_document_processing_jobs_workspace_status on public.document_processing_jobs(workspace_id, status);
create index if not exists idx_public_share_events_workspace_listing on public.public_share_events(workspace_id, listing_id, viewed_at desc);
create index if not exists idx_runtime_events_workspace_created on public.runtime_events(workspace_id, created_at desc);

alter table public.document_processing_jobs enable row level security;
alter table public.public_share_events enable row level security;
alter table public.workspace_billing_customers enable row level security;
alter table public.workspace_subscription_events enable row level security;
alter table public.runtime_events enable row level security;

create policy if not exists "document processing jobs own workspace"
on public.document_processing_jobs
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = document_processing_jobs.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = document_processing_jobs.workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = document_processing_jobs.workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "public share events workspace read"
on public.public_share_events
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = public_share_events.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1
    from public.workspaces w
    where w.id = public_share_events.workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "workspace billing customers own workspace"
on public.workspace_billing_customers
for all
to authenticated
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_billing_customers.workspace_id
      and w.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_billing_customers.workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "workspace subscription events own workspace"
on public.workspace_subscription_events
for select
to authenticated
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_subscription_events.workspace_id
      and w.owner_user_id = auth.uid()
  )
);

create policy if not exists "runtime events own workspace"
on public.runtime_events
for all
to authenticated
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = runtime_events.workspace_id
      and w.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = runtime_events.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = runtime_events.workspace_id
      and w.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = runtime_events.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
);

create or replace function public.xbar_subscription_limits(p_workspace_id uuid)
returns table (
  seat_limit integer,
  shared_access_seat_limit integer,
  document_limit integer,
  storage_limit_gb integer
)
language sql
security definer
set search_path = public
as $$
  with subscription_row as (
    select
      tier,
      payload
    from public.workspace_subscription_profiles
    where workspace_id = p_workspace_id
    limit 1
  )
  select
    coalesce(((payload -> 'usage' ->> 'seatLimit')::integer),
      case tier
        when 'Enterprise' then 60
        when 'Ranch Ops' then 20
        when 'Professional' then 8
        else 2
      end
    ) as seat_limit,
    coalesce(((payload -> 'usage' ->> 'sharedAccessSeatLimit')::integer),
      case tier
        when 'Enterprise' then 200
        when 'Ranch Ops' then 40
        when 'Professional' then 10
        else 0
      end
    ) as shared_access_seat_limit,
    coalesce(((payload -> 'usage' ->> 'documentLimit')::integer),
      case tier
        when 'Enterprise' then 20000
        when 'Ranch Ops' then 6000
        when 'Professional' then 1800
        else 250
      end
    ) as document_limit,
    coalesce(((payload -> 'usage' ->> 'storageLimitGb')::integer),
      case tier
        when 'Enterprise' then 2500
        when 'Ranch Ops' then 750
        when 'Professional' then 200
        else 25
      end
    ) as storage_limit_gb
  from subscription_row
  union all
  select 2, 0, 250, 25
  where not exists (select 1 from subscription_row)
  limit 1
$$;

grant execute on function public.xbar_subscription_limits(uuid) to authenticated;

create or replace function public.xbar_enforce_workspace_seat_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  limits record;
  active_members integer;
  pending_invites integer;
  active_owners integer;
  pending_owner_invites integer;
  target_workspace_id uuid;
begin
  target_workspace_id := coalesce(new.workspace_id, old.workspace_id);
  select * into limits from public.xbar_subscription_limits(target_workspace_id);

  if TG_TABLE_NAME = 'workspace_invitations' then
    if lower(coalesce(new.status, 'pending')) = 'pending' then
      select count(*) into active_members
      from public.workspace_memberships
      where workspace_id = target_workspace_id
        and status = 'active';

      select count(*) into pending_invites
      from public.workspace_invitations
      where workspace_id = target_workspace_id
        and status = 'pending'
        and invitation_id <> coalesce(new.invitation_id, '');

      if active_members + pending_invites + 1 > limits.seat_limit then
        raise exception 'Seat limit reached for this workspace.';
      end if;

      if new.role = 'Owner' then
        select count(*) into active_owners
        from public.workspace_memberships
        where workspace_id = target_workspace_id
          and status = 'active'
          and role = 'Owner';

        select count(*) into pending_owner_invites
        from public.workspace_invitations
        where workspace_id = target_workspace_id
          and status = 'pending'
          and role = 'Owner'
          and invitation_id <> coalesce(new.invitation_id, '');

        if limits.shared_access_seat_limit <= 0 or active_owners + pending_owner_invites + 1 > limits.shared_access_seat_limit then
          raise exception 'Shared access seat limit reached for this workspace.';
        end if;
      end if;
    end if;
  elsif TG_TABLE_NAME = 'workspace_memberships' then
    if lower(coalesce(new.status, 'active')) = 'active' then
      select count(*) into active_members
      from public.workspace_memberships
      where workspace_id = target_workspace_id
        and status = 'active'
        and email <> coalesce(new.email, '');

      select count(*) into pending_invites
      from public.workspace_invitations
      where workspace_id = target_workspace_id
        and status = 'pending';

      if active_members + pending_invites + 1 > limits.seat_limit then
        raise exception 'Seat limit reached for this workspace.';
      end if;

      if new.role = 'Owner' then
        select count(*) into active_owners
        from public.workspace_memberships
        where workspace_id = target_workspace_id
          and status = 'active'
          and role = 'Owner'
          and email <> coalesce(new.email, '');

        select count(*) into pending_owner_invites
        from public.workspace_invitations
        where workspace_id = target_workspace_id
          and status = 'pending'
          and role = 'Owner';

        if limits.shared_access_seat_limit <= 0 or active_owners + pending_owner_invites + 1 > limits.shared_access_seat_limit then
          raise exception 'Shared access seat limit reached for this workspace.';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_workspace_invitations_enforce_limits on public.workspace_invitations;
create trigger trg_workspace_invitations_enforce_limits
before insert or update on public.workspace_invitations
for each row
execute function public.xbar_enforce_workspace_seat_limits();

drop trigger if exists trg_workspace_memberships_enforce_limits on public.workspace_memberships;
create trigger trg_workspace_memberships_enforce_limits
before insert or update on public.workspace_memberships
for each row
execute function public.xbar_enforce_workspace_seat_limits();

create or replace function public.xbar_resolve_public_listing(p_share_path text, p_share_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  listing_row record;
  horse_payload jsonb;
  ownership_payload jsonb;
  document_payloads jsonb;
begin
  select
    sl.workspace_id,
    sl.listing_id,
    sl.horse_id,
    sl.share_path,
    coalesce(nullif(sl.access_mode, ''), 'Private Token') as access_mode,
    coalesce(sl.share_token, '') as share_token,
    sl.state,
    case
      when jsonb_typeof(sl.payload) = 'object' then sl.payload
      else '{}'::jsonb
    end as payload
  into listing_row
  from public.shared_listings sl
  where sl.share_path = p_share_path
    and sl.state <> 'Archived'
  order by sl.updated_at desc
  limit 1;

  if not found then
    return null;
  end if;

  if listing_row.access_mode <> 'Public Link' and coalesce(p_share_token, '') <> listing_row.share_token then
    return null;
  end if;

  select
    (payload::jsonb
      - 'medicalNotes'
      - 'lastVetVisit'
      - 'ownership'
      - 'documentFacts'
      - 'alerts'
      - 'notes'
    )
    || jsonb_build_object(
      'medicalNotes', '',
      'lastVetVisit', '',
      'ownership', '[]'::jsonb,
      'documentFacts', '[]'::jsonb,
      'alerts', '[]'::jsonb,
      'notes', '[]'::jsonb
    )
  into horse_payload
  from public.horses
  where workspace_id = listing_row.workspace_id
    and horse_id = listing_row.horse_id
  limit 1;

  if horse_payload is null then
    return null;
  end if;

  select jsonb_build_object(
    'id', ownership_record_id,
    'horseId', horse_id,
    'legalOwner', '',
    'transferStatus', coalesce(nullif(transfer_status, ''), payload::jsonb ->> 'transferStatus', 'Pending Signatures'),
    'pendingDocuments', '[]'::jsonb,
    'complianceDeadline', coalesce(nullif(compliance_deadline, ''), payload::jsonb ->> 'complianceDeadline', ''),
    'confidence', coalesce((payload::jsonb ->> 'confidence')::numeric, 0),
    'auditTrail', '[]'::jsonb
  ) into ownership_payload
  from public.ownership_records
  where workspace_id = listing_row.workspace_id
    and horse_id = listing_row.horse_id
  order by updated_at desc
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', document_id,
        'title', coalesce(nullif(title, ''), payload::jsonb ->> 'title', ''),
        'type', coalesce(nullif(document_type, ''), payload::jsonb ->> 'type', 'Media Kit'),
        'horseId', horse_id,
        'uploadedBy', '',
        'uploadedAt', coalesce(payload::jsonb ->> 'uploadedAt', ''),
        'source', coalesce(nullif(source, ''), payload::jsonb ->> 'source', 'Manual Upload'),
        'state', coalesce(nullif(state, ''), payload::jsonb ->> 'state', 'Ready'),
        'confidence', confidence,
        'duplicateRisk', coalesce(nullif(duplicate_risk, ''), payload::jsonb ->> 'duplicateRisk', 'Low'),
        'extractedTextPreview', '',
        'summary', coalesce(payload::jsonb ->> 'summary', ''),
        'entities', coalesce(payload::jsonb -> 'entities', '{}'::jsonb),
        'fileName', payload::jsonb ->> 'fileName',
        'mimeType', payload::jsonb ->> 'mimeType',
        'fileSizeBytes', payload::jsonb -> 'fileSizeBytes'
      )
      order by updated_at desc
    ),
    '[]'::jsonb
  ) into document_payloads
  from public.documents
  where workspace_id = listing_row.workspace_id
    and horse_id = listing_row.horse_id
    and state = 'Ready';

  return jsonb_build_object(
    'horse', horse_payload,
    'documents', coalesce(document_payloads, '[]'::jsonb),
    'ownershipRecord', ownership_payload,
    'sharedListing',
      listing_row.payload
      || jsonb_build_object(
        'id', listing_row.listing_id,
        'horseId', listing_row.horse_id,
        'sharePath', listing_row.share_path,
        'accessMode', listing_row.access_mode,
        'shareToken', case when listing_row.access_mode = 'Private Token' then listing_row.share_token else '' end,
        'state', listing_row.state
      )
  );
end;
$$;

grant execute on function public.xbar_resolve_public_listing(text, text) to anon, authenticated;

create or replace function public.xbar_track_public_share_view(p_share_path text, p_share_token text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  listing_row record;
begin
  select
    sl.workspace_id,
    sl.listing_id,
    sl.horse_id,
    coalesce(nullif(sl.access_mode, ''), 'Private Token') as access_mode,
    coalesce(sl.share_token, '') as share_token
  into listing_row
  from public.shared_listings sl
  where sl.share_path = p_share_path
    and sl.state <> 'Archived'
  order by sl.updated_at desc
  limit 1;

  if not found then
    return;
  end if;

  if listing_row.access_mode <> 'Public Link' and coalesce(p_share_token, '') <> listing_row.share_token then
    return;
  end if;

  insert into public.public_share_events (
    workspace_id,
    listing_id,
    horse_id,
    share_path,
    event_type,
    access_mode,
    metadata
  ) values (
    listing_row.workspace_id,
    listing_row.listing_id,
    listing_row.horse_id,
    p_share_path,
    'view',
    listing_row.access_mode,
    jsonb_build_object('trackedAt', timezone('utc', now()))
  );
end;
$$;

grant execute on function public.xbar_track_public_share_view(text, text) to anon, authenticated;

create policy if not exists "shared listings write owner admin"
on public.shared_listings
for all
to authenticated
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = shared_listings.workspace_id
      and w.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = shared_listings.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'Admin'
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = shared_listings.workspace_id
      and w.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = shared_listings.workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'Admin'
  )
);

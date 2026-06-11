-- OCR ingestion -> horse profile -> sale packet pipeline.
-- Apply after production-schema.sql and 20260605_harden_workspace_rls.sql.
-- This migration is idempotent.

-- ---------------------------------------------------------------------------
-- 1. Horse identity fields populated by the OCR pipeline
-- ---------------------------------------------------------------------------
alter table if exists public.horses add column if not exists breed text not null default '';
alter table if exists public.horses add column if not exists color text not null default '';
alter table if exists public.horses add column if not exists birthdate text not null default '';
alter table if exists public.horses add column if not exists gender text not null default '';
alter table if exists public.horses add column if not exists microchip text not null default '';
alter table if exists public.horses add column if not exists registry text not null default '';
alter table if exists public.horses add column if not exists created_from_document_id text not null default '';
alter table if exists public.horses add column if not exists ocr_confidence double precision not null default 0;

create index if not exists idx_horses_workspace_microchip on public.horses(workspace_id, microchip);

-- ---------------------------------------------------------------------------
-- 2. Document OCR / extraction columns
-- ---------------------------------------------------------------------------
alter table if exists public.documents add column if not exists original_filename text not null default '';
alter table if exists public.documents add column if not exists storage_path text not null default '';
alter table if exists public.documents add column if not exists mime_type text not null default '';
alter table if exists public.documents add column if not exists ocr_text text not null default '';
alter table if exists public.documents add column if not exists ocr_confidence_map jsonb not null default '{}'::jsonb;
alter table if exists public.documents add column if not exists extracted_data jsonb not null default '{}'::jsonb;
alter table if exists public.documents add column if not exists needs_review boolean not null default false;
alter table if exists public.documents add column if not exists review_notes text not null default '';
alter table if exists public.documents add column if not exists intake_batch_id text not null default '';
alter table if exists public.documents add column if not exists uploaded_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_documents_workspace_needs_review on public.documents(workspace_id, needs_review);
create index if not exists idx_documents_workspace_batch on public.documents(workspace_id, intake_batch_id);

-- ---------------------------------------------------------------------------
-- 3. Document template catalog (tier-gated, pre-filled forms)
--    template_content is an optional per-deployment HTML override; when empty
--    the API renders the built-in template from api/_lib/document-templates.js.
-- ---------------------------------------------------------------------------
create table if not exists public.document_templates (
  id text primary key,
  name text not null,
  tier text not null default 'Basic',
  minimum_plan text not null default 'Starter',
  purpose text not null default '',
  template_content text not null default '',
  placeholders_schema jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.document_templates enable row level security;

drop policy if exists "document templates read" on public.document_templates;
create policy "document templates read"
on public.document_templates
for select
to authenticated
using (true);

-- ---------------------------------------------------------------------------
-- 4. Sale packets
-- ---------------------------------------------------------------------------
create table if not exists public.sale_packets (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  packet_id text not null,
  horse_id text not null default '',
  created_by_user_id uuid references auth.users(id) on delete set null,
  packet_pdf_path text not null default '',
  watermark_text text not null default '',
  shared_with_email text not null default '',
  document_ids jsonb not null default '[]'::jsonb,
  status text not null default 'ready',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, packet_id)
);

create index if not exists idx_sale_packets_workspace_horse on public.sale_packets(workspace_id, horse_id);

alter table public.sale_packets enable row level security;

drop policy if exists "sale packets workspace read" on public.sale_packets;
create policy "sale packets workspace read" on public.sale_packets for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
drop policy if exists "sale packets workspace manage" on public.sale_packets;
create policy "sale packets workspace manage" on public.sale_packets for all to authenticated using (public.xbar_can_manage_workspace(workspace_id)) with check (public.xbar_can_manage_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- 5. Reminders + notifications (Coggins, vaccination, deworming, farrier)
-- ---------------------------------------------------------------------------
create table if not exists public.reminders (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reminder_id text not null,
  horse_id text not null default '',
  type text not null default 'coggins',
  due_date date not null,
  notification_sent boolean not null default false,
  source_document_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, reminder_id)
);

create index if not exists idx_reminders_pending_due on public.reminders(due_date) where notification_sent = false;
create index if not exists idx_reminders_workspace_horse on public.reminders(workspace_id, horse_id);

alter table public.reminders enable row level security;

drop policy if exists "reminders workspace read" on public.reminders;
create policy "reminders workspace read" on public.reminders for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
drop policy if exists "reminders workspace manage" on public.reminders;
create policy "reminders workspace manage" on public.reminders for all to authenticated using (public.xbar_can_manage_workspace(workspace_id)) with check (public.xbar_can_manage_workspace(workspace_id));

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  reminder_id text not null default '',
  title text not null default '',
  body text not null default '',
  channel text not null default 'in-app',
  read boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_notifications_workspace_created on public.notifications(workspace_id, created_at desc);
create index if not exists idx_notifications_user_unread on public.notifications(user_id) where read = false;

alter table public.notifications enable row level security;

drop policy if exists "notifications read own or workspace" on public.notifications;
create policy "notifications read own or workspace"
on public.notifications
for select
to authenticated
using (user_id = auth.uid() or public.xbar_has_workspace_access(workspace_id));

drop policy if exists "notifications mark read" on public.notifications;
create policy "notifications mark read"
on public.notifications
for update
to authenticated
using (user_id = auth.uid() or public.xbar_can_manage_workspace(workspace_id))
with check (user_id = auth.uid() or public.xbar_can_manage_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- 6. Per-horse vet access grants
-- ---------------------------------------------------------------------------
create table if not exists public.horse_vet_access (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  horse_id text not null,
  vet_user_id uuid not null references auth.users(id) on delete cascade,
  granted_by_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'active',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, horse_id, vet_user_id)
);

alter table public.horse_vet_access enable row level security;

drop policy if exists "horse vet access read" on public.horse_vet_access;
create policy "horse vet access read"
on public.horse_vet_access
for select
to authenticated
using (vet_user_id = auth.uid() or public.xbar_has_workspace_access(workspace_id));

drop policy if exists "horse vet access manage" on public.horse_vet_access;
create policy "horse vet access manage"
on public.horse_vet_access
for all
to authenticated
using (public.xbar_can_manage_workspace(workspace_id))
with check (public.xbar_can_manage_workspace(workspace_id));

-- Vets with an active grant may read the granted horse and its documents.
drop policy if exists "horses vet grant read" on public.horses;
create policy "horses vet grant read"
on public.horses
for select
to authenticated
using (
  exists (
    select 1 from public.horse_vet_access v
    where v.workspace_id = horses.workspace_id
      and v.horse_id = horses.horse_id
      and v.vet_user_id = auth.uid()
      and v.status = 'active'
  )
);

drop policy if exists "documents vet grant read" on public.documents;
create policy "documents vet grant read"
on public.documents
for select
to authenticated
using (
  exists (
    select 1 from public.horse_vet_access v
    where v.workspace_id = documents.workspace_id
      and v.horse_id = documents.horse_id
      and v.vet_user_id = auth.uid()
      and v.status = 'active'
  )
);

-- ---------------------------------------------------------------------------
-- 7. Audit log (who viewed / edited / generated what)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null default '',
  entity_id text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_audit_logs_workspace_created on public.audit_logs(workspace_id, created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs(workspace_id, entity_type, entity_id);

alter table public.audit_logs enable row level security;

drop policy if exists "audit logs workspace read" on public.audit_logs;
create policy "audit logs workspace read" on public.audit_logs for select to authenticated using (public.xbar_can_manage_workspace(workspace_id));
drop policy if exists "audit logs workspace insert" on public.audit_logs;
create policy "audit logs workspace insert" on public.audit_logs for insert to authenticated with check (public.xbar_has_workspace_access(workspace_id) and actor_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. Private bucket for assembled sale packets (service-role access only;
--    clients receive 1-hour signed URLs from the API).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('sale-packets', 'sale-packets', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Seed the template catalog (content rendered by the API; the
--    template_content column stays empty unless a deployment overrides it).
-- ---------------------------------------------------------------------------
insert into public.document_templates (id, name, tier, minimum_plan, purpose, placeholders_schema) values
  ('bill-of-sale', 'Bill of Sale / Purchase Agreement', 'Basic', 'Starter', 'Horse sale terms, purchase price, seller, buyer, horse identity, and transfer details.', '{"placeholders":["horse.name","horse.registrationNumber","horse.registry","horse.breed","horse.color","horse.birthdate","horse.gender","horse.microchip","owner.name","workspace.businessName","buyer.name","sale.price","today_date"]}'::jsonb),
  ('boarding-agreement', 'Standard Boarding Agreement', 'Basic', 'Starter', 'Stabling terms, care responsibilities, fees, emergency contact, and barn policies.', '{"placeholders":["horse.name","owner.name","workspace.businessName","boarding.monthlyRate","boarding.startDate","today_date"]}'::jsonb),
  ('lease-agreement', 'Lessee & Lease Agreement', 'Basic', 'Starter', 'Lease duration, permitted use, payment terms, care duties, and return conditions.', '{"placeholders":["horse.name","owner.name","lease.lesseeName","lease.startDate","lease.endDate","lease.monthlyFee","today_date"]}'::jsonb),
  ('veterinary-care-log', 'Veterinary Care Log', 'Basic', 'Starter', 'Vet visits, diagnoses, treatment notes, medication history, and follow-up dates.', '{"placeholders":["horse.name","horse.registrationNumber","owner.name","vet.name","today_date"]}'::jsonb),
  ('coggins-health-certificate', 'Coggins & Health Certificate Form', 'Basic', 'Starter', 'Pre-filled horse and owner fields for annual testing and travel health paperwork.', '{"placeholders":["horse.name","horse.registrationNumber","horse.breed","horse.color","horse.birthdate","horse.gender","horse.microchip","owner.name","health.lastCogginsDate","health.nextCogginsDue","today_date"]}'::jsonb),
  ('breeding-contract', 'Breeding Contract', 'Pro', 'Professional', 'Mare owner, stallion owner, stud fee, live foal guarantee, breeding method, and rebreed terms.', '{"placeholders":["horse.name","horse.registrationNumber","owner.name","breeding.stallionName","breeding.studFee","today_date"]}'::jsonb),
  ('training-agreement', 'Training Agreement', 'Pro', 'Professional', 'Training scope, fees, show goals, liability terms, client responsibilities, and care permissions.', '{"placeholders":["horse.name","owner.name","workspace.businessName","training.monthlyFee","training.startDate","today_date"]}'::jsonb),
  ('foaling-mare-record', 'Foaling & Mare Record', 'Pro', 'Professional', 'Cycle notes, breeding dates, pregnancy checks, foaling observations, and birth record.', '{"placeholders":["horse.name","horse.registrationNumber","owner.name","today_date"]}'::jsonb),
  ('sales-packet', 'Sales Packet', 'Pro', 'Professional', 'Branded buyer-ready packet with horse profile, sale details, ownership, medical, Coggins, and verified documents.', '{"placeholders":["horse.name","horse.registrationNumber","horse.breed","horse.color","horse.birthdate","owner.name","workspace.businessName","buyer.name","health.lastCogginsDate","today_date"]}'::jsonb),
  ('client-onboarding', 'Client Onboarding Form', 'Pro', 'Professional', 'New client intake, emergency contacts, horse details, care instructions, and service expectations.', '{"placeholders":["workspace.businessName","client.name","horse.name","today_date"]}'::jsonb),
  ('professional-services-agreement', 'Professional Services Agreement', 'Business', 'Ranch Ops', 'Farrier, vet, bodyworker, clinician, or contractor service terms for a barn operation.', '{"placeholders":["workspace.businessName","provider.name","provider.service","today_date"]}'::jsonb),
  ('release-liability-waiver', 'Release of Liability & Waiver', 'Business', 'Ranch Ops', 'Lesson, training, handling, boarding, clinic, and visitor risk acknowledgement workflow.', '{"placeholders":["workspace.businessName","participant.name","today_date"]}'::jsonb),
  ('multi-owner-transfer', 'Multi-Owner Transfer Forms', 'Business', 'Ranch Ops', 'Shared ownership, syndicate, co-owner, managing partner, and percentage transfer details.', '{"placeholders":["horse.name","horse.registrationNumber","owner.name","transfer.newOwnerName","transfer.percentage","today_date"]}'::jsonb),
  ('branded-barn-asset-pack', 'Branded Barn Asset Pack', 'Business', 'Ranch Ops', 'Boarding agreements, emergency protocols, insurance references, and barn policy packet.', '{"placeholders":["workspace.businessName","workspace.ranchName","today_date"]}'::jsonb),
  ('vet-invoice-payment-plan', 'Vet Invoice & Payment Plan Templates', 'Business', 'Ranch Ops', 'Procedure invoice structure, payment schedule, responsible party, and care ledger attachment.', '{"placeholders":["horse.name","owner.name","vet.name","invoice.total","today_date"]}'::jsonb)
on conflict (id) do update set
  name = excluded.name,
  tier = excluded.tier,
  minimum_plan = excluded.minimum_plan,
  purpose = excluded.purpose,
  placeholders_schema = excluded.placeholders_schema,
  updated_at = timezone('utc', now());

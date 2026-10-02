-- Staff saves reach the cloud, scoped to what each role may do (audit F04).
--
-- The product's role matrix (src/lib/permissions.ts, and in SQL
-- xbar_has_workspace_capability) lets a Medical Lead add a treatment, a Sales
-- Lead work a lead, a Ranch Manager log an asset. Every write policy on the
-- record tables, though, required xbar_can_manage_workspace -- owner or Admin.
-- So the app said "Medical event added", kept it on that device, and the
-- cloud refused the save: nobody else ever saw it.
--
-- Worse, the ranch profile is upserted on every save and its only write policy
-- is OWNER-only, so even an invited Admin's saves were refused.
--
-- This adds write policies that follow the capability matrix, table by table,
-- next to the existing manager policies (permissive policies OR together, so
-- owners and Admins are unaffected). Nothing is dropped.
--
--   horses             insert: createHorse
--                      update: editHorse, manageMedical, uploadDocuments,
--                              reviewDocuments, uploadMedia, createHorse
--                      delete: createHorse
--   documents,
--   intake_batches     insert/update: uploadDocuments, reviewDocuments, createHorse
--   ownership_records  insert: createHorse, manageOwnership; update: manageOwnership
--   expense_receipts   insert/update: manageAssets; delete: createHorse
--   ranch_assets       insert/update/delete: manageAssets
--   sales_leads        insert/update: manageSales; delete: createHorse
--   shared_listings    insert/update: manageSharedAccess
--   workspace_profiles all: owner or Admin (xbar_can_manage_workspace)
--
-- Two details carry the weight:
--
--   * Saves are upserts, and Postgres checks an upsert's row against the
--     INSERT policy even when it ends up updating an existing row. A Medical
--     Lead may update horses but not create them, so the horse INSERT policy
--     also admits a row that ALREADY EXISTS for a role that may update it
--     (xbar_record_exists). A genuinely new horse still needs createHorse.
--
--   * Medical Lead is the one staff role that may touch horses without
--     editHorse. A row-level policy cannot say which fields changed, so a
--     trigger does: for a caller without editHorse (and not a manager), only
--     the medical and document fields may change, the status only to
--     "Medical Review", and the sale block only in its derived flags.
--
-- Deleting a horse (with the sale leads and receipts it cascades to) needs
-- createHorse -- Admin and Ranch Manager -- matching the store action.

create or replace function public.xbar_record_exists(p_table text, p_workspace_id uuid, p_record_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found boolean := false;
begin
  -- Only within a workspace the caller can already read: this answers
  -- "does this id exist here", never for someone else's ranch.
  if not public.xbar_has_workspace_access(p_workspace_id) then
    return false;
  end if;
  case p_table
    when 'horses' then
      select exists (select 1 from public.horses where workspace_id = p_workspace_id and horse_id = p_record_id) into found;
    else
      found := false;
  end case;
  return found;
end;
$$;

revoke all on function public.xbar_record_exists(text, uuid, text) from public, anon;
grant execute on function public.xbar_record_exists(text, uuid, text) to authenticated;

-- horses ----------------------------------------------------------------------

create policy "horses staff insert" on public.horses
  for insert to authenticated
  with check (
    public.xbar_has_workspace_capability(workspace_id, 'createHorse')
    or (
      public.xbar_record_exists('horses', workspace_id, horse_id)
      and (
        public.xbar_has_workspace_capability(workspace_id, 'editHorse')
        or public.xbar_has_workspace_capability(workspace_id, 'manageMedical')
        or public.xbar_has_workspace_capability(workspace_id, 'uploadDocuments')
        or public.xbar_has_workspace_capability(workspace_id, 'reviewDocuments')
        or public.xbar_has_workspace_capability(workspace_id, 'uploadMedia')
      )
    )
  );

create policy "horses staff update" on public.horses
  for update to authenticated
  using (
    public.xbar_has_workspace_capability(workspace_id, 'editHorse')
    or public.xbar_has_workspace_capability(workspace_id, 'manageMedical')
    or public.xbar_has_workspace_capability(workspace_id, 'uploadDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'reviewDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'uploadMedia')
    or public.xbar_has_workspace_capability(workspace_id, 'createHorse')
  )
  with check (
    public.xbar_has_workspace_capability(workspace_id, 'editHorse')
    or public.xbar_has_workspace_capability(workspace_id, 'manageMedical')
    or public.xbar_has_workspace_capability(workspace_id, 'uploadDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'reviewDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'uploadMedia')
    or public.xbar_has_workspace_capability(workspace_id, 'createHorse')
  );

create policy "horses staff delete" on public.horses
  for delete to authenticated
  using (public.xbar_has_workspace_capability(workspace_id, 'createHorse'));

create or replace function public.xbar_guard_specialist_horse_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed constant text[] := array[
    'medicalTimeline', 'medicalNotes', 'lastVetVisit', 'activity',
    'documents', 'documentFacts', 'readiness', 'alerts', 'status', 'sale'
  ];
  key text;
begin
  -- Server-side writers (service role) and managers are not specialists.
  if auth.uid() is null
     or public.xbar_can_manage_workspace(new.workspace_id)
     or public.xbar_has_workspace_capability(new.workspace_id, 'editHorse') then
    return new;
  end if;

  -- Every column but the payload, the status and the timestamp is a mirror
  -- of identity fields this role may not change.
  if (to_jsonb(new) - 'payload' - 'status' - 'updated_at')
     is distinct from (to_jsonb(old) - 'payload' - 'status' - 'updated_at') then
    raise exception 'This role can update a horse''s medical and document details only.';
  end if;

  for key in
    select jsonb_object_keys(coalesce(old.payload, '{}'::jsonb) || coalesce(new.payload, '{}'::jsonb))
  loop
    if not key = any(allowed) and (old.payload -> key) is distinct from (new.payload -> key) then
      raise exception 'This role can update a horse''s medical and document details only.';
    end if;
  end loop;

  -- An injury opens a medical review; nothing else moves the status.
  if (new.status is distinct from old.status and new.status <> 'Medical Review')
     or ((new.payload ->> 'status') is distinct from (old.payload ->> 'status')
         and (new.payload ->> 'status') <> 'Medical Review') then
    raise exception 'This role can only move a horse into medical review.';
  end if;

  -- Approving a media kit flags the horse social-ready, and open inquiries are
  -- counted from the leads; price and terms are not this role's to change.
  if (coalesce(new.payload -> 'sale', '{}'::jsonb) - 'socialReady' - 'inquiryCount')
     is distinct from (coalesce(old.payload -> 'sale', '{}'::jsonb) - 'socialReady' - 'inquiryCount') then
    raise exception 'This role cannot change a horse''s sale details.';
  end if;

  return new;
end;
$$;

revoke all on function public.xbar_guard_specialist_horse_update() from public, anon, authenticated;

create or replace trigger trg_horses_guard_specialist_update
before update on public.horses
for each row execute function public.xbar_guard_specialist_horse_update();

-- documents and intake ---------------------------------------------------------

create policy "documents staff insert" on public.documents
  for insert to authenticated
  with check (
    public.xbar_has_workspace_capability(workspace_id, 'uploadDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'reviewDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'createHorse')
  );
create policy "documents staff update" on public.documents
  for update to authenticated
  using (
    public.xbar_has_workspace_capability(workspace_id, 'uploadDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'reviewDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'createHorse')
  )
  with check (
    public.xbar_has_workspace_capability(workspace_id, 'uploadDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'reviewDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'createHorse')
  );

create policy "intake batches staff insert" on public.intake_batches
  for insert to authenticated
  with check (
    public.xbar_has_workspace_capability(workspace_id, 'uploadDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'reviewDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'createHorse')
  );
create policy "intake batches staff update" on public.intake_batches
  for update to authenticated
  using (
    public.xbar_has_workspace_capability(workspace_id, 'uploadDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'reviewDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'createHorse')
  )
  with check (
    public.xbar_has_workspace_capability(workspace_id, 'uploadDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'reviewDocuments')
    or public.xbar_has_workspace_capability(workspace_id, 'createHorse')
  );

-- ownership -------------------------------------------------------------------

create policy "ownership records staff insert" on public.ownership_records
  for insert to authenticated
  with check (
    public.xbar_has_workspace_capability(workspace_id, 'createHorse')
    or public.xbar_has_workspace_capability(workspace_id, 'manageOwnership')
  );
create policy "ownership records staff update" on public.ownership_records
  for update to authenticated
  using (public.xbar_has_workspace_capability(workspace_id, 'manageOwnership'))
  with check (public.xbar_has_workspace_capability(workspace_id, 'manageOwnership'));

-- costs and equipment ------------------------------------------------------------

create policy "expense receipts staff insert" on public.expense_receipts
  for insert to authenticated
  with check (public.xbar_has_workspace_capability(workspace_id, 'manageAssets'));
create policy "expense receipts staff update" on public.expense_receipts
  for update to authenticated
  using (public.xbar_has_workspace_capability(workspace_id, 'manageAssets'))
  with check (public.xbar_has_workspace_capability(workspace_id, 'manageAssets'));
create policy "expense receipts staff delete" on public.expense_receipts
  for delete to authenticated
  using (public.xbar_has_workspace_capability(workspace_id, 'createHorse'));

create policy "ranch assets staff insert" on public.ranch_assets
  for insert to authenticated
  with check (public.xbar_has_workspace_capability(workspace_id, 'manageAssets'));
create policy "ranch assets staff update" on public.ranch_assets
  for update to authenticated
  using (public.xbar_has_workspace_capability(workspace_id, 'manageAssets'))
  with check (public.xbar_has_workspace_capability(workspace_id, 'manageAssets'));
create policy "ranch assets staff delete" on public.ranch_assets
  for delete to authenticated
  using (public.xbar_has_workspace_capability(workspace_id, 'manageAssets'));

-- sales -----------------------------------------------------------------------

create policy "sales leads staff insert" on public.sales_leads
  for insert to authenticated
  with check (public.xbar_has_workspace_capability(workspace_id, 'manageSales'));
create policy "sales leads staff update" on public.sales_leads
  for update to authenticated
  using (public.xbar_has_workspace_capability(workspace_id, 'manageSales'))
  with check (public.xbar_has_workspace_capability(workspace_id, 'manageSales'));
create policy "sales leads staff delete" on public.sales_leads
  for delete to authenticated
  using (public.xbar_has_workspace_capability(workspace_id, 'createHorse'));

create policy "shared listings staff insert" on public.shared_listings
  for insert to authenticated
  with check (public.xbar_has_workspace_capability(workspace_id, 'manageSharedAccess'));
create policy "shared listings staff update" on public.shared_listings
  for update to authenticated
  using (public.xbar_has_workspace_capability(workspace_id, 'manageSharedAccess'))
  with check (public.xbar_has_workspace_capability(workspace_id, 'manageSharedAccess'));

-- ranch profile -----------------------------------------------------------------

-- Invited Admins manage the ranch; the profile upsert on every save refused
-- them because the only write policy was owner-only.
create policy "workspace profiles managers" on public.workspace_profiles
  for all to authenticated
  using (public.xbar_can_manage_workspace(workspace_id))
  with check (public.xbar_can_manage_workspace(workspace_id));

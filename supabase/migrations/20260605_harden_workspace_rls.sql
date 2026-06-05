-- Apply after production-schema.sql. This migration is idempotent and tightens
-- workspace data writes to the workspace owner or an active Admin membership.

create or replace function public.xbar_has_workspace_access(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_user_id = auth.uid()
  ) or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.xbar_can_manage_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_user_id = auth.uid()
  ) or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'Admin'
  );
$$;

revoke all on function public.xbar_has_workspace_access(uuid) from public;
revoke all on function public.xbar_can_manage_workspace(uuid) from public;
grant execute on function public.xbar_has_workspace_access(uuid) to authenticated;
grant execute on function public.xbar_can_manage_workspace(uuid) to authenticated;

-- Replace permissive ALL policies. Active members may read; only owners/Admins
-- may insert, update, or delete operational records.
drop policy if exists "horses own workspace" on public.horses;
drop policy if exists "horses workspace read" on public.horses;
drop policy if exists "horses workspace manage" on public.horses;
create policy "horses workspace read" on public.horses for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
create policy "horses workspace manage" on public.horses for all to authenticated using (public.xbar_can_manage_workspace(workspace_id)) with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "documents own workspace" on public.documents;
drop policy if exists "documents workspace read" on public.documents;
drop policy if exists "documents workspace manage" on public.documents;
create policy "documents workspace read" on public.documents for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
create policy "documents workspace manage" on public.documents for all to authenticated using (public.xbar_can_manage_workspace(workspace_id)) with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "intake batches own workspace" on public.intake_batches;
drop policy if exists "intake batches workspace read" on public.intake_batches;
drop policy if exists "intake batches workspace manage" on public.intake_batches;
create policy "intake batches workspace read" on public.intake_batches for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
create policy "intake batches workspace manage" on public.intake_batches for all to authenticated using (public.xbar_can_manage_workspace(workspace_id)) with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "ownership records own workspace" on public.ownership_records;
drop policy if exists "ownership records workspace read" on public.ownership_records;
drop policy if exists "ownership records workspace manage" on public.ownership_records;
create policy "ownership records workspace read" on public.ownership_records for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
create policy "ownership records workspace manage" on public.ownership_records for all to authenticated using (public.xbar_can_manage_workspace(workspace_id)) with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "expense receipts own workspace" on public.expense_receipts;
drop policy if exists "expense receipts workspace read" on public.expense_receipts;
drop policy if exists "expense receipts workspace manage" on public.expense_receipts;
create policy "expense receipts workspace read" on public.expense_receipts for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
create policy "expense receipts workspace manage" on public.expense_receipts for all to authenticated using (public.xbar_can_manage_workspace(workspace_id)) with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "ranch assets own workspace" on public.ranch_assets;
drop policy if exists "ranch assets workspace read" on public.ranch_assets;
drop policy if exists "ranch assets workspace manage" on public.ranch_assets;
create policy "ranch assets workspace read" on public.ranch_assets for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
create policy "ranch assets workspace manage" on public.ranch_assets for all to authenticated using (public.xbar_can_manage_workspace(workspace_id)) with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "sales leads own workspace" on public.sales_leads;
drop policy if exists "sales leads workspace read" on public.sales_leads;
drop policy if exists "sales leads workspace manage" on public.sales_leads;
create policy "sales leads workspace read" on public.sales_leads for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
create policy "sales leads workspace manage" on public.sales_leads for all to authenticated using (public.xbar_can_manage_workspace(workspace_id)) with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "shared listings own workspace" on public.shared_listings;
drop policy if exists "shared listings write owner admin" on public.shared_listings;
drop policy if exists "shared listings workspace read" on public.shared_listings;
drop policy if exists "shared listings workspace manage" on public.shared_listings;
create policy "shared listings workspace read" on public.shared_listings for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
create policy "shared listings workspace manage" on public.shared_listings for all to authenticated using (public.xbar_can_manage_workspace(workspace_id)) with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "document processing jobs own workspace" on public.document_processing_jobs;
drop policy if exists "document processing jobs workspace read" on public.document_processing_jobs;
drop policy if exists "document processing jobs workspace manage" on public.document_processing_jobs;
create policy "document processing jobs workspace read" on public.document_processing_jobs for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
create policy "document processing jobs workspace manage" on public.document_processing_jobs for all to authenticated using (public.xbar_can_manage_workspace(workspace_id)) with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "runtime events own workspace" on public.runtime_events;
drop policy if exists "runtime events workspace read" on public.runtime_events;
drop policy if exists "runtime events workspace insert" on public.runtime_events;
create policy "runtime events workspace read" on public.runtime_events for select to authenticated using (public.xbar_has_workspace_access(workspace_id));
create policy "runtime events workspace insert" on public.runtime_events for insert to authenticated with check (public.xbar_has_workspace_access(workspace_id) and (user_id is null or user_id = auth.uid()));

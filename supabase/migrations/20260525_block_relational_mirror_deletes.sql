-- Prevent autosave or stale local mirrors from pruning cloud workspace rows.
-- Destructive restore flows can opt in inside a trusted SQL transaction with:
--   set local xbar.allow_destructive_workspace_prune = 'on';

create or replace function public.xbar_block_relational_mirror_delete()
returns trigger
language plpgsql
as $$
begin
  if current_setting('xbar.allow_destructive_workspace_prune', true) = 'on' then
    return old;
  end if;

  raise exception 'Direct deletes are blocked for XBAR relational mirror tables. Archive or update records instead.';
end;
$$;

drop trigger if exists trg_xbar_block_horses_delete on public.horses;
create trigger trg_xbar_block_horses_delete
before delete on public.horses
for each row execute function public.xbar_block_relational_mirror_delete();

drop trigger if exists trg_xbar_block_documents_delete on public.documents;
create trigger trg_xbar_block_documents_delete
before delete on public.documents
for each row execute function public.xbar_block_relational_mirror_delete();

drop trigger if exists trg_xbar_block_intake_batches_delete on public.intake_batches;
create trigger trg_xbar_block_intake_batches_delete
before delete on public.intake_batches
for each row execute function public.xbar_block_relational_mirror_delete();

drop trigger if exists trg_xbar_block_ownership_records_delete on public.ownership_records;
create trigger trg_xbar_block_ownership_records_delete
before delete on public.ownership_records
for each row execute function public.xbar_block_relational_mirror_delete();

drop trigger if exists trg_xbar_block_expense_receipts_delete on public.expense_receipts;
create trigger trg_xbar_block_expense_receipts_delete
before delete on public.expense_receipts
for each row execute function public.xbar_block_relational_mirror_delete();

drop trigger if exists trg_xbar_block_ranch_assets_delete on public.ranch_assets;
create trigger trg_xbar_block_ranch_assets_delete
before delete on public.ranch_assets
for each row execute function public.xbar_block_relational_mirror_delete();

drop trigger if exists trg_xbar_block_sales_leads_delete on public.sales_leads;
create trigger trg_xbar_block_sales_leads_delete
before delete on public.sales_leads
for each row execute function public.xbar_block_relational_mirror_delete();

drop trigger if exists trg_xbar_block_shared_listings_delete on public.shared_listings;
create trigger trg_xbar_block_shared_listings_delete
before delete on public.shared_listings
for each row execute function public.xbar_block_relational_mirror_delete();

drop trigger if exists trg_xbar_block_workspace_invitations_delete on public.workspace_invitations;
create trigger trg_xbar_block_workspace_invitations_delete
before delete on public.workspace_invitations
for each row execute function public.xbar_block_relational_mirror_delete();

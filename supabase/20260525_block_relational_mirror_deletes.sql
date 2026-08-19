-- STATUS: NOT APPLIED. Deliberately excluded from the canonical schema artifact.
--
-- This file lives outside supabase/migrations/ on purpose, so
-- scripts/prepare-supabase-schema.mjs never bundles it into
-- supabase/production-schema.generated.sql and it is never applied to the
-- production project. Two shipped flows break under these triggers:
--
--   1. Account deletion (api/account/delete.js, step 4) purges a departing
--      user's private workspaces and relies on `on delete cascade` to remove the
--      child rows. PostgreSQL fires child row-level BEFORE DELETE triggers on
--      cascade deletes, so this guard aborts the parent `delete from workspaces`
--      entirely. The call site swallows the error
--      (`.then(undefined, () => {})`) because the auth user is already gone by
--      then, so the failure is silent and the deleted account's data stays in
--      the database — a worse outcome than the pruning this guard prevents.
--      (Verified against the production Postgres: a cascade delete of a parent
--      row is aborted by a child BEFORE DELETE trigger that raises.)
--
--   2. Cloud sync (src/lib/cloudWorkspace.ts, `replaceWorkspaceRows`) treats the
--      local workspace as the source of truth: it diffs local rows against cloud
--      rows and deletes the stale ones for all nine tables named below, throwing
--      on any delete error. With this guard installed, deleting any record in
--      the app makes the entire cloud push fail.
--
-- Adopting it is therefore a data-model change, not a migration: the mirror
-- tables would need soft deletes (archive flags) and both call sites would need
-- to stop issuing hard deletes. The escape hatch below cannot bridge the gap on
-- its own — `set local` requires a SQL transaction, and neither PostgREST nor
-- supabase-js can set it for the client calls above.
--
-- To adopt: resolve both blockers, move this file into supabase/migrations/,
-- re-run `npm run supabase:prepare`, and update
-- tests/schemaDeployability.test.ts, which asserts this exclusion.
--
-- Original intent: prevent autosave or stale local mirrors from pruning cloud
-- workspace rows. Destructive restore flows opt in inside a trusted SQL
-- transaction with:
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

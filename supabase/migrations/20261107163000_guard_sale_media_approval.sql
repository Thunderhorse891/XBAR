-- Prepared only: production application requires Erin's explicit approval.
-- Adapted from PR265 cc155fa5, without modifying its historical migration.
-- Integrating staff horse writes must preserve the sale-media review boundary:
-- editHorse/uploadMedia do not grant manageSales. A Ranch Manager or member
-- Owner can save horse details and pending uploads, but cannot mark a photo
-- Approved or attach a previous photo's approval to another source or horse.
-- No existing data or staff write policy is changed. Storage object ownership
-- and buyer signing remain separate checks. The server review endpoint still
-- requires a compare-and-set acknowledgment for its selected image.
begin;
create or replace function public.xbar_guard_sale_media_approval()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  previous_gallery jsonb := '[]'::jsonb;
  asset jsonb;
begin
  -- Trusted service writers authorize separately. Invoker security preserves
  -- the authenticated caller; absent subjects do not bypass this guard.
  if current_user in ('service_role', 'postgres', 'supabase_admin')
     or public.xbar_has_workspace_capability(new.workspace_id, 'manageSales') then
    return new;
  end if;
  -- Staff UPDATE policies may authorize both the old and new workspace. An
  -- approval earned where this caller manages sales cannot travel back into
  -- a workspace (or onto another horse) where the caller lacks that authority.
  if TG_OP = 'UPDATE'
     and new.workspace_id is not distinct from old.workspace_id
     and new.horse_id is not distinct from old.horse_id
     and jsonb_typeof(old.payload -> 'gallery') = 'array' then
    previous_gallery := old.payload -> 'gallery';
  end if;
  if jsonb_typeof(new.payload -> 'gallery') is distinct from 'array' then return new; end if;
  for asset in select value from jsonb_array_elements(new.payload -> 'gallery') loop
    if asset ->> 'status' = 'Approved' and not exists (
      select 1 from jsonb_array_elements(previous_gallery) previous
      where previous ->> 'status' = 'Approved'
        and previous -> 'id' is not distinct from asset -> 'id'
        and previous -> 'storagePath' is not distinct from asset -> 'storagePath'
        and previous -> 'url' is not distinct from asset -> 'url'
    ) then
      raise exception 'Sale media approval requires an Admin or Sales Lead.';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.xbar_guard_sale_media_approval() from public, anon, authenticated;
create or replace trigger trg_horses_guard_sale_media_approval
-- AFTER sees the final INSERT ON CONFLICT action. A legitimate unchanged
-- approved upsert must be checked as an UPDATE against its original gallery.
after insert or update on public.horses
for each row execute function public.xbar_guard_sale_media_approval();

commit;

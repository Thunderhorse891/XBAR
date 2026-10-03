-- HELD: requires reviewed production rollout and recovery acceptance.
-- Integrating staff horse writes must preserve the sale-media review boundary:
-- editHorse/uploadMedia do not grant manageSales. A Ranch Manager or member
-- Owner can save horse details and pending uploads, but cannot mark a photo
-- Approved or attach a previous photo's approval to a replacement source.
-- No existing data or staff write policy is changed. Storage object ownership
-- and buyer signing remain separate checks. The server review endpoint still
-- requires a compare-and-set acknowledgment for its selected image.
create or replace function public.xbar_guard_sale_media_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_gallery jsonb := '[]'::jsonb;
  asset jsonb;
begin
  -- Background/service writers have no end-user subject. RLS independently
  -- refuses an unauthenticated client; managers and Sales Leads may review.
  if current_setting('role', true) = 'service_role'
     or auth.uid() is null
     or public.xbar_has_workspace_capability(new.workspace_id, 'manageSales') then
    return new;
  end if;
  if TG_OP = 'UPDATE' and jsonb_typeof(old.payload -> 'gallery') = 'array' then
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
before insert or update on public.horses
for each row execute function public.xbar_guard_sale_media_approval();

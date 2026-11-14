-- Prepared only: explicit owner approval is required before production application.
-- Restore parity with the existing API/client rolling 30-day packet allowance.
-- No records, prices, limits, policies or grants change. Existing triggers remain.
begin;

create or replace function public.xbar_enforce_commercial_resource_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  limits record;
  current_count integer;
  previous_payload jsonb;
  previous_listing jsonb;
  resource_exists boolean;
  document_was_active boolean;
begin
  -- Shared with storage and subscription-event writes. Read counts AFTER locking.
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text, 0));
  select * into limits from public.xbar_commercial_limits(new.workspace_id);

  if TG_TABLE_NAME = 'horses' then
    select payload into previous_payload from public.horses
      where workspace_id = new.workspace_id and horse_id = new.horse_id;
    resource_exists := found;
    select count(*) into current_count from public.horses where workspace_id = new.workspace_id and horse_id <> new.horse_id;
    if not resource_exists and current_count + 1 > limits.horse_limit then raise exception 'Horse limit reached for this workspace.'; end if;
    if not limits.ranch_ops_enabled and (
      (
        not resource_exists
        and (coalesce(nullif(new.payload ->> 'costBasis', '')::numeric, 0) > 0 or new.payload ? 'breedingEconomics')
      )
      or (
        resource_exists
        and (
          new.payload ->> 'costBasis' is distinct from previous_payload ->> 'costBasis'
          or new.payload -> 'breedingEconomics' is distinct from previous_payload -> 'breedingEconomics'
        )
      )
    ) then raise exception 'Profit and breeding revenue workflows require Ranch Ops or higher.'; end if;
  elsif TG_TABLE_NAME = 'documents' then
    select state <> 'Archived' into document_was_active from public.documents
      where workspace_id = new.workspace_id and document_id = new.document_id;
    select count(*) into current_count from public.documents where workspace_id = new.workspace_id and document_id <> new.document_id and state <> 'Archived';
    if new.state <> 'Archived' and not coalesce(document_was_active, false) and current_count + 1 > limits.document_limit then raise exception 'Document limit reached for this workspace.'; end if;
  elsif TG_TABLE_NAME = 'sale_packets' then
    select exists(select 1 from public.sale_packets
      where workspace_id = new.workspace_id and packet_id = new.packet_id) into resource_exists;
    -- Match the existing API/client rolling allowance. Historical packets remain
    -- readable and editable; only newly generated packets consume this window.
    select count(*) into current_count from public.sale_packets
      where workspace_id = new.workspace_id and packet_id <> new.packet_id
        -- Hours match the API's elapsed milliseconds, including across DST.
        and created_at >= now() - interval '720 hours';
    if not resource_exists and current_count + 1 > limits.sale_packet_limit then raise exception 'Sale packet limit reached for this workspace.'; end if;
  elsif TG_TABLE_NAME = 'shared_listings' then
    -- A relational-sync upsert of unchanged sharing data must survive a
    -- downgrade. Creating, reactivating or changing a listing still requires
    -- the paid feature; archiving remains available on every tier.
    -- Cloud sync refreshes published_at on every Live listing save; it does
    -- not change the release, token, audience or expiry permissions.
    select to_jsonb(sl) - 'updated_at' - 'created_at' - 'published_at' into previous_listing
      from public.shared_listings sl
      where workspace_id = new.workspace_id and listing_id = new.listing_id;
    if new.state <> 'Archived' and not limits.buyer_deal_room_enabled
      and (to_jsonb(new) - 'updated_at' - 'created_at' - 'published_at') is distinct from previous_listing
      then raise exception 'Buyer Deal Room requires Professional or higher.'; end if;
    if new.state = 'Live' and (
      coalesce(new.payload ->> 'releaseConfirmedAt', '') = ''
      or coalesce(new.payload ->> 'releaseConfirmedBy', '') = ''
    ) then raise exception 'Authorized seller release confirmation is required before a buyer packet can go live.'; end if;
  elsif TG_TABLE_NAME = 'sales_leads' then
    -- BEFORE INSERT also runs for upsert: compare persisted financial fields,
    -- not the nominal operation, so unchanged offers are not treated as new.
    select payload into previous_payload from public.sales_leads
      where workspace_id = new.workspace_id and lead_id = new.lead_id;
    resource_exists := found;
    if not limits.buyer_deal_room_enabled and (
      (
        not resource_exists
        and (
          coalesce(new.payload ->> 'offerAmount', '') <> ''
          or coalesce(new.payload ->> 'counterOfferAmount', '') <> ''
          or coalesce(new.payload ->> 'depositAmount', '') <> ''
        )
      )
      or (
        resource_exists
        and (
          new.payload ->> 'offerAmount' is distinct from previous_payload ->> 'offerAmount'
          or new.payload ->> 'counterOfferAmount' is distinct from previous_payload ->> 'counterOfferAmount'
          or new.payload ->> 'depositAmount' is distinct from previous_payload ->> 'depositAmount'
        )
      )
    ) then raise exception 'Buyer Deal Room offer workflows require Professional or higher.'; end if;
  end if;

  return new;
end;
$$;

commit;

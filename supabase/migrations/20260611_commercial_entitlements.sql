-- Commercial entitlement enforcement and buyer-room audit actions.

create or replace function public.xbar_commercial_limits(p_workspace_id uuid)
returns table (horse_limit integer, document_limit integer, sale_packet_limit integer, buyer_deal_room_enabled boolean)
language sql
security definer
set search_path = public
as $$
  with subscription_row as (
    select tier, payload
    from public.workspace_subscription_profiles
    where workspace_id = p_workspace_id
    limit 1
  )
  select
    coalesce((payload -> 'usage' ->> 'horseLimit')::integer, case tier when 'Enterprise' then 2000 when 'Ranch Ops' then 200 when 'Professional' then 30 else 5 end),
    coalesce((payload -> 'usage' ->> 'documentLimit')::integer, case tier when 'Enterprise' then 20000 when 'Ranch Ops' then 5000 when 'Professional' then 1000 else 250 end),
    coalesce((payload -> 'usage' ->> 'salePacketLimit')::integer, case tier when 'Enterprise' then 2000 when 'Ranch Ops' then 250 when 'Professional' then 30 else 2 end),
    tier in ('Professional', 'Ranch Ops', 'Enterprise')
  from subscription_row
  union all select 5, 250, 2, false where not exists (select 1 from subscription_row)
  limit 1
$$;

grant execute on function public.xbar_commercial_limits(uuid) to authenticated;

create or replace function public.xbar_enforce_commercial_resource_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare limits record; current_count integer;
begin
  select * into limits from public.xbar_commercial_limits(new.workspace_id);
  if TG_TABLE_NAME = 'horses' then
    select count(*) into current_count from public.horses where workspace_id = new.workspace_id and horse_id <> new.horse_id;
    if current_count + 1 > limits.horse_limit then raise exception 'Horse limit reached for this workspace.'; end if;
  elsif TG_TABLE_NAME = 'documents' then
    select count(*) into current_count from public.documents where workspace_id = new.workspace_id and document_id <> new.document_id and state <> 'Archived';
    if new.state <> 'Archived' and current_count + 1 > limits.document_limit then raise exception 'Document limit reached for this workspace.'; end if;
  elsif TG_TABLE_NAME = 'shared_listings' then
    if new.state <> 'Archived' and not limits.buyer_deal_room_enabled then
      raise exception 'Buyer Deal Room requires Professional or higher.';
    end if;
    if new.state = 'Live' and coalesce(new.payload ->> 'releaseConfirmedAt', '') = '' then
      raise exception 'Authorized seller release confirmation is required before a buyer packet can go live.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_horses_enforce_commercial_limits on public.horses;
create trigger trg_horses_enforce_commercial_limits before insert or update on public.horses for each row execute function public.xbar_enforce_commercial_resource_limits();
drop trigger if exists trg_documents_enforce_commercial_limits on public.documents;
create trigger trg_documents_enforce_commercial_limits before insert or update on public.documents for each row execute function public.xbar_enforce_commercial_resource_limits();
drop trigger if exists trg_shared_listings_enforce_commercial_limits on public.shared_listings;
create trigger trg_shared_listings_enforce_commercial_limits before insert or update on public.shared_listings for each row execute function public.xbar_enforce_commercial_resource_limits();

-- Preserve the existing payload builder while adding a hard public-release guard
-- for environments applying this as a migration to an already-running schema.
do $$
begin
  if to_regprocedure('public.xbar_resolve_public_listing_legacy(text,text)') is null
    and to_regprocedure('public.xbar_resolve_public_listing(text,text)') is not null then
    alter function public.xbar_resolve_public_listing(text, text) rename to xbar_resolve_public_listing_legacy;
  end if;
end;
$$;

create or replace function public.xbar_resolve_public_listing(p_share_path text, p_share_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.shared_listings sl
    where sl.share_path = p_share_path
      and sl.state = 'Live'
      and coalesce(sl.payload ->> 'releaseConfirmedAt', '') <> ''
  ) then
    return null;
  end if;
  return public.xbar_resolve_public_listing_legacy(p_share_path, p_share_token);
end;
$$;

grant execute on function public.xbar_resolve_public_listing(text, text) to anon, authenticated;

create or replace function public.xbar_track_public_share_action(
  p_share_path text,
  p_share_token text default null,
  p_event_type text default 'question',
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare listing_row record; offer_lead_id text;
begin
  if p_event_type not in ('download', 'question', 'proof_request', 'offer') then raise exception 'Unsupported buyer-room event.'; end if;
  select sl.workspace_id, sl.listing_id, sl.horse_id, coalesce(nullif(sl.access_mode, ''), 'Private Token') as access_mode, coalesce(sl.share_token, '') as share_token
  into listing_row from public.shared_listings sl where sl.share_path = p_share_path and sl.state = 'Live' and coalesce(sl.payload ->> 'releaseConfirmedAt', '') <> '' order by sl.updated_at desc limit 1;
  if not found then return; end if;
  if listing_row.access_mode <> 'Public Link' and coalesce(p_share_token, '') <> listing_row.share_token then return; end if;
  insert into public.public_share_events (workspace_id, listing_id, horse_id, share_path, event_type, access_mode, metadata)
  values (listing_row.workspace_id, listing_row.listing_id, listing_row.horse_id, p_share_path, p_event_type, listing_row.access_mode, coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('trackedAt', timezone('utc', now())));
  if p_event_type = 'offer' then
    offer_lead_id := 'buyer-offer-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.sales_leads (workspace_id, lead_id, horse_id, lead_name, channel, stage, last_touch, next_follow_up, payload)
    values (
      listing_row.workspace_id,
      offer_lead_id,
      listing_row.horse_id,
      left(coalesce(nullif(p_metadata ->> 'buyerName', ''), 'Buyer offer'), 200),
      'Site Inquiry',
      'Offer',
      current_date::text,
      (current_date + 1)::text,
      jsonb_build_object(
        'id', offer_lead_id,
        'name', left(coalesce(nullif(p_metadata ->> 'buyerName', ''), 'Buyer offer'), 200),
        'channel', 'Site Inquiry',
        'horseId', listing_row.horse_id,
        'stage', 'Offer',
        'lastTouch', current_date::text,
        'nextFollowUp', (current_date + 1)::text,
        'notes', left(coalesce(p_metadata ->> 'message', ''), 2000),
        'offerAmount', case when coalesce(p_metadata ->> 'offerAmount', '') ~ '^[0-9]+([.][0-9]+)?$' then greatest(0, (p_metadata ->> 'offerAmount')::numeric) else 0 end,
        'offerStatus', 'Submitted',
        'depositStatus', 'Not Requested',
        'savedListing', true,
        'shareReady', true
      )
    );
  end if;
end;
$$;

grant execute on function public.xbar_track_public_share_action(text, text, text, jsonb) to anon, authenticated;

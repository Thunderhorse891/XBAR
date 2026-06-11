-- Server-authoritative commercial limits, premium workflow gates, and buyer-packet audit.

-- Billing service-role code is the only writer. Workspace users can read their
-- subscription, but cannot grant themselves a higher tier or larger limits.
drop policy if exists "workspace subscription profiles own workspace" on public.workspace_subscription_profiles;

create or replace function public.xbar_subscription_limits(p_workspace_id uuid)
returns table (seat_limit integer, shared_access_seat_limit integer, document_limit integer, storage_limit_gb integer)
language sql
security definer
set search_path = public
as $$
  with subscription_row as (
    select case when billing_state = 'Past Due' then 'Starter' else tier end as effective_tier
    from public.workspace_subscription_profiles
    where workspace_id = p_workspace_id
    limit 1
  )
  select
    case effective_tier when 'Enterprise' then 60 when 'Ranch Ops' then 20 when 'Professional' then 5 else 1 end,
    case effective_tier when 'Enterprise' then 200 when 'Ranch Ops' then 40 when 'Professional' then 10 else 0 end,
    case effective_tier when 'Enterprise' then 20000 when 'Ranch Ops' then 5000 when 'Professional' then 1000 else 250 end,
    case effective_tier when 'Enterprise' then 2500 when 'Ranch Ops' then 500 when 'Professional' then 100 else 25 end
  from subscription_row
  union all select 1, 0, 250, 25 where not exists (select 1 from subscription_row)
  limit 1
$$;

grant execute on function public.xbar_subscription_limits(uuid) to authenticated;

create or replace function public.xbar_commercial_limits(p_workspace_id uuid)
returns table (
  horse_limit integer,
  document_limit integer,
  sale_packet_limit integer,
  buyer_deal_room_enabled boolean,
  ranch_ops_enabled boolean
)
language sql
security definer
set search_path = public
as $$
  with subscription_row as (
    select case when billing_state = 'Past Due' then 'Starter' else tier end as effective_tier
    from public.workspace_subscription_profiles
    where workspace_id = p_workspace_id
    limit 1
  )
  select
    case effective_tier when 'Enterprise' then 2000 when 'Ranch Ops' then 200 when 'Professional' then 30 else 5 end,
    case effective_tier when 'Enterprise' then 20000 when 'Ranch Ops' then 5000 when 'Professional' then 1000 else 250 end,
    case effective_tier when 'Enterprise' then 2000 when 'Ranch Ops' then 250 when 'Professional' then 30 else 2 end,
    effective_tier in ('Professional', 'Ranch Ops', 'Enterprise'),
    effective_tier in ('Ranch Ops', 'Enterprise')
  from subscription_row
  union all select 5, 250, 2, false, false where not exists (select 1 from subscription_row)
  limit 1
$$;

grant execute on function public.xbar_commercial_limits(uuid) to authenticated;

create or replace function public.xbar_enforce_commercial_resource_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  limits record;
  current_count integer;
begin
  select * into limits from public.xbar_commercial_limits(new.workspace_id);

  if TG_TABLE_NAME = 'horses' then
    select count(*) into current_count from public.horses where workspace_id = new.workspace_id and horse_id <> new.horse_id;
    if current_count + 1 > limits.horse_limit then raise exception 'Horse limit reached for this workspace.'; end if;
    if not limits.ranch_ops_enabled and (
      (
        TG_OP = 'INSERT'
        and (coalesce(nullif(new.payload ->> 'costBasis', '')::numeric, 0) > 0 or new.payload ? 'breedingEconomics')
      )
      or (
        TG_OP = 'UPDATE'
        and (
          new.payload ->> 'costBasis' is distinct from old.payload ->> 'costBasis'
          or new.payload -> 'breedingEconomics' is distinct from old.payload -> 'breedingEconomics'
        )
      )
    ) then raise exception 'Profit and breeding revenue workflows require Ranch Ops or higher.'; end if;
  elsif TG_TABLE_NAME = 'documents' then
    select count(*) into current_count from public.documents where workspace_id = new.workspace_id and document_id <> new.document_id and state <> 'Archived';
    if new.state <> 'Archived' and current_count + 1 > limits.document_limit then raise exception 'Document limit reached for this workspace.'; end if;
  elsif TG_TABLE_NAME = 'sale_packets' then
    select count(*) into current_count from public.sale_packets where workspace_id = new.workspace_id and packet_id <> new.packet_id;
    if current_count + 1 > limits.sale_packet_limit then raise exception 'Sale packet limit reached for this workspace.'; end if;
  elsif TG_TABLE_NAME = 'shared_listings' then
    if new.state <> 'Archived' and not limits.buyer_deal_room_enabled then raise exception 'Buyer Deal Room requires Professional or higher.'; end if;
    if new.state = 'Live' and (
      coalesce(new.payload ->> 'releaseConfirmedAt', '') = ''
      or coalesce(new.payload ->> 'releaseConfirmedBy', '') = ''
    ) then raise exception 'Authorized seller release confirmation is required before a buyer packet can go live.'; end if;
  elsif TG_TABLE_NAME = 'sales_leads' then
    if not limits.buyer_deal_room_enabled and (
      (
        TG_OP = 'INSERT'
        and (
          coalesce(new.payload ->> 'offerAmount', '') <> ''
          or coalesce(new.payload ->> 'counterOfferAmount', '') <> ''
          or coalesce(new.payload ->> 'depositAmount', '') <> ''
        )
      )
      or (
        TG_OP = 'UPDATE'
        and (
          new.payload ->> 'offerAmount' is distinct from old.payload ->> 'offerAmount'
          or new.payload ->> 'counterOfferAmount' is distinct from old.payload ->> 'counterOfferAmount'
          or new.payload ->> 'depositAmount' is distinct from old.payload ->> 'depositAmount'
        )
      )
    ) then raise exception 'Buyer Deal Room offer workflows require Professional or higher.'; end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_horses_enforce_commercial_limits on public.horses;
create trigger trg_horses_enforce_commercial_limits before insert or update on public.horses for each row execute function public.xbar_enforce_commercial_resource_limits();
drop trigger if exists trg_documents_enforce_commercial_limits on public.documents;
create trigger trg_documents_enforce_commercial_limits before insert or update on public.documents for each row execute function public.xbar_enforce_commercial_resource_limits();
drop trigger if exists trg_sale_packets_enforce_commercial_limits on public.sale_packets;
create trigger trg_sale_packets_enforce_commercial_limits before insert or update on public.sale_packets for each row execute function public.xbar_enforce_commercial_resource_limits();
drop trigger if exists trg_shared_listings_enforce_commercial_limits on public.shared_listings;
create trigger trg_shared_listings_enforce_commercial_limits before insert or update on public.shared_listings for each row execute function public.xbar_enforce_commercial_resource_limits();
drop trigger if exists trg_sales_leads_enforce_commercial_limits on public.sales_leads;
create trigger trg_sales_leads_enforce_commercial_limits before insert or update on public.sales_leads for each row execute function public.xbar_enforce_commercial_resource_limits();

create or replace function public.xbar_audit_shared_listing_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  audit_action text;
begin
  if TG_OP = 'INSERT' then
    audit_action := 'buyer_packet.created';
  elsif old.payload ->> 'releaseConfirmedAt' is distinct from new.payload ->> 'releaseConfirmedAt' then
    audit_action := 'buyer_packet.release_confirmed';
  elsif old.channels is distinct from new.channels or old.payload ->> 'lastSharedAt' is distinct from new.payload ->> 'lastSharedAt' then
    audit_action := 'buyer_packet.shared';
  elsif old.state is distinct from new.state or old.access_mode is distinct from new.access_mode then
    audit_action := 'buyer_packet.access_changed';
  else
    return new;
  end if;

  insert into public.audit_logs (workspace_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    new.workspace_id,
    auth.uid(),
    audit_action,
    'shared_listing',
    new.listing_id,
    jsonb_build_object(
      'horseId', new.horse_id,
      'state', new.state,
      'accessMode', new.access_mode,
      'channels', new.channels,
      'releaseConfirmedBy', new.payload ->> 'releaseConfirmedBy'
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_shared_listings_audit on public.shared_listings;
create trigger trg_shared_listings_audit after insert or update on public.shared_listings for each row execute function public.xbar_audit_shared_listing_change();

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
    select 1 from public.shared_listings sl
    where sl.share_path = p_share_path
      and sl.state = 'Live'
      and coalesce(sl.payload ->> 'releaseConfirmedAt', '') <> ''
      and coalesce(sl.payload ->> 'releaseConfirmedBy', '') <> ''
  ) then return null; end if;
  return public.xbar_resolve_public_listing_legacy(p_share_path, p_share_token);
end;
$$;

grant execute on function public.xbar_resolve_public_listing(text, text) to anon, authenticated;

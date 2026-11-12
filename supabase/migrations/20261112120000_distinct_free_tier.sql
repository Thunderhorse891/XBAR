-- Distinct Free baseline: 2 horses, 1 user, 10 active documents, 1 GiB,
-- no new sale packets or shared-owner seats. Paid and Manual Billing records
-- remain untouched. Inactive/unknown/missing subscriptions resolve to Free.
-- Apply ONLY after owner migration approval and disposable-database checks.
-- This does not modify RPC authorization or storage policies (including PR395).
-- Existing records remain readable; resource caps reject growth, not edits.
-- Existing table triggers and grants remain attached via CREATE OR REPLACE.
-- Rollback requires restoring helper/trigger definitions from preceding
-- migrations and the two defaults; do not delete any Free workspace records.
begin;

alter table public.workspace_subscription_profiles alter column tier set default 'Free';
alter table public.workspace_subscription_profiles alter column billing_state set default 'Inactive';

create or replace function public.xbar_subscription_limits(p_workspace_id uuid)
returns table (seat_limit integer, shared_access_seat_limit integer, document_limit integer, storage_limit_gb integer)
language sql
security definer
set search_path = public
as $$
  with subscription_row as (
    select case
      when billing_state in ('Active', 'Manual Billing')
        and tier in ('Starter', 'Professional', 'Ranch Ops', 'Enterprise') then tier
      when billing_state not in ('Active', 'Manual Billing')
        and public.xbar_trial_active(payload) then 'Professional'
      else 'Free'
    end as effective_tier
    from public.workspace_subscription_profiles
    where workspace_id = p_workspace_id
    limit 1
  )
  select
    case effective_tier when 'Enterprise' then 60 when 'Ranch Ops' then 20 when 'Professional' then 5 else 1 end,
    case effective_tier when 'Enterprise' then 200 when 'Ranch Ops' then 40 when 'Professional' then 10 else 0 end,
    case effective_tier when 'Enterprise' then 20000 when 'Ranch Ops' then 5000 when 'Professional' then 1000 when 'Starter' then 250 else 10 end,
    case effective_tier when 'Enterprise' then 2500 when 'Ranch Ops' then 500 when 'Professional' then 100 when 'Starter' then 25 else 1 end
  from subscription_row
  union all select 1, 0, 10, 1 where not exists (select 1 from subscription_row)
  limit 1
$$;

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
    select case
      when billing_state in ('Active', 'Manual Billing')
        and tier in ('Starter', 'Professional', 'Ranch Ops', 'Enterprise') then tier
      when billing_state not in ('Active', 'Manual Billing')
        and public.xbar_trial_active(payload) then 'Professional'
      else 'Free'
    end as effective_tier
    from public.workspace_subscription_profiles
    where workspace_id = p_workspace_id
    limit 1
  )
  select
    case effective_tier when 'Enterprise' then 2000 when 'Ranch Ops' then 200 when 'Professional' then 30 when 'Starter' then 5 else 2 end,
    case effective_tier when 'Enterprise' then 20000 when 'Ranch Ops' then 5000 when 'Professional' then 1000 when 'Starter' then 250 else 10 end,
    case effective_tier when 'Enterprise' then 2000 when 'Ranch Ops' then 250 when 'Professional' then 30 when 'Starter' then 2 else 0 end,
    effective_tier in ('Professional', 'Ranch Ops', 'Enterprise'),
    effective_tier in ('Ranch Ops', 'Enterprise')
  from subscription_row
  union all select 2, 10, 0, false, false where not exists (select 1 from subscription_row)
  limit 1
$$;

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
    select count(*) into current_count from public.sale_packets where workspace_id = new.workspace_id and packet_id <> new.packet_id;
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

create or replace function public.xbar_enforce_storage_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  limit_gb integer;
  used_bytes bigint;
  previous_bytes bigint;
begin
  -- Only enforce when stored bytes actually grow. On UPDATE where the size is
  -- unchanged or smaller — review edits, horse assignment, archive, and the
  -- client's relational-sync re-upserts (which rewrite every document row) —
  -- the write must pass even for a workspace already over cap (e.g. after a
  -- tier downgrade or the backfill above). Enforcing the full total on those
  -- would strand every existing row and break cloud sync outright.
  if TG_OP = 'UPDATE' and new.workspace_id = old.workspace_id and new.size_bytes <= old.size_bytes then
    return new;
  end if;

  -- Serialize concurrent writes for the same workspace so two uploads racing
  -- near the cap cannot both read the same pre-insert SUM and commit a combined
  -- total over the limit. The lock is held to transaction end (xact variant),
  -- and is scoped per workspace so unrelated workspaces never contend.
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text, 0));

  -- BEFORE INSERT also runs for ON CONFLICT DO UPDATE. Do not strand
  -- unchanged upserts after a downgrade; compare the persisted target row.
  if TG_OP = 'INSERT' then
    if TG_TABLE_NAME = 'documents' then
      select size_bytes into previous_bytes from public.documents
        where workspace_id = new.workspace_id and document_id = new.document_id;
    else
      select size_bytes into previous_bytes from public.sale_packets
        where workspace_id = new.workspace_id and packet_id = new.packet_id;
    end if;
    if previous_bytes is not null and new.size_bytes <= previous_bytes then return new; end if;
  end if;

  select storage_limit_gb into limit_gb from public.xbar_subscription_limits(new.workspace_id);

  -- Sum every OTHER stored artifact for the workspace (exclude the current row
  -- by id so this works identically for INSERT and UPDATE), then add the
  -- incoming row's size. Archived documents are counted — see note above.
  if TG_TABLE_NAME = 'documents' then
    used_bytes :=
      coalesce((
        select sum(size_bytes) from public.documents
        where workspace_id = new.workspace_id and document_id <> new.document_id
      ), 0)
      + coalesce((
        select sum(size_bytes) from public.sale_packets where workspace_id = new.workspace_id
      ), 0);
  else -- sale_packets
    used_bytes :=
      coalesce((
        select sum(size_bytes) from public.sale_packets
        where workspace_id = new.workspace_id and packet_id <> new.packet_id
      ), 0)
      + coalesce((
        select sum(size_bytes) from public.documents
        where workspace_id = new.workspace_id
      ), 0);
  end if;

  if used_bytes + new.size_bytes > limit_gb::bigint * 1073741824 then
    raise exception 'Storage limit reached for this workspace.';
  end if;

  return new;
end;
$$;

create or replace function public.xbar_enforce_workspace_seat_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  limits record;
  active_members integer;
  pending_invites integer;
  active_owners integer;
  pending_owner_invites integer;
  target_workspace_id uuid;
begin
  target_workspace_id := coalesce(new.workspace_id, old.workspace_id);
  -- One seat check at a time per workspace. Without it two acceptances, or an
  -- acceptance and an invite, each count the other as not yet there and both
  -- pass -- overfilling the plan.
  perform pg_advisory_xact_lock(hashtextextended('xbar-seats:' || target_workspace_id::text, 0));
  -- Preserve existing seats/reservations after a downgrade when neither
  -- identity, active status nor role grows. The deletion-hold trigger remains
  -- independent and is never bypassed by this return.
  if TG_TABLE_NAME = 'workspace_memberships' then
    if exists(select 1 from public.workspace_memberships m
      where m.workspace_id = new.workspace_id and m.email = new.email
        and m.user_id is not distinct from new.user_id
        and m.role = new.role and m.status = new.status) then return new; end if;
  elsif TG_TABLE_NAME = 'workspace_invitations' then
    if exists(select 1 from public.workspace_invitations i
      where i.workspace_id = new.workspace_id and i.invitation_id = new.invitation_id
        and i.email = new.email and i.role = new.role and i.status = new.status)
      then return new; end if;
  end if;
  select * into limits from public.xbar_subscription_limits(target_workspace_id);

  if TG_TABLE_NAME = 'workspace_invitations' then
    if lower(coalesce(new.status, 'pending')) = 'pending' then
      select count(*) into active_members
      from public.workspace_memberships
      where workspace_id = target_workspace_id
        and status = 'active';

      select count(*) into pending_invites
      from public.workspace_invitations
      where workspace_id = target_workspace_id
        and status = 'pending'
        and invitation_id <> coalesce(new.invitation_id, '');

      if active_members + pending_invites + 1 > limits.seat_limit then
        raise exception 'Seat limit reached for this workspace.';
      end if;

      if new.role = 'Owner' then
        select count(*) into active_owners
        from public.workspace_memberships
        where workspace_id = target_workspace_id
          and status = 'active'
          and role = 'Owner';

        select count(*) into pending_owner_invites
        from public.workspace_invitations
        where workspace_id = target_workspace_id
          and status = 'pending'
          and role = 'Owner'
          and invitation_id <> coalesce(new.invitation_id, '');

        if limits.shared_access_seat_limit <= 0 or active_owners + pending_owner_invites + 1 > limits.shared_access_seat_limit then
          raise exception 'Shared access seat limit reached for this workspace.';
        end if;
      end if;
    end if;
  elsif TG_TABLE_NAME = 'workspace_memberships' then
    if lower(coalesce(new.status, 'active')) = 'active' then
      select count(*) into active_members
      from public.workspace_memberships
      where workspace_id = target_workspace_id
        and status = 'active'
        and email <> coalesce(new.email, '');

      -- The pending invitation for THIS email is the seat this membership
      -- takes. Counting it as well charged the accepted seat twice, so the
      -- last reserved seat on a plan could never be accepted (audit F05).
      select count(*) into pending_invites
      from public.workspace_invitations
      where workspace_id = target_workspace_id
        and status = 'pending'
        and lower(btrim(email)) <> lower(btrim(coalesce(new.email, '')));

      if active_members + pending_invites + 1 > limits.seat_limit then
        raise exception 'Seat limit reached for this workspace.';
      end if;

      if new.role = 'Owner' then
        select count(*) into active_owners
        from public.workspace_memberships
        where workspace_id = target_workspace_id
          and status = 'active'
          and role = 'Owner'
          and email <> coalesce(new.email, '');

        select count(*) into pending_owner_invites
        from public.workspace_invitations
        where workspace_id = target_workspace_id
          and status = 'pending'
          and role = 'Owner'
          and lower(btrim(email)) <> lower(btrim(coalesce(new.email, '')));

        if limits.shared_access_seat_limit <= 0 or active_owners + pending_owner_invites + 1 > limits.shared_access_seat_limit then
          raise exception 'Shared access seat limit reached for this workspace.';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

commit;

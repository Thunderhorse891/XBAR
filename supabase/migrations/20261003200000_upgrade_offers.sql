-- DRAFT: apply only after explicit production migration approval.
-- HOW TO APPLY: deploy with UPGRADE_OFFERS_ENABLED=false; apply this migration;
-- run checks/upgrade-offers.sql on an approved disposable database; verify
-- service-role grants; review the Stripe account/coupon/portal configuration;
-- then enable the endpoint. Missing RPC/schema fails closed in the application.
-- ROLLBACK: disable UPGRADE_OFFERS_ENABLED and roll back application code. Keep
-- these additive tables to preserve offer history and prevent repeat discounts.
-- Do not erase campaign claims to make a failed or expired link work again.

create table if not exists public.account_upgrade_offer_campaigns (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (length(feature) between 1 and 80),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  first_declined boolean not null default false,
  primary key (user_id, feature)
);
create table if not exists public.account_upgrade_offer_attempts (
  attempt_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  feature text not null,
  billing_period text not null check (billing_period in ('monthly', 'annual')),
  attempt_number integer not null check (attempt_number > 0),
  discount_eligible boolean not null default false,
  declined boolean not null default false,
  created_at timestamptz not null default now(),
  checkout_started_at timestamptz,
  checkout_kind text check (checkout_kind in ('checkout', 'subscription_update')),
  checkout_price_id text,
  checkout_coupon_id text,
  checkout_discount_percent integer check (checkout_discount_percent in (0, 10)),
  session_id text,
  session_url text,
  unique (user_id, feature, attempt_number)
);
-- One promotional checkout per account, including across features/workspaces.
-- Reserving it before Stripe protects a timeout/retry; only the same immutable
-- attempt may retry. No browser writes can grant or reset the offer.
create table if not exists public.account_upgrade_discount_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Keep the claim even if its workspace is deleted: deleting/recreating a
  -- workspace must not reset account-wide promotion eligibility.
  attempt_id uuid not null unique,
  created_at timestamptz not null default now()
);

alter table public.account_upgrade_offer_campaigns enable row level security;
alter table public.account_upgrade_offer_attempts enable row level security;
alter table public.account_upgrade_discount_claims enable row level security;
revoke all on table public.account_upgrade_offer_campaigns, public.account_upgrade_offer_attempts,
  public.account_upgrade_discount_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.account_upgrade_offer_campaigns,
  public.account_upgrade_offer_attempts, public.account_upgrade_discount_claims to service_role;

create or replace function public.xbar_upgrade_offer_action(
  p_user_id uuid, p_workspace_id uuid, p_feature text, p_attempt_id uuid,
  p_billing_period text, p_action text,
  p_kind text default null, p_price_id text default null, p_coupon_id text default null,
  p_discount_percent integer default null, p_session_id text default null, p_session_url text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  campaign public.account_upgrade_offer_campaigns%rowtype;
  attempt public.account_upgrade_offer_attempts%rowtype;
  claimed_attempt uuid;
  owner_id uuid;
  eligible boolean;
begin
  if p_user_id is null or p_workspace_id is null or p_attempt_id is null
    or p_feature is null or length(p_feature) not between 1 and 80
    or p_billing_period is null or p_billing_period not in ('monthly', 'annual')
    or p_action is null or p_action not in ('attempt', 'decline', 'read', 'begin_checkout', 'save_session') then
    raise exception 'Invalid upgrade offer request.';
  end if;
  -- Account-wide lock also serializes the single discount claim across features.
  perform pg_advisory_xact_lock(hashtextextended('xbar-upgrade:' || p_user_id::text, 0));
  select owner_user_id into owner_id from public.workspaces where id = p_workspace_id for share;
  if owner_id is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'code', 'owner_required');
  end if;
  if exists (select 1 from public.account_deletion_holds where user_id = p_user_id
      and created_at > now() - interval '15 minutes') then
    return jsonb_build_object('ok', false, 'code', 'account_deletion_in_progress');
  end if;

  select * into attempt from public.account_upgrade_offer_attempts where attempt_id = p_attempt_id;
  if found then
    if attempt.user_id <> p_user_id or attempt.workspace_id <> p_workspace_id
      or attempt.feature <> p_feature or attempt.billing_period <> p_billing_period then
      return jsonb_build_object('ok', false, 'code', 'attempt_conflict');
    end if;
  elsif p_action = 'attempt' then
    insert into public.account_upgrade_offer_campaigns(user_id, feature)
      values (p_user_id, p_feature) on conflict do nothing;
    select * into campaign from public.account_upgrade_offer_campaigns
      where user_id = p_user_id and feature = p_feature for update;
    update public.account_upgrade_offer_campaigns set attempt_count = attempt_count + 1
      where user_id = p_user_id and feature = p_feature;
    insert into public.account_upgrade_offer_attempts
      (attempt_id, user_id, workspace_id, feature, billing_period, attempt_number, discount_eligible)
      values (p_attempt_id, p_user_id, p_workspace_id, p_feature, p_billing_period,
        campaign.attempt_count + 1, campaign.attempt_count = 1 and campaign.first_declined)
      returning * into attempt;
  else
    return jsonb_build_object('ok', false, 'code', 'attempt_not_found');
  end if;

  if p_action = 'decline' then
    update public.account_upgrade_offer_attempts set declined = true
      where attempt_id = p_attempt_id returning * into attempt;
    if attempt.attempt_number = 1 then
      update public.account_upgrade_offer_campaigns set first_declined = true
        where user_id = p_user_id and feature = p_feature;
    end if;
  end if;

  select attempt_id into claimed_attempt from public.account_upgrade_discount_claims where user_id = p_user_id;
  eligible := attempt.discount_eligible and not attempt.declined
    and attempt.created_at > now() - interval '30 minutes'
    and (claimed_attempt is null or claimed_attempt = p_attempt_id);

  if p_action = 'begin_checkout' then
    if attempt.declined or attempt.created_at <= now() - interval '30 minutes' then
      return jsonb_build_object('ok', false, 'code', 'offer_expired');
    end if;
    if p_kind is null or p_kind not in ('checkout', 'subscription_update')
      or coalesce(p_price_id, '') !~ '^price_[A-Za-z0-9_]+$'
      or p_discount_percent is null or p_discount_percent not in (0, 10)
      or (p_discount_percent = 10 and (not eligible or coalesce(p_coupon_id, '') = ''))
      or (p_discount_percent = 0 and coalesce(p_coupon_id, '') <> '') then
      return jsonb_build_object('ok', false, 'code', 'offer_changed');
    end if;
    if attempt.checkout_started_at is not null then
      if attempt.checkout_kind <> p_kind or attempt.checkout_price_id <> p_price_id
        or attempt.checkout_coupon_id is distinct from nullif(p_coupon_id, '')
        or attempt.checkout_discount_percent <> p_discount_percent then
        return jsonb_build_object('ok', false, 'code', 'offer_changed');
      end if;
    else
      if p_discount_percent = 10 then
        insert into public.account_upgrade_discount_claims(user_id, attempt_id) values (p_user_id, p_attempt_id);
      end if;
      update public.account_upgrade_offer_attempts set checkout_started_at = now(), checkout_kind = p_kind,
        checkout_price_id = p_price_id, checkout_coupon_id = nullif(p_coupon_id, ''),
        checkout_discount_percent = p_discount_percent
        where attempt_id = p_attempt_id returning * into attempt;
    end if;
  elsif p_action = 'save_session' then
    if attempt.checkout_started_at is null or coalesce(p_session_id, '') = ''
      or coalesce(p_session_url, '') !~ '^https://(checkout|billing)\.stripe\.com/' then
      return jsonb_build_object('ok', false, 'code', 'session_unverified');
    end if;
    if attempt.session_id is not null and (attempt.session_id <> p_session_id or attempt.session_url <> p_session_url) then
      return jsonb_build_object('ok', false, 'code', 'session_conflict');
    end if;
    update public.account_upgrade_offer_attempts set session_id = p_session_id, session_url = p_session_url
      where attempt_id = p_attempt_id returning * into attempt;
  end if;
  return jsonb_build_object('ok', true, 'attempt', to_jsonb(attempt), 'discountEligible', eligible);
end;
$$;
revoke execute on function public.xbar_upgrade_offer_action(uuid, uuid, text, uuid, text, text, text, text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.xbar_upgrade_offer_action(uuid, uuid, text, uuid, text, text, text, text, text, integer, text, text)
  to service_role;

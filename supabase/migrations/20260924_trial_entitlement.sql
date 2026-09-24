-- Honor the 14-day Professional trial in the database's entitlement helpers.
--
-- WHY
-- ---
-- A trial is recorded on the workspace's subscription profile as
-- `payload.trial = { startedAt, endsAt, plan: 'Professional' }`, written by
-- api/trial/start.js. The API honors it in getWorkspaceEntitlements, but the
-- API is not the only enforcement: the seat, storage, and commercial-resource
-- triggers consult xbar_subscription_limits and xbar_commercial_limits, and
-- the client writes horses and documents straight through RLS. Without this
-- migration a trialing workspace would pass every client and API gate and
-- then be refused at the database trigger the moment it added its 6th horse.
--
-- WHAT THIS DOES
-- --------------
-- Adds public.xbar_trial_active(payload), which answers whether the trial
-- window covers now, and adds one branch to each helper's effective_tier:
-- an active trial resolves to 'Professional'. The billing-state allowlist is
-- untouched — a trial only ever raises a baseline workspace, never overrides
-- a paid or comped one — and the `else 'Starter'` fallback still catches
-- everything else, so the entitlementHelperParity assertions keep holding.
--
-- The trial predicate is strict, mirroring api/_lib/trial-status.js:
-- plan must be 'Professional', both timestamps must look like ISO-8601
-- (guarded by regex BEFORE any cast, because SQL does not short-circuit AND),
-- and the window may not exceed 14 days. A hand-edited payload that claims
-- 90 days of Professional reads as no trial.
--
-- Idempotent: all three functions are `create or replace` with identical
-- signatures, so re-running replaces bodies and nothing else. No trigger is
-- dropped or recreated, so enforcement stays attached throughout. Rollback is
-- re-applying 20260820_entitlement_helpers_honor_inactive.sql and dropping
-- xbar_trial_active.
--
-- NOT APPLIED BY THE AUTHOR — production migrations require the owner's
-- explicit approval (production engineering contract, section 15). Verify
-- with supabase/checks/trial-entitlement.sql against a throwaway database
-- before applying.

begin;

create or replace function public.xbar_trial_active(p_payload jsonb)
returns boolean
language sql
stable
set search_path = public
as $$
  -- CASE, not AND: the regex guards must run before the casts, and SQL is
  -- allowed to evaluate AND operands in any order. A malformed timestamp
  -- reaching ::timestamptz would raise and take the trigger with it.
  select coalesce(case
    when (p_payload -> 'trial' ->> 'plan') is distinct from 'Professional' then false
    when (p_payload -> 'trial' ->> 'startedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' then false
    when (p_payload -> 'trial' ->> 'endsAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' then false
    else
      (p_payload -> 'trial' ->> 'startedAt')::timestamptz <= now()
      and now() < (p_payload -> 'trial' ->> 'endsAt')::timestamptz
      and (p_payload -> 'trial' ->> 'endsAt')::timestamptz
          <= (p_payload -> 'trial' ->> 'startedAt')::timestamptz + interval '14 days'
  end, false)
$$;

create or replace function public.xbar_subscription_limits(p_workspace_id uuid)
returns table (seat_limit integer, shared_access_seat_limit integer, document_limit integer, storage_limit_gb integer)
language sql
security definer
set search_path = public
as $$
  with subscription_row as (
    select case
      when billing_state in ('Active', 'Manual Billing') then tier
      when public.xbar_trial_active(payload) then 'Professional'
      else 'Starter'
    end as effective_tier
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
      when billing_state in ('Active', 'Manual Billing') then tier
      when public.xbar_trial_active(payload) then 'Professional'
      else 'Starter'
    end as effective_tier
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

-- Re-assert the grants from the original migration. `create or replace` keeps
-- existing privileges, so these are no-ops today; they are here so this file
-- states the intended reachable surface rather than relying on what a previous
-- migration happened to leave behind. xbar_trial_active is intentionally NOT
-- granted: it is only reachable through the two security-definer helpers.
grant execute on function public.xbar_subscription_limits(uuid) to authenticated;
grant execute on function public.xbar_commercial_limits(uuid) to authenticated;

commit;

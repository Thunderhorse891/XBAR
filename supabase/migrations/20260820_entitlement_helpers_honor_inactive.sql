-- Make the database's entitlement helpers agree with the API about who is paying.
--
-- PROPOSED — NOT YET APPLIED. See the apply procedure in docs/ before running.
--
-- WHY
-- ---
-- api/_lib/subscription-status.js is now the single policy for what a Stripe
-- status means, and it stores four billing states: 'Active', 'Past Due',
-- 'Manual Billing', and 'Inactive'. A canceled, paused, unpaid, incomplete, or
-- unrecognized status all resolve to 'Inactive', and the API grants such a
-- workspace only the Starter feature set.
--
-- These two helpers predate that state. Both were written when 'Past Due' was
-- the only non-paying case, so both say:
--
--     case when billing_state = 'Past Due' then 'Starter' else tier end
--
-- 'Inactive' therefore falls into `else tier` and keeps the purchased tier. The
-- helpers are what the seat, storage, and commercial-resource triggers consult,
-- so a workspace that stopped paying still gets its old paid limits enforced in
-- the database — Enterprise seat counts, Enterprise storage, buyer deal rooms —
-- while the API tells the same workspace it is on Starter. The database is the
-- authoritative side, so the API's answer is the one that loses.
--
-- WHAT THIS DOES
-- --------------
-- Inverts the test: a purchased tier is retained only for the states that mean
-- someone is actually paying or has been deliberately comped, and every other
-- value falls back to Starter. Listing what keeps access, rather than what
-- loses it, is the point — a fifth billing state added later fails to the
-- baseline instead of silently inheriting paid limits, which is the failure
-- being fixed here.
--
-- 'Manual Billing' is retained deliberately. It is an operator's explicit
-- decision to comp or invoice outside Stripe, and api/_lib/subscription-status.js
-- guarantees no Stripe status can ever map onto it.
--
-- The limit numbers below are unchanged from 20260611_commercial_entitlements.sql
-- and still mirror api/_lib/subscription-plans.js, which the parity tests pin.
-- Only the effective_tier expression differs.
--
-- Idempotent: both functions are `create or replace` with identical signatures,
-- so re-running replaces the body and nothing else. No trigger is dropped or
-- recreated, so enforcement stays attached throughout.

-- VERIFIED ON POSTGRESQL 16
-- -------------------------
-- Applied to a fixture holding one Enterprise profile per billing state, then
-- calling xbar_subscription_limits for each (Enterprise is 60 seats / 2500 GB,
-- Starter is 1 / 25):
--
--   billing_state      before this migration   after
--   Active                     60 / 2500       60 / 2500
--   Manual Billing             60 / 2500       60 / 2500
--   Inactive                   60 / 2500        1 / 25   <- the fix
--   Past Due                    1 / 25          1 / 25
--   unrecognized value         60 / 2500        1 / 25   <- fails safe now
--   no profile row at all       1 / 25          1 / 25
--
-- The two rows that change are the point: a workspace that stopped paying kept
-- full Enterprise limits at the trigger level, and so did any billing state
-- this codebase does not define.

begin;

create or replace function public.xbar_subscription_limits(p_workspace_id uuid)
returns table (seat_limit integer, shared_access_seat_limit integer, document_limit integer, storage_limit_gb integer)
language sql
security definer
set search_path = public
as $$
  with subscription_row as (
    select case
      when billing_state in ('Active', 'Manual Billing') then tier
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
-- migration happened to leave behind.
grant execute on function public.xbar_subscription_limits(uuid) to authenticated;
grant execute on function public.xbar_commercial_limits(uuid) to authenticated;

commit;

-- NOT CHANGED, DELIBERATELY
-- -------------------------
-- The missing-row fallbacks (`union all select 1, 0, 250, 25 ...`) already
-- return Starter limits, which is the correct answer for a workspace with no
-- subscription profile at all, and matches the API's baseline.

-- Executable check for the trial entitlement migration.
--
-- Load against a throwaway PostgreSQL 16 database AFTER loading the
-- migration under test:
--
--     psql "$DATABASE_URL" -f supabase/migrations/20260924130000_trial_entitlement.sql
--     psql "$DATABASE_URL" -f supabase/checks/trial-entitlement.sql
--
-- It creates only the columns the helpers touch, inserts one fixture
-- workspace per trial shape, and raises on the first mismatch. A clean run
-- ends with the summary row and no error.
--
-- NEVER run against production: it inserts fixture rows.

create table if not exists public.workspace_subscription_profiles (
  workspace_id uuid primary key,
  tier text not null default 'Starter',
  billing_state text not null default 'Manual Billing',
  payload jsonb not null default '{}'::jsonb
);

do $$
declare
  ws_active_trial uuid := gen_random_uuid();
  ws_expired_trial uuid := gen_random_uuid();
  ws_malformed uuid := gen_random_uuid();
  ws_long_window uuid := gen_random_uuid();
  ws_no_trial uuid := gen_random_uuid();
  ws_paid_with_trial uuid := gen_random_uuid();
  r record;
begin
  insert into public.workspace_subscription_profiles (workspace_id, tier, billing_state, payload) values
    (ws_active_trial, 'Starter', 'Inactive',
      jsonb_build_object('trial', jsonb_build_object(
        'startedAt', (now() - interval '1 day')::text,
        'endsAt', (now() + interval '13 days')::text,
        'plan', 'Professional'))),
    (ws_expired_trial, 'Starter', 'Inactive',
      jsonb_build_object('trial', jsonb_build_object(
        'startedAt', (now() - interval '30 days')::text,
        'endsAt', (now() - interval '16 days')::text,
        'plan', 'Professional'))),
    (ws_malformed, 'Starter', 'Inactive',
      jsonb_build_object('trial', jsonb_build_object('startedAt', 'garbage'))),
    (ws_long_window, 'Starter', 'Inactive',
      jsonb_build_object('trial', jsonb_build_object(
        'startedAt', now()::text,
        'endsAt', (now() + interval '90 days')::text,
        'plan', 'Professional'))),
    (ws_no_trial, 'Starter', 'Inactive', '{}'::jsonb),
    (ws_paid_with_trial, 'Ranch Ops', 'Active',
      jsonb_build_object('trial', jsonb_build_object(
        'startedAt', (now() - interval '1 day')::text,
        'endsAt', (now() + interval '13 days')::text,
        'plan', 'Professional')));

  -- xbar_trial_active directly
  if not public.xbar_trial_active((select payload from public.workspace_subscription_profiles where workspace_id = ws_active_trial)) then
    raise exception 'active trial not recognized';
  end if;
  if public.xbar_trial_active((select payload from public.workspace_subscription_profiles where workspace_id = ws_expired_trial)) then
    raise exception 'expired trial still active';
  end if;
  if public.xbar_trial_active((select payload from public.workspace_subscription_profiles where workspace_id = ws_malformed)) then
    raise exception 'malformed trial payload granted';
  end if;
  if public.xbar_trial_active((select payload from public.workspace_subscription_profiles where workspace_id = ws_long_window)) then
    raise exception 'hand-edited 90-day window honored';
  end if;
  if public.xbar_trial_active('{}'::jsonb) then
    raise exception 'empty payload reports a trial';
  end if;

  -- commercial limits: Professional is 30 horses / buyer rooms on; Starter is 5 / off
  select * into r from public.xbar_commercial_limits(ws_active_trial);
  if r.horse_limit <> 30 or r.buyer_deal_room_enabled <> true then
    raise exception 'active trial: expected 30 horses + buyer rooms, got % %', r.horse_limit, r.buyer_deal_room_enabled;
  end if;

  select * into r from public.xbar_commercial_limits(ws_expired_trial);
  if r.horse_limit <> 5 or r.buyer_deal_room_enabled then
    raise exception 'expired trial: expected Starter limits, got % %', r.horse_limit, r.buyer_deal_room_enabled;
  end if;

  select * into r from public.xbar_commercial_limits(ws_malformed);
  if r.horse_limit <> 5 then raise exception 'malformed trial: expected Starter horse limit'; end if;

  select * into r from public.xbar_commercial_limits(ws_long_window);
  if r.horse_limit <> 5 then raise exception 'long window: expected Starter horse limit'; end if;

  select * into r from public.xbar_commercial_limits(ws_no_trial);
  if r.horse_limit <> 5 then raise exception 'no trial: expected Starter horse limit'; end if;

  -- a paid workspace keeps its own tier even with a trial record present
  select * into r from public.xbar_commercial_limits(ws_paid_with_trial);
  if r.horse_limit <> 200 then
    raise exception 'paid workspace with trial record: expected Ranch Ops (200 horses), got %', r.horse_limit;
  end if;

  -- subscription limits: Professional is 5 seats / 100 GB; Starter is 1 / 25
  select * into r from public.xbar_subscription_limits(ws_active_trial);
  if r.seat_limit <> 5 or r.storage_limit_gb <> 100 then
    raise exception 'active trial subscription limits: expected 5 seats / 100 GB, got % / %', r.seat_limit, r.storage_limit_gb;
  end if;

  select * into r from public.xbar_subscription_limits(ws_expired_trial);
  if r.seat_limit <> 1 or r.storage_limit_gb <> 25 then
    raise exception 'expired trial subscription limits: expected 1 seat / 25 GB, got % / %', r.seat_limit, r.storage_limit_gb;
  end if;

  raise notice 'trial-entitlement check passed: active grants Professional, expired/malformed/long-window fall to Starter, paid tier untouched';
end
$$;

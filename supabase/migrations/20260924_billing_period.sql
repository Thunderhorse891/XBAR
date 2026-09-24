-- Record which billing period a subscription was bought on.
--
-- WHY
-- ---
-- An annual purchase used to land in `workspace_subscription_profiles` as
-- `monthly_rate: 29` with nothing saying it was billed annually — the profile,
-- the JSON payload, and the table all read exactly like a $29/mo monthly
-- subscription. The billing period is a property of the Stripe Price (a Price
-- pins its own billing interval), so the webhook derives it from the price id
-- and passes it here as `p_billing_period`; the checkout session already
-- carries it in `workspace_billing_period` metadata for retry matching.
--
-- `billing_period` is nullable because rows written before this migration
-- cannot honestly claim a period: their price ids are still on
-- `workspace_billing_customers.stripe_price_id`, but the mapping from price id
-- to period lives in the deployment's environment, not in the database, so no
-- backfill can reconstruct it. NULL means "recorded before the period was
-- tracked", not "monthly".
--
-- WHY COALESCE ON THE UPDATE
-- --------------------------
-- Absent means preserve (contract rule 13). A null `p_billing_period` arrives
-- from two places: a caller that predates the parameter (it defaults to null
-- for exactly that reason), and a non-entitling event whose price id no env
-- var matches — the webhook refuses an ENTITLING event with an unknown price
-- outright, but a cancellation for a retired price id still has to deactivate
-- the workspace. Either way the event must not wipe the period an earlier
-- event recorded.
--
-- The signature changes, so this drops the 14-argument function and creates
-- the 15-argument one. Both happen in one transaction: there is no moment a
-- concurrent webhook can resolve the old signature, because the drop and the
-- create commit together. `CREATE OR REPLACE` cannot change a parameter list,
-- which is why the drop is explicit rather than hidden.
--
-- NOT APPLIED BY THIS CHANGE. Applying a production migration requires Erin's
-- explicit approval (production engineering contract, rule 15). See
-- "How to apply this" at the bottom.

begin;

-- The period the workspace's subscription was bought on. Nullable: pre-change
-- rows predate period tracking, and null is the honest value for them.
alter table public.workspace_subscription_profiles
  add column if not exists billing_period text;

-- Only the two periods the product sells. A bad value errors the event's
-- transaction, which is the fail-closed direction: the webhook throws, writes
-- nothing, and Stripe retries, rather than recording a period nobody sells.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_subscription_profiles_billing_period_check'
  ) then
    alter table public.workspace_subscription_profiles
      add constraint workspace_subscription_profiles_billing_period_check
      check (billing_period in ('monthly', 'annual'));
  end if;
end $$;

comment on column public.workspace_subscription_profiles.billing_period is
  'The billing period the subscription was bought on (''monthly'' | ''annual''), derived from the Stripe price id. NULL means the row predates period tracking — never read it as monthly.';

-- The 14-argument signature is replaced, not overloaded: two live signatures
-- would let an old and a new writer disagree about which one the database
-- applies, and the old one would silently drop the period.
drop function if exists public.xbar_apply_subscription_event(uuid, text, text, timestamptz, jsonb, text, text, double precision, jsonb, text, text, text, integer, boolean);

create function public.xbar_apply_subscription_event(
  p_workspace_id uuid,
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_payload jsonb,
  p_tier text,
  p_billing_state text,
  p_monthly_rate double precision,
  p_profile jsonb,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_seat_count integer,
  -- Whether this write's entitlement came from a SIBLING subscription rather
  -- than from the one this event is about. Only those carry a snapshot read
  -- before the lock, so only those can be stale. Defaulted so a caller that
  -- predates it still applies events, treating them as non-speculative.
  p_from_sibling boolean default false,
  -- The billing period the subscription was bought on. Defaulted so a caller
  -- that predates it still applies events, leaving the column untouched.
  p_billing_period text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  last_applied timestamptz;
  current_state text;
begin
  -- Held until this transaction ends, so the comparison below and the writes
  -- after it cannot be interleaved with another delivery for this workspace.
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  select max(stripe_event_created_at)
    into last_applied
    from public.workspace_subscription_events
   where workspace_id = p_workspace_id;

  -- STRICTLY older. Several events can share a `created` second — a plan change
  -- emits more than one — and refusing an equal timestamp would drop a real
  -- update. Redeliveries of the SAME event are stopped by stripe_event_id.
  --
  -- A null on either side is not staleness: a workspace whose first event this
  -- is, or whose history predates this column, must still be able to apply it.
  if last_applied is not null
     and p_event_created_at is not null
     and p_event_created_at < last_applied then
    return false;
  end if;

  -- ON A TIE, A SPECULATIVE ENTITLEMENT LOSES.
  --
  -- Admitting equal timestamps is right for the plan-change case above and
  -- leaves one shape unresolved. When two subscriptions on the same customer
  -- are canceled in the same `created` second, the handler for each one asks
  -- Stripe whether a sibling still pays for the workspace — and that list is
  -- read BEFORE this lock is taken, so it can already be out of date. The
  -- first cancellation therefore carries an `Active` snapshot of a sibling
  -- that is itself being canceled. If the sibling's own `Inactive` lands
  -- first, the tie let the stale `Active` overwrite it, and because both
  -- cancellations were then recorded, no later event necessarily arrives to
  -- put it right: the workspace keeps paid access indefinitely.
  --
  -- `p_from_sibling` is what separates that write from a real one, and the
  -- distinction is the whole rule. Refusing EVERY tied entitling event was the
  -- first attempt and it was wrong: a genuine re-subscription's
  -- `checkout.session.completed` can share a second with the cancellation it
  -- replaces, and refusing it leaves a customer who has just paid with
  -- nothing. That was defended on the grounds that a later event would grant
  -- it — which is false. api/stripe/webhook.js handles only
  -- `checkout.session.completed` and `customer.subscription.updated`/
  -- `.deleted`; there are no invoice handlers, and Stripe promises no prompt
  -- follow-up `updated`. Access could have stayed withheld until the next
  -- lifecycle change, possibly a month away.
  --
  -- So only the speculative write yields. An event about its own subscription
  -- is admitted on a tie exactly as before.
  --
  -- Strictly newer events are unaffected: this only reads on an exact tie.
  if last_applied is not null
     and p_event_created_at is not null
     and p_event_created_at = last_applied
     and p_from_sibling
     and p_billing_state in ('Active', 'Manual Billing') then
    select billing_state
      into current_state
      from public.workspace_subscription_profiles
     where workspace_id = p_workspace_id;

    if current_state is not null and current_state not in ('Active', 'Manual Billing') then
      return false;
    end if;
  end if;

  insert into public.workspace_subscription_profiles
    (workspace_id, tier, billing_state, monthly_rate, billing_period, payload, updated_at)
  values (p_workspace_id, p_tier, p_billing_state, p_monthly_rate, p_billing_period, p_profile, now())
  on conflict (workspace_id) do update
    set tier = excluded.tier,
        billing_state = excluded.billing_state,
        monthly_rate = excluded.monthly_rate,
        -- Absent means preserve: a caller that predates p_billing_period, or
        -- an event whose price id no env var matches, must not wipe the period
        -- an earlier event recorded.
        billing_period = coalesce(excluded.billing_period, workspace_subscription_profiles.billing_period),
        payload = excluded.payload,
        updated_at = excluded.updated_at;

  -- Only the billing columns are assigned. `checkout_lock_at` and
  -- `checkout_lock_token` live on this table too, and a webhook landing while a
  -- checkout holds the lock must not clear it — that lock is what stops a
  -- second Checkout Session being created for the same workspace.
  insert into public.workspace_billing_customers
    (workspace_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
     seat_count, entitlement_payload, updated_at)
  values (p_workspace_id, coalesce(p_customer_id, ''), coalesce(p_subscription_id, ''),
          coalesce(p_price_id, ''), coalesce(p_seat_count, 1), p_profile, now())
  on conflict (workspace_id) do update
    set stripe_customer_id = excluded.stripe_customer_id,
        stripe_subscription_id = excluded.stripe_subscription_id,
        stripe_price_id = excluded.stripe_price_id,
        seat_count = excluded.seat_count,
        entitlement_payload = excluded.entitlement_payload,
        updated_at = excluded.updated_at;

  insert into public.workspace_subscription_events
    (workspace_id, stripe_event_id, event_type, stripe_event_created_at, payload, processed_at)
  values (p_workspace_id, p_event_id, p_event_type, p_event_created_at, p_payload, now())
  on conflict (stripe_event_id) do update
    set event_type = excluded.event_type,
        stripe_event_created_at = excluded.stripe_event_created_at,
        payload = excluded.payload,
        processed_at = excluded.processed_at;

  return true;
end;
$$;

-- Same rule as 20260822: nothing is executable by PUBLIC or anon by default.
-- Only the API's service role calls this, and it writes entitlements.
-- The 14-argument signature this replaces was dropped above, so its grants
-- went with it; these are for the new 15-argument signature.
revoke all on function public.xbar_apply_subscription_event(uuid, text, text, timestamptz, jsonb, text, text, double precision, jsonb, text, text, text, integer, boolean, text) from public;
revoke all on function public.xbar_apply_subscription_event(uuid, text, text, timestamptz, jsonb, text, text, double precision, jsonb, text, text, text, integer, boolean, text) from anon;
revoke all on function public.xbar_apply_subscription_event(uuid, text, text, timestamptz, jsonb, text, text, double precision, jsonb, text, text, text, integer, boolean, text) from authenticated;
grant execute on function public.xbar_apply_subscription_event(uuid, text, text, timestamptz, jsonb, text, text, double precision, jsonb, text, text, text, integer, boolean, text) to service_role;

commit;

-- HOW TO APPLY THIS
-- -----------------
-- Not applied by this change. Requires Erin's explicit approval (contract
-- rule 15). Do not create a paid Supabase branch for it.
--
-- It is additive and safe to run on a live database — one nullable column, one
-- check constraint, and a function replace inside a single transaction. No
-- backfill, no table rewrite:
--
--   psql "$DATABASE_URL" -f supabase/migrations/20260924_billing_period.sql
--
-- Order matters against one migration only: this must run AFTER
-- 20260827_subscription_event_ordering.sql, whose function it replaces. The
-- filename date keeps that order.
--
-- Verify with:
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'workspace_subscription_profiles'
--      and column_name = 'billing_period';
--
--   select p.proname, pg_get_function_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'xbar_apply_subscription_event';
--
-- The second query must show exactly one row, with p_billing_period last.
--
-- THIS IS A PREREQUISITE FOR THE WEBHOOK
-- --------------------------------------
-- api/stripe/webhook.js passes p_billing_period on every subscription event.
-- Until this migration is applied, that named argument matches no function
-- signature, the RPC errors, the handler throws, and Stripe retries — no
-- entitlement is written, which is the fail-closed direction, but billing
-- stops flowing. Apply this before the webhook change goes live.
--
-- ROLLBACK
-- --------
-- Restores the 14-argument function by re-running the migration that defined
-- it, then drops the column. Re-running 20260827 is safe: it is written with
-- `if not exists` / `create or replace` throughout.
--
--   psql "$DATABASE_URL" -f supabase/migrations/20260827_subscription_event_ordering.sql
--   psql "$DATABASE_URL" -c "alter table public.workspace_subscription_profiles drop column if exists billing_period;"
--
-- Rolling back loses the recorded periods rather than merely hiding them, and
-- the webhook must be reverted first: with this migration rolled back but the
-- webhook still passing p_billing_period, every billing event errors (see
-- above). Revert order: webhook, then this rollback.

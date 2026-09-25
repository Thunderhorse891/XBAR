-- Preserve the trial record from the locked row when a billing event lands.
--
-- WHY
-- ---
-- The one-trial-per-workspace invariant lives in `payload -> 'trial'`, and
-- `buildSubscriptionProfile` does not emit it — so a billing event's profile
-- never carries one. The webhook handler copies the stored trial from a
-- SELECT taken BEFORE this function's advisory lock; a trial that starts in
-- the window between that SELECT and this write was then erased by the full
-- `payload = excluded.payload` replace below. After a later cancellation,
-- `decideTrialStart` saw no marker and granted a second free trial — the
-- exact invariant the carry-forward claimed to preserve.
--
-- The merge therefore happens here, under the lock, against the CURRENT row:
-- the SELECT below runs after `pg_advisory_xact_lock`, so a concurrent
-- `startWorkspaceTrial` is visible to it. An incoming profile that already
-- carries a trial (no current caller does) wins; otherwise the locked row's
-- record is kept. The handler's own carry-forward stays in place as the
-- pre-migration fallback — a database without this migration still gets the
-- sequential case right — but this merge is authoritative once applied.
--
-- WHAT STAYS IN JAVASCRIPT
-- ------------------------
-- The trial DECISION (`decideTrialStart` / `startWorkspaceTrial`): those read
-- the row and write conditionally, which is already atomic at the row level.
-- The race was never in the trial start — it was in this function's blind
-- overwrite of a record the handler had read too early.

begin;

create or replace function public.xbar_apply_subscription_event(
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
  locked_trial jsonb;
  merged_profile jsonb;
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

  -- PRESERVE THE TRIAL FROM THE LOCKED ROW.
  --
  -- This read happens AFTER the advisory lock, so it sees a trial that a
  -- concurrent startWorkspaceTrial committed between the handler's pre-lock
  -- SELECT and this write. Merging here — rather than trusting the handler's
  -- snapshot — is what closes that interleaving: the full payload replace
  -- below can no longer erase a trial it never saw.
  select payload -> 'trial'
    into locked_trial
    from public.workspace_subscription_profiles
   where workspace_id = p_workspace_id;

  merged_profile := coalesce(p_profile, '{}'::jsonb);
  if locked_trial is not null and (merged_profile -> 'trial') is null then
    merged_profile := jsonb_set(merged_profile, '{trial}', locked_trial);
  end if;

  insert into public.workspace_subscription_profiles
    (workspace_id, tier, billing_state, monthly_rate, billing_period, payload, updated_at)
  values (p_workspace_id, p_tier, p_billing_state, p_monthly_rate, p_billing_period, merged_profile, now())
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
          coalesce(p_price_id, ''), coalesce(p_seat_count, 1), merged_profile, now())
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

-- Same signature as the function this replaces, so the existing grants carry
-- over unchanged: service_role only, nothing for public/anon/authenticated.

commit;

-- HOW TO APPLY THIS
-- -----------------
-- Not applied by this change. Requires Erin's explicit approval (contract
-- rule 15). Do not create a paid Supabase branch for it.
--
-- It is a function replace inside a single transaction — no column changes,
-- no backfill, no table rewrite:
--
--   psql "$DATABASE_URL" -f supabase/migrations/20260924223000_preserve_trial_in_event_rpc.sql
--
-- Order matters against one migration only: this must run AFTER
-- 20260924120000_billing_period.sql, whose 15-argument function it replaces.
-- The filename date keeps that order.
--
-- Verify with:
--
--   select p.proname, pg_get_function_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'xbar_apply_subscription_event';
--
-- The single row's definition must contain "PRESERVE THE TRIAL FROM THE
-- LOCKED ROW".
--
-- Until this migration is applied, the handler's own carry-forward (kept in
-- api/stripe/webhook.js) covers the sequential case; the interleaving it
-- cannot see stays open. That is the fail-open direction for a narrow race,
-- not for access: no path here grants anything.
--
-- ROLLBACK
-- --------
-- Re-apply supabase/migrations/20260924120000_billing_period.sql, which
-- restores the 15-argument function without the trial merge.

-- Record when Stripe created each billing event, so a late one cannot win.
--
-- NOT YET APPLIED. See "How to apply this" at the bottom.
--
-- WHY
-- ---
-- `workspace_subscription_events` recorded `processed_at` — when WE handled the
-- event — and nothing about when STRIPE created it. Those are different clocks
-- and the difference is the bug: a stale event processed late has the LATEST
-- `processed_at` of all, so ordering by it ranks the superseded event first.
--
-- Stripe does not guarantee delivery order, and its retry schedule makes
-- inversion routine rather than exotic. A `customer.subscription.updated` whose
-- first delivery failed is retried over the following hours — by which time the
-- `customer.subscription.deleted` that superseded it may already have been
-- processed. The handler's replay guard matches on `stripe_event_id` alone, and
-- the late event has its own id and has genuinely never been applied, so it
-- passed the guard and its stale `Active` payload was written straight over the
-- cancellation. The workspace then kept a paid tier nobody was paying for,
-- indefinitely, until some later event happened to correct it.
--
-- `event.created` is the one value that orders these correctly: it is assigned
-- by Stripe when the event is created, not when it is delivered or retried.
--
-- WHY A COLUMN RATHER THAN READING IT BACK OUT OF `payload`
-- --------------------------------------------------------
-- `payload` stores `event.data.object` — the subscription — not the event
-- envelope, so `event.created` is not in there at all. The subscription's own
-- `created` is when the SUBSCRIPTION was created and is identical across every
-- event about it, which would rank them all equal.
--
-- Stored as `timestamptz` via `to_timestamp()` rather than as a raw epoch
-- integer so it is comparable with the rest of the schema and readable in the
-- SQL editor while an operator is diagnosing a billing dispute.
--
-- `now()`, not `timezone('utc', now())`, for the same reason the checkout lock
-- migration uses it: the latter strips the zone and is then reinterpreted in
-- the session's TimeZone. The two neighbouring columns in this table still
-- carry that defect in their defaults; correcting them is a separate migration
-- against columns this change does not touch.

begin;

alter table public.workspace_subscription_events
  add column if not exists stripe_event_created_at timestamptz;

comment on column public.workspace_subscription_events.stripe_event_created_at is
  'When Stripe created the event, from event.created — NOT when it was delivered or processed. Orders billing events so a retried, superseded event cannot overwrite a newer one.';

-- Backfill is deliberately absent.
--
-- There is no honest value for rows written before this column existed:
-- `processed_at` is the delivery clock, which is precisely the clock that
-- ordering by it gets wrong. Leaving them NULL is truthful, and the handler
-- treats an unknown last-applied time as "not stale" so a workspace whose
-- history predates this column still applies its next event rather than
-- freezing.

-- The ordering read is "newest applied event for this workspace", which is a
-- one-row lookup on every billing event.
create index if not exists workspace_subscription_events_workspace_created_idx
  on public.workspace_subscription_events (workspace_id, stripe_event_created_at desc);

-- Apply one billing event, atomically.
--
-- WHY A FUNCTION AND NOT A READ FOLLOWED BY THREE UPSERTS
-- ------------------------------------------------------
-- The ordering comparison was first written in the handler: read the newest
-- applied timestamp, compare, then write. That is a read-modify-write with no
-- serialization, and Stripe delivers concurrently.
--
-- Two deliveries for one workspace — an older `updated` being retried and the
-- `deleted` that superseded it — can both read the same previous timestamp and
-- both decide they are newest. The cancellation writes first; the older update
-- then writes `Active` over it. Both are logged as processed, so no retry ever
-- corrects it and the workspace holds a paid tier nobody is paying for. The
-- guard closed the sequential case and left the concurrent one open.
--
-- So the comparison and the writes happen inside one function, under an
-- advisory lock held for the transaction. Concurrent calls for the same
-- workspace serialize; whichever runs second sees the first one's row and
-- refuses. Different workspaces do not contend: the lock key is derived from
-- the workspace id.
--
-- `pg_advisory_xact_lock` rather than `select ... for update`: there is no row
-- to lock on a workspace whose first billing event this is, which is exactly
-- when `workspace_billing_customers` is empty.
--
-- WHAT STAYS IN JAVASCRIPT
-- -----------------------
-- The tier decision. `resolveWebhookTier` needs the STRIPE_PRICE_ID_* mapping,
-- which lives in the deployment's environment rather than in the database, so
-- the resolved tier and the built profile are passed in.
--
-- That decision reads the stored tier before the lock is taken, and it is worth
-- being precise about why that is not a second race. The stored tier is used
-- ONLY as a fallback when the price id is unrecognized, and only for a
-- non-entitling status — an entitling status with an unknown price refuses
-- outright. So the fallback path never grants access; it carries an existing
-- tier label forward while the billing state marks it inactive. A stale read
-- there can at worst attach a slightly outdated label to a workspace that is
-- being deactivated either way.
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
  p_from_sibling boolean default false
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
    (workspace_id, tier, billing_state, monthly_rate, payload, updated_at)
  values (p_workspace_id, p_tier, p_billing_state, p_monthly_rate, p_profile, now())
  on conflict (workspace_id) do update
    set tier = excluded.tier,
        billing_state = excluded.billing_state,
        monthly_rate = excluded.monthly_rate,
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
revoke all on function public.xbar_apply_subscription_event(
  uuid, text, text, timestamptz, jsonb, text, text, double precision, jsonb, text, text, text, integer, boolean
) from public;
revoke all on function public.xbar_apply_subscription_event(
  uuid, text, text, timestamptz, jsonb, text, text, double precision, jsonb, text, text, text, integer, boolean
) from anon;
revoke all on function public.xbar_apply_subscription_event(
  uuid, text, text, timestamptz, jsonb, text, text, double precision, jsonb, text, text, text, integer, boolean
) from authenticated;
grant execute on function public.xbar_apply_subscription_event(
  uuid, text, text, timestamptz, jsonb, text, text, double precision, jsonb, text, text, text, integer, boolean
) to service_role;

commit;

-- HOW TO APPLY THIS
-- -----------------
-- Not applied by this change.
--
-- It is additive and safe to run on a live database — one nullable column and
-- one index, no rewrite, no backfill, and no lock beyond a brief ACCESS
-- EXCLUSIVE for the ALTER:
--
--   psql "$DATABASE_URL" -f supabase/migrations/20260827_subscription_event_ordering.sql
--
-- Order relative to the other pending migrations does not matter; it touches
-- nothing they touch. Verify with:
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'workspace_subscription_events'
--      and column_name = 'stripe_event_created_at';
--
-- THIS IS A PREREQUISITE FOR THE WEBHOOK
-- --------------------------------------
-- api/stripe/webhook.js reads and writes this column on every subscription
-- event. Until it exists, that read errors, the handler throws, and Stripe
-- retries — no entitlement is written, which is the fail-closed direction, but
-- billing stops flowing. Apply this before the webhook goes live.
--
-- ROLLBACK
-- --------
--   drop index if exists public.workspace_subscription_events_workspace_created_idx;
--   alter table public.workspace_subscription_events drop column if exists stripe_event_created_at;
--
-- Dropping it removes the ordering guarantee rather than merely disabling it:
-- the handler's read starts erroring and every billing event is refused until
-- the column returns or the handler is changed back.

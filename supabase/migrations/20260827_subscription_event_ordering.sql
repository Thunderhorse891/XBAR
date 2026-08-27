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

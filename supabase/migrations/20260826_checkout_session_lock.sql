-- Serialize Checkout Session creation per workspace.
--
-- WHY A DATABASE COLUMN AND NOT A SMARTER KEY
--
-- Two API requests for the same workspace can both list Stripe's open sessions,
-- both see none, and both create an independently completable
-- `mode: 'subscription'` session. Completing both bills the customer twice and
-- leaves two webhook streams fighting over one entitlement row.
--
-- Two approximations were tried and both leak:
--
--   * A Stripe idempotency key including tier and seat count only ever
--     de-duplicated IDENTICAL submissions — and racing requests are the ones
--     most likely to differ (Professional in one tab, Enterprise in another).
--   * Scoping that key to the workspace and the current UTC minute fixed the
--     differing-intent case but not the boundary: two requests whose create
--     steps straddle :59 → :00 get different keys and both proceed.
--
-- Any key derived from time has that boundary somewhere. Serialization needs
-- shared state whose identity cannot change while competitors are in flight,
-- and the database is the only shared state this deployment has.
--
-- HOW IT WORKS
--
-- `checkout_lock_at` is claimed by a conditional UPDATE ... RETURNING. Postgres
-- serializes concurrent updates to the same row, so exactly one request sees a
-- returned row and proceeds; the others get nothing and refuse as retryable.
--
-- The lock is claimable again after two minutes rather than requiring release,
-- because the holder is a serverless function that can vanish mid-request. A
-- lock that only a live process can free is a lock that eventually wedges the
-- workspace out of buying anything. Two minutes is far longer than creating a
-- session takes and far shorter than a customer's patience.
--
-- APPLYING THIS
--
-- Not applied. It is additive and safe to run on a live database — one nullable
-- column and one partial index, no rewrite, no lock beyond a brief ACCESS
-- EXCLUSIVE for the ALTER:
--
--   psql "$DATABASE_URL" -f supabase/migrations/20260826_checkout_session_lock.sql
--
-- Order relative to the other pending migrations does not matter; it touches
-- nothing they touch. Verify with:
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'workspace_billing_customers'
--      and column_name = 'checkout_lock_at';
--
-- Rollback:
--
--   alter table public.workspace_billing_customers drop column if exists checkout_lock_at;
--
-- Dropping it does not break the endpoint's guard so much as remove it: the
-- claim query starts erroring, and the endpoint treats a failed claim as "not
-- acquired" and refuses. Fail-closed, which is the right direction, but it
-- means a rollback stops checkout rather than loosening it.

begin;

alter table public.workspace_billing_customers
  add column if not exists checkout_lock_at timestamptz;

comment on column public.workspace_billing_customers.checkout_lock_at is
  'When a Checkout Session creation claimed this workspace. Serializes concurrent checkouts; expires after 2 minutes so a dead serverless invocation cannot wedge the workspace.';

-- Only rows currently holding a lock are ever scanned by the claim query, and
-- there are very few of those at any moment.
create index if not exists workspace_billing_customers_checkout_lock_idx
  on public.workspace_billing_customers (checkout_lock_at)
  where checkout_lock_at is not null;

commit;

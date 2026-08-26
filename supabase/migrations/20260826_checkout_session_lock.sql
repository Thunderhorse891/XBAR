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
-- It also creates `xbar_claim_checkout_lock`, executable only by service_role —
-- the same rule 20260822 applies to every other function.
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

-- Who holds the lock, not merely that it is held.
--
-- Without this the release is unconditional, and an invocation that outlives
-- the two-minute expiry clears a lock it no longer owns: request A stalls past
-- the TTL, B legitimately reclaims, A finishes and wipes the row, and C walks
-- in beside B. Two requests creating subscription sessions at once is the exact
-- state the lock exists to prevent, reached through the release rather than the
-- claim.
alter table public.workspace_billing_customers
  add column if not exists checkout_lock_token text;

comment on column public.workspace_billing_customers.checkout_lock_at is
  'When a Checkout Session creation claimed this workspace. Serializes concurrent checkouts; expires after 2 minutes so a dead serverless invocation cannot wedge the workspace.';

comment on column public.workspace_billing_customers.checkout_lock_token is
  'Which invocation holds the claim. The release matches on this so a request that outlived the expiry cannot clear a lock another request has since taken.';

-- Only rows currently holding a lock are ever scanned by the claim, and there
-- are very few of those at any moment.
create index if not exists workspace_billing_customers_checkout_lock_idx
  on public.workspace_billing_customers (checkout_lock_at)
  where checkout_lock_at is not null;

-- Claim the lock, creating the row if this workspace has never bought anything.
--
-- A plain conditional UPDATE cannot do this. `workspace_billing_customers` has
-- no row until the first purchase — the only writers are the checkout flow and
-- the webhook that runs after payment — so `update ... where workspace_id = $1`
-- matches nothing and reports "someone else holds it". That refuses every
-- FIRST checkout, which is the one path that has to work.
--
-- `insert ... on conflict do update ... where ... returning` is one statement
-- and therefore atomic: it either inserts the row (this request claims it) or
-- updates an existing row only when the lock is free or stale. When the WHERE
-- fails nothing is returned and the caller is told it did not claim.
--
-- Every other column has a default, so seeding with the id alone is enough; the
-- checkout flow fills the rest once Stripe has answered.
-- The two-argument version is dropped rather than replaced. `create or replace`
-- matches on the argument list, so creating the three-argument function beside
-- an already-applied two-argument one leaves BOTH callable — and the old one
-- claims without recording a holder, which is the defect this revision fixes.
drop function if exists public.xbar_claim_checkout_lock(uuid, timestamptz);

create or replace function public.xbar_claim_checkout_lock(
  p_workspace_id uuid,
  p_stale_before timestamptz,
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean;
begin
  insert into public.workspace_billing_customers as billing (workspace_id, checkout_lock_at, checkout_lock_token)
  values (p_workspace_id, timezone('utc', now()), p_token)
  on conflict (workspace_id) do update
    set checkout_lock_at = timezone('utc', now()),
        checkout_lock_token = p_token
    where billing.checkout_lock_at is null
       or billing.checkout_lock_at < p_stale_before
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

-- Same rule as 20260822: nothing is executable by PUBLIC or anon by default.
-- Only the API's service role calls this.
revoke all on function public.xbar_claim_checkout_lock(uuid, timestamptz, text) from public;
revoke all on function public.xbar_claim_checkout_lock(uuid, timestamptz, text) from anon;
revoke all on function public.xbar_claim_checkout_lock(uuid, timestamptz, text) from authenticated;
grant execute on function public.xbar_claim_checkout_lock(uuid, timestamptz, text) to service_role;

commit;

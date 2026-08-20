-- Reconcile subscription rows the previous status mapper mislabelled.
--
-- PROPOSED — NOT YET APPLIED. This one changes DATA, not schema. Run the
-- dry-run below and read its output before applying it.
--
-- WHY
-- ---
-- The mapper this branch replaces ended with a catch-all:
--
--     if (status === 'active' || status === 'trialing') return 'Active';
--     if (status === 'past_due' || status === 'unpaid'
--         || status === 'incomplete_expired') return 'Past Due';
--     return 'Manual Billing';          <-- everything else
--
-- So `canceled`, `paused`, `incomplete`, and any status Stripe added or that
-- arrived malformed were all stored as 'Manual Billing'. That state grants the
-- purchased tier, deliberately, because it means an operator chose to comp or
-- invoice the account outside Stripe.
--
-- Those rows are already in the database. Fixing the mapper does not touch
-- them, and neither does 20260820_entitlement_helpers_honor_inactive.sql — that
-- migration correctly keeps 'Manual Billing' entitled. So on an existing
-- deployment, every workspace that canceled, paused, or never completed its
-- first payment keeps full paid limits at the trigger level and full
-- entitlements from getWorkspaceEntitlements, until some later webhook happens
-- to update it. A canceled workspace may never receive another webhook at all.
--
-- WHY A BLANKET UPDATE IS SAFE HERE
-- ---------------------------------
-- Because nothing ever created a 'Manual Billing' row on purpose.
-- public.workspace_subscription_profiles is written from exactly one place in
-- the application — the Stripe webhook (api/stripe/webhook.js) — and the only
-- value it could ever have written for that column came from the mapper above.
-- There is no admin endpoint, no seed, and no operator tool that sets it. Every
-- such row is therefore a mislabelled Stripe status, not a deliberate comp.
--
-- The exception this cannot see: a row edited by hand in the Supabase
-- dashboard. That is exactly what the dry-run is for.
--
-- Going forward, comping an account is done with the XBAR_COMP_EMAILS
-- allowlist (api/_lib/comp-access.js), which the server mirrors to the client.
-- The mapper can no longer produce 'Manual Billing' from any Stripe status, so
-- this reconciliation is one-time rather than recurring.
--
-- DRY RUN — run this first, on its own, and review every row it returns
-- ---------------------------------------------------------------------
--   select p.workspace_id,
--          p.tier,
--          p.billing_state,
--          p.updated_at,
--          c.stripe_subscription_id,
--          c.stripe_price_id
--     from public.workspace_subscription_profiles p
--     left join public.workspace_billing_customers c using (workspace_id)
--    where p.billing_state = 'Manual Billing'
--    order by p.updated_at desc;
--
-- A row with a stripe_subscription_id is a lapsed Stripe subscription and
-- should be reconciled. A row WITHOUT one was never driven by Stripe, so if any
-- appear, they were created by hand: decide those individually before running
-- the update, and re-grant them afterwards through XBAR_COMP_EMAILS rather than
-- by re-setting the column.
--
-- WHAT THIS DOES
-- --------------
-- Moves those rows to 'Inactive', which is the state the current mapper would
-- have produced for the statuses involved. The purchased tier in `tier` is left
-- untouched, so nothing is lost: entitledTierForBillingState and the SQL
-- helpers resolve an Inactive workspace to Starter, and a workspace that
-- resubscribes is restored by the next webhook.
--
-- Idempotent: re-running matches nothing, because the mapper can no longer
-- create 'Manual Billing'.

begin;

update public.workspace_subscription_profiles
   set billing_state = 'Inactive',
       updated_at = now()
 where billing_state = 'Manual Billing';

commit;

-- AFTER APPLYING
-- --------------
-- Confirm nothing is left behind:
--
--   select count(*) from public.workspace_subscription_profiles
--    where billing_state = 'Manual Billing';   -- expect 0
--
-- Then spot-check one reconciled workspace through the API: it should report
-- the Starter feature set with its purchased tier still recorded, and the seat
-- and storage triggers should enforce Starter limits.

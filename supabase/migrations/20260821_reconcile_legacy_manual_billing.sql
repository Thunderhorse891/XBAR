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
-- WHICH ROWS THIS TOUCHES, AND WHICH IT WILL NOT
-- ----------------------------------------------
-- Only rows that are demonstrably Stripe-backed: a profile in 'Manual Billing'
-- whose workspace also has a workspace_billing_customers row carrying a
-- stripe_subscription_id. Those can only have come from the mapper above.
--
-- A 'Manual Billing' profile with no Stripe subscription behind it is left
-- alone. It was never written by the webhook, so it was created deliberately —
-- by hand, or by an invoicing arrangement — and downgrading it would revoke
-- access somebody granted on purpose.
--
-- XBAR_COMP_EMAILS is NOT a substitute for those rows, which is why they are
-- preserved rather than migrated and re-granted. The allowlist is keyed on
-- email rather than workspace, always grants Enterprise rather than a specific
-- tier, and is applied by the API — the database limit triggers read
-- workspace_subscription_profiles and never see it, so a comp expressed that
-- way would not raise the seat, storage or commercial caps the triggers
-- enforce.
--
-- Going forward the mapper can no longer produce 'Manual Billing' from any
-- Stripe status, so this reconciliation is one-time rather than recurring.
--
-- DRY RUN — run this first and read every row it returns
-- ------------------------------------------------------
--   select p.workspace_id,
--          p.tier,
--          p.billing_state,
--          p.updated_at,
--          c.stripe_subscription_id,
--          case when coalesce(c.stripe_subscription_id, '') <> ''
--               then 'will be reconciled'
--               else 'left alone — not Stripe-backed, decide by hand'
--          end as disposition
--     from public.workspace_subscription_profiles p
--     left join public.workspace_billing_customers c using (workspace_id)
--    where p.billing_state = 'Manual Billing'
--    order by disposition, p.updated_at desc;
--
-- Rows marked 'left alone' are the ones this migration cannot judge. If any of
-- them are in fact lapsed Stripe subscriptions, reconcile them individually.
--
-- WHAT THIS DOES
-- --------------
-- Moves the matching rows to 'Inactive', the state the current mapper would
-- have produced for the statuses involved.
--
-- Both copies of the billing state are updated, and that matters: the column
-- is what the API and the database triggers read, but the client reads the
-- `payload` JSON and gates on it. Updating only the column would leave the API
-- and triggers enforcing Starter while the UI kept granting the former paid
-- tier from a payload that still said 'Manual Billing'.
--
-- The payload's tier and limits are deliberately NOT rewritten here. Doing so
-- would mean restating the whole plan matrix — including feature-flag copy — in
-- SQL, where it would drift from api/_lib/subscription-plans.js. Instead the
-- client clamps a payload to its billing state on the way in
-- (restorePersistedState in src/store/xbarStoreHelpers.ts), so the corrected
-- billingState is enough to bring the UI down to the baseline. That clamp also
-- covers payloads this migration never sees — including the window between a
-- subscription lapsing and the next webhook.
--
-- `tier` is left untouched in both places, so nothing is lost: the purchased
-- plan is still recorded, and a workspace that resubscribes is restored by the
-- next webhook.
--
-- Idempotent: re-running matches nothing, because the mapper can no longer
-- create 'Manual Billing'.

-- VERIFIED ON POSTGRESQL 16
-- -------------------------
-- Applied to a fixture covering the three cases that matter. What the dry-run
-- should predict, and what the migration then does:
--
--   profile                          stripe_subscription_id   result
--   Enterprise / Manual Billing      sub_legacy_cancelled     -> Inactive
--                                                                (column AND
--                                                                 payload)
--   Professional / Manual Billing    (none)                   -> untouched
--   Ranch Ops / Active               sub_live                 -> untouched
--
-- The purchased tier is preserved in every case; only billing_state moves. The
-- payload is updated as well because that is the field the client's ingest
-- clamp reads — moving the column alone would leave the UI granting the old
-- tier until another webhook arrived, which a canceled subscription may never
-- send.

begin;

-- REQUIRES AN EXPLICIT DECISION. Applying this file on its own changes nothing.
--
-- Two reasons this is not automatic.
--
-- First, `supabase db push` applies every pending migration in one command, so
-- a data change that must be reviewed cannot rely on the operator stopping in
-- the middle. Left as a plain UPDATE, it would run before anyone read the
-- dry-run above.
--
-- Second, and more important: a populated stripe_subscription_id proves the
-- workspace was billed through Stripe at some point. It does NOT prove the
-- CURRENT 'Manual Billing' value came from the old mapper. An operator who
-- deliberately moved a paying customer onto manual invoicing — or comped them
-- after they had been paying — leaves exactly the same trace, and this file
-- would revoke their entitlements. There is no way to tell those apart from
-- inside the database, so the choice belongs to a person.
--
-- To run it, after reading the dry-run output:
--
--     set local xbar.reconcile_confirmed = 'yes';
--     -- and, for any row the dry-run showed that is a deliberate grant:
--     set local xbar.reconcile_exclude = '<uuid>,<uuid>';
--
-- Both are session settings, so they cannot be left on by accident.
do $$
declare
  confirmed  text := coalesce(current_setting('xbar.reconcile_confirmed', true), '');
  raw_excl   text := coalesce(current_setting('xbar.reconcile_exclude', true), '');
  excluded   uuid[];
  changed    integer;
begin
  if confirmed <> 'yes' then
    raise notice 'xbar: reconciliation SKIPPED — no rows changed.';
    raise notice 'xbar: read the dry-run at the top of this file, then re-run with';
    raise notice 'xbar:   set local xbar.reconcile_confirmed = ''yes'';';
    return;
  end if;

  -- A malformed uuid raises here rather than being silently dropped: a typo in
  -- an exclusion must not quietly downgrade the workspace it was meant to save.
  excluded := coalesce((
    select array_agg(trim(value)::uuid)
    from unnest(string_to_array(raw_excl, ',')) as value
    where trim(value) <> ''
  ), '{}'::uuid[]);

  update public.workspace_subscription_profiles p
     set billing_state = 'Inactive',
         payload = jsonb_set(
           coalesce(p.payload, '{}'::jsonb),
           '{billingState}',
           '"Inactive"'::jsonb,
           true
         ),
         updated_at = now()
   where p.billing_state = 'Manual Billing'
     and not (p.workspace_id = any(excluded))
     and exists (
       select 1
         from public.workspace_billing_customers c
        where c.workspace_id = p.workspace_id
          and coalesce(c.stripe_subscription_id, '') <> ''
     );

  get diagnostics changed = row_count;
  raise notice 'xbar: reconciled % row(s); % excluded by request.', changed, coalesce(array_length(excluded, 1), 0);
end
$$;

commit;

-- AFTER APPLYING
-- --------------
-- Confirm only deliberate rows are left:
--
--   select p.workspace_id, c.stripe_subscription_id
--     from public.workspace_subscription_profiles p
--     left join public.workspace_billing_customers c using (workspace_id)
--    where p.billing_state = 'Manual Billing';
--
-- Every row returned should be one you recognise as an intentional manual
-- account. None should carry a stripe_subscription_id.
--
-- Then spot-check one reconciled workspace: the API should report the Starter
-- feature set with its purchased tier still recorded, the seat and storage
-- triggers should enforce Starter limits, and the app should show the baseline
-- rather than the former paid tier.

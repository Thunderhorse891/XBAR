# Monthly checkout release (draft)

## Scope

This change starts from the deployed main baseline and enables only new USD monthly Professional (1999 cents) and Ranch Ops (4999 cents) sales, at quantity one. It leaves the existing zero-charge Starter setup and optional 14-day trial in place. It does not introduce the approved Free plan, change existing access, enable feature upgrade offers, add dedicated storage, or apply a database migration. Starter and Enterprise sales, annual sales, and static Payment Link fallback are not offered anew. Legacy access, rates, open-purchase recovery and billing management remain.

## Account and price gates

1. Privately verify the existing production Stripe key's account with [Stripe's authenticated account endpoint](https://docs.stripe.com/api/accounts/retrieve), using a secure operator flow that outputs only a match/no-match. Verify the signing endpoint uses that same account. The historical catalog runbook and the newer approved catalog were recorded in different accounts. Do not swap the production key or webhook to another account as a shortcut. Reconcile app-linked billing objects, any open sessions, existing subscriptions, receipts and rates against Stripe in the confirmed account before enabling sales. If the approved prices are not in that account, stop for the owner to choose the path.
2. Set the verified account pin and two approved current Price mappings in production scope only. Preserve any replaced IDs in the entitlement-only legacy mapping, as well as original Starter, Enterprise and annual mappings. Inspect portal settings and externally circulated links for legacy offers, without changing existing subscriptions. Never paste IDs or secrets into a public diagnostic.
3. Verify actual Price account, live mode, recurring monthly USD amount, active product and one flat quantity. Health and public checkout GET reveal configuration readiness only. Both are insufficient to establish a signed delivery or entitlement. The hosted preview must use Stripe test mode; production only accepts live mode.

## Zero-charge rehearsal

- In an isolated preview deployment use Stripe sandbox keys, two test-mode Prices matching the full sale contract, a sandbox-only webhook and an already authorized disposable Supabase project or local PostgreSQL/Supabase. Do not copy any production data, credentials, notification settings or environment overrides. Keep feature upgrade offers off. Pin the sandbox account; set the preview origin for Auth redirects, API and the checkout return. Do not repurpose the production webhook endpoint.
- Confirm a sandbox webhook can reach the preview callback without exposing the preview UI or relaxing production protection. Verify endpoint signing, workspace metadata and delivery status for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.payment_failed`. Use distinct synthetic admin workspaces for each price; also verify non-admin denial, a cancelled purchase, repeat click/reused session, and success without a completed purchase never granting access.
- Manually complete Checkout with [Stripe test payment details](https://docs.stripe.com/testing) only after confirming it is a sandbox page. Verify quantity one, displayed amount/tax/cadence, test receipt in Stripe, actual test delivery and matching profile tier and exact recorded rate after return/reload. Resend the same event and test an out-of-order event without changing entitlement. Use a synthetic existing legacy price to verify renewal retains historical amount, cadence and entitlement. Never enter a live card or replay a live event.
- Hosted live production verification requires separate authorization for consequential actions. A verified noncharging live review, if approved and done, proves session terms only. It creates live session/billing records even without payment. Never complete a real transaction simply to test.

## Rollback order

1. Disable new session creation with the server managed-billing switch and remove the app purchase entry with its client switch, using the authorized production release workflow. Keep the new webhook and both current/historical price maps serving existing entitlements. Check in-flight/newly completed sessions and resolve them with the operator. Disabling creation does not invalidate open Stripe sessions.
2. Prefer a forward stop-sale release that keeps the verified webhook. A Vercel alias rollback to an old build can restore old compiled checkout options and old environment bindings, and old webhook code can misrecord decimal or historical prices. Do not alias-rollback after the new prices have been offered until the rollback build's webhook recognizes current and legacy IDs and preserves billed amounts, and webhook delivery during the transition is understood. Do not delete customers, subscriptions, events or Supabase records.
3. Verify the exact deployment SHA, stop-sale behavior, signed webhook continuity and existing access. Each production configuration change or release action requires the governing approvals.

## Separate Free tier

The exact draft migration is `supabase/migrations/20261112120000_distinct_free_tier.sql` on [draft #396 at its verified head](https://github.com/Thunderhorse891/XBAR/blob/17d4f3c53c20143a1794ff2a301225ed73089980/supabase/migrations/20261112120000_distinct_free_tier.sql). It sets the two profile defaults and replaces the five resource-limit helpers and triggers in one transaction. It does not require the three later Storage-policy/accounting migrations to install the entitlement itself. Existing rows aren't rewritten; paid/Manual Billing tiers and unexpired trials remain, and existing records are retained. It changes the inactive/missing baseline to 2 horses, 1 seat, 10 active documents and no new sale packets. Internal storage ceilings do not provision hosting.

Use only the authorized database migration owner with existing DDL rights, never the application service role. Snapshot the two defaults, the exact hosted definitions of the five functions, their owners/ACLs and trigger associations. Rehearse the migration and inverse from that snapshot against a disposable copy of the production schema, running `supabase/checks/distinct-free-tier.sql` and the full Free/RLS/trial/record-write CI contract. Pair with the matching app build; the legacy app and new quota schema disagree about what a no-charge workspace can add. Rollback must restore the prior definitions and defaults in a transaction and keep all records, trials, profiles and billing/events; prove both directions before authorization. Do not assume a Starter record with zero cost should be reclassified without reviewing its billing provenance.

### Read-only Stripe sandbox preflight

Run `npm run preflight:stripe-sandbox` on this exact revision using the approved
isolated runner. Supply a test-only `STRIPE_SECRET_KEY` through the approved
secret store, the confirmed sandbox account as `STRIPE_ACCOUNT_ID`, and the
two approved sandbox monthly price mappings. It uses the checkout contract and
rejects legacy aliases, missing configuration, live credentials, a production
environment marker, an account mismatch, or a non-test price. It does not print
keys, account or Price IDs. It does not create payments or mutate Stripe,
Supabase, or deployment settings. A pass verifies provider reads from that
runner; it is not proof of app-originated Checkout or genuine signed delivery.

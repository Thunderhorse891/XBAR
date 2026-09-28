# September 28 critical launch repairs

Baseline: `origin/main` and READY production deployment
`6d6d9273d0a4cd31371e916452d8fba070189ece`.
Live project: `xbar-records` (`uxvwfepyothlakhqazwv`).

## Applied and verified database repair

The owner requested execution of the attached September 28 critical fixes.
Before changes, direct schema inspection reproduced the missing billing column,
old 14-argument event RPC, missing trial predicate, public horse-media bucket,
and missing media SELECT policy. Horse media contained zero objects.

The following source migrations were applied **in order in one transaction**
under the hosted ledger name
`xbar_launch_billing_trial_private_media_reconciliation`:

1. `20260924120000_billing_period.sql`
2. `20260924130000_trial_entitlement.sql`
3. `20260924134000_horse_media_private_signed_urls.sql`
4. `20260924223000_preserve_trial_in_event_rpc.sql`
5. `20260926000000_trial_dates_fail_closed.sql`, including SQLSTATE 22009
6. `20260926003000_atomic_trial_event_merge.sql`

These are bundled ledger entries, not six missing changes to apply again.
Do not blindly replay the directory: the billing-period file uses CREATE
FUNCTION and is not re-runnable after the new signature exists.
Earlier document policies were left intact because their live definitions
already exist despite a different ledger history.

`trial_helper_private` was applied afterward from
`20260928120000_trial_helper_private.sql`: Supabase default grants had exposed
the new internal predicate despite the original source's intent.

Verification:

- Disposable PGlite PostgreSQL reproduced the malformed-date exception,
  then passed trial capacity/date contracts, ordered migration application,
  and correction reapplication.
- Live catalog checks confirmed one 15-argument billing RPC, nullable billing
  period, private media and SELECT policy, valid trial acceptance, malformed
  timezone denial, and denial of anonymous/authenticated billing RPC execution.
- A live transaction created a disposable workspace, saved six horses during
  its trial, applied an annual event, and asserted trial-history preservation
  and billing-mirror equality. The transaction rolled back all fixtures.
  This is database behavior evidence, not a Stripe checkout or browser test.
- `supabase/checks/launch-readiness.sql` is the repeatable, read-only schema gate.

## Recovery

Before application, the existing function bodies, ACLs and bucket definition
were captured locally under ignored `.scratch-e2e/production-schema-before.json`.
No customer rows were rewritten by these migrations. This is a targeted schema
recovery snapshot, not a complete customer backup or a restore rehearsal.

Prefer a forward correction. Reverting the billing RPC would break the deployed
webhook's named argument. If a coordinated rollback is necessary, pause checkout,
deploy a compatible webhook first, explicitly drop the 15-argument RPC, restore
the captured 14-argument function and grants, and retain the nullable billing
column to preserve recorded periods. Keep media private; reopening public access
is not an acceptable default recovery action.

## Code corrections

- Integrate existing PRs #266 and #267 with preserved history; complete #267's
  invalid-timezone correction. The newer endpoint regression now expects the
  truthful subscription-conflict result when a conditional update loses a race.
- Reminder insert/update errors and zero affected rows no longer report success.
  Failed batches return 500; completed counts require confirmed writes. Email
  counts describe provider acceptance. Retries can still duplicate an email or
  notification after partial completion; exactly-once delivery is not claimed.
- Configured shared rate limiter failures, malformed responses and Redis command
  errors return 503 with Retry-After. Unconfigured environments retain the existing
  per-instance limiter; this does not establish a shared production boundary.
- Packet generation creates a sales lead without claiming a share. Sellers can
  explicitly log sharing after sending the packet.

## Remaining launch gates

- Vercel deployment inspection works, but the project-detail connector fails
  validation and saved CLI credentials return Forbidden. Environment mutation
  access is unverified. Email and CRON_SECRET configuration remain outstanding.
- The connected XBAR sandbox has no webhook endpoints. Production Stripe account
  alignment, Checkout, webhook entitlement, failure/cancellation, and renewal
  tests remain unverified. No charge was made and no new Stripe configuration
  was invented without the ability to connect it to the deployment.
- Real-email signup/reset, a full backup/restore rehearsal, branded cloud packet
  hero/AQHA layout, and actual-device iOS verification remain open.
- Existing GraphQL/security advisor findings, broad CSP, scale warnings, and
  moderate Capacitor dependency advisories need separate scoped verification.
- This record does not declare the product launch-ready.

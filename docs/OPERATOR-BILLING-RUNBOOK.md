# Operator billing runbook — manual grants, comps, revocation and repricing

Self-serve checkout is the primary way XBAR gets paid. A buyer picks a plan,
pays by card on Stripe Checkout, and the Stripe webhook writes their
`workspace_subscription_profiles` row with `billing_state = 'Active'`. Nothing
on this page is needed for that path.

This page is for everything that is not a plain self-serve purchase: a ranch
that pays by invoice or check, an annual deal, a comp, a revocation, and
changing prices without locking existing subscribers out.

---

## Before the first sale

1. **The database must not be paused.** Supabase stays on the free tier until
   launch (owner's decision). A free project pauses after about seven days with
   no database activity; Supabase emails a warning about a week ahead, and a
   paused project can be restored from the dashboard for 90 days. A paused
   project means every customer sees a dead app. Check the project status
   before you sell anything.
2. **Read `/api/health` on production.** It must answer `200` with
   `checks.billingReady: true`. Read its `reasons` (each one blocks billing)
   and `warnings` (each one is a promise the product is not keeping yet):
   - `subsystems.stripeLiveKey` must be `true` in production. `false` with
     `stripeBilling: true` means a test key: checkout works, no money moves.
   - A warning about `STRIPE_PRICE_ID_*_ANNUAL` means annual checkout refuses
     on those plans.
   - A warning about email means welcome, trial, payment-failed and packet
     emails are not being sent. Set `RESEND_API_KEY` (or `SENDGRID_API_KEY`)
     and an `EMAIL_FROM_ADDRESS` on a domain verified with that provider.

   Health proves each value is the right _kind_ of value without calling
   Stripe. `npm run preflight` and one controlled real purchase prove they are
   the right account's.

3. **Prices.** Annual is 10× monthly (two months free). Checkout takes cards
   only.

   | Tier         | Monthly | Annual    | Notes                                                |
   | ------------ | ------- | --------- | ---------------------------------------------------- |
   | Starter      | $12/mo  | $120/yr   | 5 horses, 1 seat                                     |
   | Professional | $29/mo  | $290/yr   | sale packets and buyer folders — the tier that sells |
   | Ranch Ops    | $79/mo  | $790/yr   | teams, breeding, equipment at scale                  |
   | Enterprise   | $199/mo | $1,990/yr | large rosters                                        |

   Managed checkout sells the Stripe Price ids in `STRIPE_PRICE_ID_<TIER>` and
   `STRIPE_PRICE_ID_<TIER>_ANNUAL`. Hosted Payment Links
   (`VITE_STRIPE_PAYMENT_LINK_*`, `..._ANNUAL`) are the fallback when managed
   checkout is off; a link payment is granted by hand (below), because no
   webhook ties it to a workspace. If you use links, turn on **collect customer
   email** in each link's settings — that email is how you find the workspace.

---

## Granting a tier after someone pays outside checkout

Two values decide access: `tier` and `billing_state`. The database derives
seat, storage, document and horse limits from them — you never set limits by
hand. `monthly_rate` is the plan's monthly list rate, for reporting;
`billing_period` is the cadence the app shows on the billing screen.

`'Manual Billing'` means _an operator granted this deliberately, outside
Stripe_. It entitles the tier, and the reconciliation in
`20260821_reconcile_legacy_manual_billing.sql` leaves these rows alone so a
hand-granted account is never downgraded by a cleanup.

### 1. Find the workspace

```sql
select w.id as workspace_id, w.name, m.email, m.role
from public.workspaces w
join public.workspace_memberships m on m.workspace_id = w.id
where lower(m.email) = lower('buyer@example.com');
```

No rows: they have not signed up yet. Have them create the account first — the
grant needs a workspace. More than one row: read `role` and take the owner's
workspace.

### 2. Grant the tier

```sql
insert into public.workspace_subscription_profiles
  (workspace_id, tier, billing_state, monthly_rate, billing_period)
values ('PASTE-WORKSPACE-UUID', 'Professional', 'Manual Billing', 29, 'monthly')
on conflict (workspace_id) do update
  set tier           = excluded.tier,
      billing_state  = excluded.billing_state,
      monthly_rate   = excluded.monthly_rate,
      billing_period = excluded.billing_period,
      updated_at     = now();
```

`tier` must be exactly `Starter`, `Professional`, `Ranch Ops` or `Enterprise`.
The strings are compared literally: a typo is not an error, it silently gives
the workspace Starter limits. `billing_period` is `'monthly'` or `'annual'`
(the column refuses anything else).

### 3. Confirm it took

```sql
select tier, billing_state, monthly_rate, billing_period, updated_at
from public.workspace_subscription_profiles
where workspace_id = 'PASTE-WORKSPACE-UUID';
```

Then have the customer **reload the app** and check the billing screen shows the
plan and cadence they bought. The reload is required — the client normalizes
its stored subscription on load.

---

## Revoking or downgrading

The database entitles a tier only while `billing_state` is `'Active'` or
`'Manual Billing'` (read from production's `xbar_subscription_limits`,
2026-10-02). Every other state — `'Inactive'`, `'Past Due'`, anything else —
gets Starter limits, unless an unexpired trial says otherwise.

- Canceled, lapsed, or revoked: `'Inactive'`.
- A payment that failed but may still recover: `'Past Due'`.

Leave `tier` as it was. It records what was bought, which is how the billing
screen names the plan that lapsed and how recovery restores it; it grants
nothing on its own.

```sql
update public.workspace_subscription_profiles
set billing_state = 'Inactive',
    updated_at    = now()
where workspace_id = 'PASTE-WORKSPACE-UUID';
```

**Cancel the Stripe subscription too.** Revoking in the database does not stop
the charge, and charging someone you have cut off is the worst version of this
mistake.

---

## Comping an account (yourself, QA, a demo)

Do not hand-write a profile row for this. Use the `XBAR_COMP_EMAILS` environment
allowlist — a comma-separated list of emails granted full entitlements by the
API regardless of billing tier. It is off by default and empty means nobody.

Be aware of what it does **not** do: it is keyed on email rather than workspace,
always grants Enterprise rather than a specific tier, and is applied by the API
only. The database limit triggers read `workspace_subscription_profiles` and
never see it, so a comp expressed this way does not raise the seat, storage or
document caps the triggers enforce. For a comp that must behave exactly like a
paid account, grant a real profile row with `'Manual Billing'` instead.

---

## Changing prices without locking anyone out

A Stripe Price pins its amount, so a new price is a new Price id. Existing
subscribers stay on their old id until they change plan. The webhook refuses
to grant access on a price it cannot place, so an old id that the deployment no
longer recognizes would cost a paying customer their access at their next
renewal.

1. Create the new Prices in Stripe. **Do not archive or delete the old ones**
   while anyone is billed on them.
2. Put the new ids in `STRIPE_PRICE_ID_<TIER>` / `..._ANNUAL`. Only these are
   sold to new buyers.
3. Move every replaced id into `STRIPE_LEGACY_PRICE_IDS`, comma-separated, as
   `price_id=Tier:monthly` or `price_id=Tier:annual`:

   ```
   STRIPE_LEGACY_PRICE_IDS="price_1OldPro=Professional:monthly, price_1OldProY=Professional:annual"
   ```

   These are recognized for existing subscribers and never offered at checkout.

4. Redeploy and read `/api/health`. An entry it cannot read exactly — an
   unknown tier, a missing cadence, an id listed twice with different meanings,
   or an id that is also a current price — fails readiness and is named in
   `reasons`. It is never mapped to a guess.
5. Update the price table above and the pricing page in the same change.

## Feature-click upgrade offers: release gates

This implementation is inactive by default. Do not point it at an unrelated
Stripe account or create a coupon merely to remove an unavailable-state message.
A connected Stripe plugin account is not proof that the deployed server key uses
that account. No live coupon, customer, subscription, portal configuration, or
migration was changed as part of the local implementation.

1. Get explicit approval for `20261003200000_upgrade_offers.sql`; rehearse the
   migration and `supabase/checks/upgrade-offers.sql` on a disposable database.
2. Verify `STRIPE_UPGRADE_ACCOUNT_ID` against the account reached by the server
   key. Set `STRIPE_UPGRADE_LIVEMODE` deliberately; production requires `true`.
   All target prices are retrieved and checked against the canonical plan
   amounts, USD, active product, one-month/one-year licensed recurring interval,
   and expected Stripe mode before any amount is displayed.
3. Review an existing `STRIPE_UPGRADE_COUPON_ID`: exactly 10 percent, duration
   `once`, valid, unexpired, with redemptions remaining and applicable to each
   target product. Never use a forever/repeating coupon. With no valid coupon,
   the UI honestly offers verified regular price. A checkout request cannot
   silently replace a displayed discount with full price.
4. For paid subscription changes, review a dedicated existing
   `STRIPE_UPGRADE_PORTAL_CONFIGURATION_ID`. It must enable price changes to the
   actual target products/prices, set `billing_cycle_anchor=now` and
   `proration_behavior=always_invoice`, and have no period-end scheduling
   conditions. The hosted confirmation shows unused-time credits, taxes, the
   new billing date and recurring terms. Do not alter a shared default portal
   blindly. Current implementation supports one quantity-1 classic-mode active
   subscription, a paid latest invoice, and no pending/scheduled/canceled,
   paused, existing-discount, or ambiguous billing state. Other states are sent
   to billing review rather than creating a second subscription.
5. Keep `STRIPE_UPGRADE_PAID_CONFIRMATIONS_VERIFIED=false`. Stripe portal sessions
   cannot be invalidated via the API. Unopened sessions expire after five
   minutes; opened sessions can last one hour from their latest activity. The
   application's four-minute reopen guard **does not revoke an already handed
   out URL**. All new direct paid-subscription confirmation sessions are therefore
   unavailable by default, including full-price ones. Customers can use the
   existing standard billing-management portal, which is unchanged.
6. Before setting the separate paid-confirmations verification flag, use the
   correct authorized Stripe sandbox to prove all of the following: open a
   discounted upgrade then a different feature/plan confirmation; complete them
   in each order; revisit and repeatedly confirm the earlier URL; retry after
   a network timeout and an expired page; change plan/cadence in another tab;
   verify only the intended existing subscription was changed, no coupon was
   reapplied, no unintended cycle reset occurred, and the renewal invoice uses
   normal price. Check exact Stripe subscription, invoice, discount and event
   records. If stale/sibling confirmations are unsafe, leave the flag false and
   design an enforceable confirmation strategy before release.
7. With the approved account, price/coupon proof and migration in place, enable
   `UPGRADE_OFFERS_ENABLED=true`. Run the full customer flow: first deliberate
   feature click; decline; exact second click with a new request UUID; verify
   one-period discounted subtotal; confirm in Stripe; process webhook; refresh
   entitlement. Test monthly and annual, repeated click/retry, third attempt,
   account/workspace switches, a second feature after a discount was claimed,
   and an existing paid subscription. New-subscription Checkout expires stale
   sibling sessions under the existing shared billing lease.

Attempt history is per account and feature across devices/workspaces. Discount
checkout is at most once per account across all features; the reservation is
made before calling Stripe and survives timeouts and workspace deletion. A
failed reservation is not reset by deleting local storage or making another
workspace. A declined or old request cannot create a new checkout. Hosted
payment/subscription confirmation is always required; opening an offer does not
charge money or grant entitlements.

Local verification covers injected Stripe/Supabase boundaries and the real SQL
state machine on an isolated PostgreSQL engine. It is not evidence of live
Stripe prices, promotion availability, payment settlement, webhook delivery,
portal stale-link safety, or production migration application.

Stripe references:

- [Portal deep-link confirmations and discounts](https://docs.stripe.com/customer-management/portal-deep-links)
- [Portal session lifetime](https://docs.stripe.com/customer-management)
- [Customer portal billing-cycle anchors](https://docs.stripe.com/changelog/clover/2025-12-15/customer-portal-billing-cycle-anchor)
- [Coupon duration semantics](https://docs.stripe.com/api/coupons)

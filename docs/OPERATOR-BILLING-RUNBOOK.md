# Operator billing runbook — taking money before managed checkout exists

This is how XBAR gets paid **today**, with Stripe Payment Links and a grant you
run by hand. It needs no code deploy, no Stripe webhook, no `MANAGED_BILLING_ENABLED`,
and none of the self-serve checkout work.

It exists because self-serve checkout is a scaling fix, not a revenue unlock.
The first customers can be served entirely from this page. Do not wait on the
checkout pipeline to start selling.

---

## Before the first sale

1. **The database must not be paused.** The Supabase free tier auto-pauses a
   project after about a week idle, and a paused project means every customer
   sees a dead app with no warning to you. Check the project status before you
   sell anything.
2. **Be on Supabase Pro.** This is the single cheapest thing that separates a
   product from a demo. A paying rancher whose records are on a database that
   sleeps is a refund and a bad word in a small community.
3. **Create one Stripe Payment Link per tier**, in the Stripe dashboard. No code.
   Set each to a recurring monthly price:

   | Tier         | Price   | Notes                                                |
   | ------------ | ------- | ---------------------------------------------------- |
   | Starter      | $29/mo  | 5 horses, 1 seat                                     |
   | Professional | $79/mo  | sale packets and buyer folders — the tier that sells |
   | Ranch Ops    | $199/mo | teams, breeding, equipment at scale                  |
   | Enterprise   | $499/mo | large rosters                                        |

   In each link's settings, turn on **collect customer email**. That email is
   how you find their workspace in step 2 below.

---

## Granting a tier after someone pays

Two values decide everything: `tier` and `billing_state`. The database derives
seat, storage, document and horse limits from `tier` on its own — you do not set
limits by hand. `monthly_rate` is for your own reporting.

`'Manual Billing'` is the state that says _an operator granted this deliberately,
outside Stripe_. It grants the purchased tier, by design, and the reconciliation
in `20260821_reconcile_legacy_manual_billing.sql` deliberately leaves rows like
these alone precisely so a hand-granted account is never downgraded by a cleanup.

### 1. Find the workspace from the email Stripe collected

```sql
select w.id as workspace_id, w.name, m.email, m.role
from public.workspaces w
join public.workspace_memberships m on m.workspace_id = w.id
where lower(m.email) = lower('buyer@example.com');
```

If this returns nothing, they have not signed up yet. Have them create the
account first — the grant needs a workspace to attach to.

If it returns more than one row, read the `role` column and take the `Owner`.

### 2. Grant the tier

```sql
insert into public.workspace_subscription_profiles
  (workspace_id, tier, billing_state, monthly_rate)
values ('PASTE-WORKSPACE-UUID', 'Professional', 'Manual Billing', 79)
on conflict (workspace_id) do update
  set tier          = excluded.tier,
      billing_state = excluded.billing_state,
      monthly_rate  = excluded.monthly_rate,
      updated_at    = now();
```

`tier` must be exactly one of `Starter`, `Professional`, `Ranch Ops`,
`Enterprise` — the strings are compared literally, and a typo silently produces
an unrecognised tier rather than an error.

### 3. Confirm it took

```sql
select tier, billing_state, monthly_rate, updated_at
from public.workspace_subscription_profiles
where workspace_id = 'PASTE-WORKSPACE-UUID';
```

Then have the customer **reload the app** and check the billing screen shows the
tier they bought. A reload is required, not optional — the client normalizes its
stored subscription on rehydrate.

---

## Revoking or downgrading — read this before you need it

**Setting `billing_state = 'Inactive'` does not revoke access until migration
`20260820_entitlement_helpers_honor_inactive.sql` has been applied.**

The helper currently live in production comes from
`20260611_commercial_entitlements.sql`, and it demotes on exactly one value:

```sql
case when billing_state = 'Past Due' then 'Starter' else tier end
```

Everything else — `Inactive`, `Manual Billing`, a canceled subscription, an
empty string — keeps the full purchased tier. So on today's database:

- To actually cut access off, set **`'Past Due'`**, not `'Inactive'`.
- Once `20260820` is applied, `'Inactive'` becomes the correct value and
  `'Past Due'` keeps its own meaning (a payment that failed but may recover).

Whichever you use, drop the tier as well rather than relying on the state alone:

```sql
update public.workspace_subscription_profiles
set tier          = 'Starter',
    billing_state = 'Past Due',   -- 'Inactive' once 20260820 is applied
    monthly_rate  = 0,
    updated_at    = now()
where workspace_id = 'PASTE-WORKSPACE-UUID';
```

Setting `tier` down is what makes this safe on either side of that migration.

**Cancel the Stripe subscription too.** The payment link created a real recurring
subscription; revoking in the database does not stop the charge, and charging
someone you have cut off is the worst version of this mistake.

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

## What changes when managed checkout goes live

Once `MANAGED_BILLING_ENABLED=true` and the Stripe webhook are both configured,
the webhook writes these same rows for you and `billing_state` becomes `'Active'`
rather than `'Manual Billing'`. Nothing in this runbook stops working — the two
paths coexist deliberately, and hand-granted rows are protected from the
reconciliation precisely so they survive the transition.

Keep using this page for anything that is not a plain self-serve purchase:
invoiced ranches, annual deals, comps, and anyone who would rather write you a
check than type a card number. In this market that is not an edge case.

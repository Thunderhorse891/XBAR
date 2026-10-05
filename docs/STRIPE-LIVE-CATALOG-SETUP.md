# XBAR live billing configuration

The approved live catalog was created and read back on October 4, 2026 in Stripe account `acct_1NF0M3HcLUCzzEB3`. These identifiers are not credentials. Creating the catalog does not configure Vercel or prove that checkout works.

## Production environment mapping

The deployment owner must set these values in the **Production** environment of Vercel project `xbar-horse-management-app`, team `thunderhorse891s-projects`, then redeploy. Preserve unrelated environment variables. Do not copy live values to preview or development accidentally.

```dotenv
STRIPE_ACCOUNT_ID=acct_1NF0M3HcLUCzzEB3
STRIPE_PRICE_ID_STARTER=price_1UMuV5HcLUCzzEB3ZgbDgTa5
STRIPE_PRICE_ID_STARTER_ANNUAL=price_1UMuVeHcLUCzzEB3aQMGT5uq
STRIPE_PRICE_ID_PROFESSIONAL=price_1UMuVFHcLUCzzEB30yDImbc6
STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL=price_1UMuViHcLUCzzEB3HxjozirP
STRIPE_PRICE_ID_RANCH_OPS=price_1UMuVIHcLUCzzEB3FniNo6hM
STRIPE_PRICE_ID_RANCH_OPS_ANNUAL=price_1UMuVnHcLUCzzEB3lYqFMcwx
STRIPE_PRICE_ID_ENTERPRISE=price_1UMuVMHcLUCzzEB38Ovh31ev
STRIPE_PRICE_ID_ENTERPRISE_ANNUAL=price_1UMuVsHcLUCzzEB3SEbru6Mp
```

Catalog rates are USD: Starter $12/month or $120/year; Professional $29/month or $290/year; Ranch Ops $79/month or $790/year; Enterprise $199/month or $1,990/year. All eight prices are active, live, licensed, per-unit recurring prices with interval count 1. Annual rates are totals charged each year.

## Credential and webhook boundary

The owner must privately verify that the existing Production `STRIPE_SECRET_KEY` belongs to the account above. If it does not, configure the correct credential directly in Vercel's secure environment-variable UI. Never paste, print, commit, or send a secret key in chat or diagnostics. The account pin checks identity using Stripe's existing server-side client; an unreadable or mismatched account refuses checkout.

The existing webhook secret must correspond to the same account's webhook endpoint at `https://xbar-horse-management-app.vercel.app/api/stripe/webhook`. Catalog creation did not create or change a webhook, signing secret, portal configuration, subscription, or payment. A key-shaped value or a `whsec_` prefix is not proof of valid configuration.

Environment-variable metadata access was denied by Vercel (403 `projectEnvVars`); none of these values was applied by this code change. Production account identity and webhook delivery therefore remain unverified. Do not describe billing as repaired or launch-ready until configuration and the real workflow have been verified.

## Verification

1. Confirm the production deployment uses the intended commit and environment values.
2. Confirm `/api/health` recognizes both monthly and annual price configuration. This route checks configuration shape, not Stripe account ownership or webhook delivery.
3. As an authorized workspace administrator, verify checkout for each advertised billing period and confirm Stripe displays the correct plan, currency, amount, and cadence. Do not complete a live charge merely to test configuration without separate payment approval.
4. Verify the approved webhook-delivery and entitlement workflow using the project's release procedure. A checkout URL alone does not prove payment or entitlement success.

Ordinary checkout always rejects test or unknown price mode on Vercel production, validates mode against the configured key elsewhere, and rejects an account mismatch when `STRIPE_ACCOUNT_ID` is configured. Existing upgrades retain their separate `STRIPE_UPGRADE_ACCOUNT_ID` and `STRIPE_UPGRADE_LIVEMODE` controls; this setup does not enable upgrade offers.

# XBAR owner dashboard

Open `/app/owner`. A normal sign-in without a requested return path or purchase
plan sends the verified owner here. The ranch account menu also links here
after a successful server capability check. Customer sign-in, signup, password
recovery and explicit return paths retain their existing destinations.
This is a web dashboard. Native store builds retain their existing arrival and
do not show the owner entry or its external billing links.

## Access contract

- Set server-only `XBAR_OWNER_USER_ID` to the single confirmed Supabase Auth user
  UUID verified for the owner. Do not use an email allowlist, a `VITE_` variable,
  user-editable metadata, workspace membership, or the owner preview feature.
- Both account endpoints (`owner-access`, `owner-dashboard`) verify the bearer
  token through Supabase `auth.getUser` on every request. Only that exact UUID
  with a confirmed email is allowed. Missing configuration fails closed.
- No migrations or additional database grants are needed. The service-role
  reads of billing bindings and workspace plan summaries happen only after the
  owner check. No horse records, documents, addresses or payment methods are
  returned. Responses are private/no-store; customer data is not persisted in
  browser storage and is hidden immediately on session changes.
- Keep the owner's login and connected Stripe account secure; enable MFA in
  those account services. No dashboard can protect an already compromised owner
  login. Changing or removing the UUID and redeploying revokes dashboard access.

## Billing and scope

The dashboard reads subscriptions from the Stripe account selected by the
server key, validates `STRIPE_ACCOUNT_ID` when configured, and labels the mode.
Production requires a live key; every nonproduction environment requires a
test key. The capability probe itself does not contact Stripe.

All statuses can be selected and all pages traversed (25 subscriptions/page).
Summary counts are explicitly for the current page, not global customer or
revenue totals. The account may contain subscriptions without an XBAR binding;
these are shown as unlinked, rather than silently dropped or treated as an
entitlement. A workspace is associated only when **both** stored customer and
subscription IDs match. A missing profile is displayed as unknown.

Unit rates are not invoices or revenue: quantities, discounts, tax, metered
prices, prorations and collection status matter. Active subscription status
does not prove a paid invoice. Free accounts and app-only trials have no Stripe
subscription and are outside this list.

Management links open the corresponding account's authenticated Stripe
dashboard for plan changes, cancellations, invoices and refunds. XBAR never
creates a privileged customer portal session for another user, changes a
subscription from this screen, or stores card information. Existing webhooks
remain responsible for syncing resulting entitlements.

## Release verification and remaining gates

Run the owner API suite and auth-browser suite along with the repository's
required checks. In production, verify the owner can load `/app/owner` and
follow the correct Stripe account links. Verify unauthenticated requests and
another authenticated user's token are refused, even if that user is a ranch
Admin. Do not simulate a payment, cancellation or refund against a real
customer merely to test a link.

The operations panel reuses `/api/health` configuration checks and links the
prioritized audit in issue 361. Configured billing is not proof of successful
checkout. Lifecycle email delivery, auth delivery, payment-to-entitlement
sync, backup recovery, and outstanding audit findings remain separate release
gates. An owner dashboard does not certify the whole website as defect-free.

Rollback: revert the dashboard commit through a reviewed PR. The change has no
schema/data mutation to reverse; removing its owner environment variable and
redeploying immediately makes both endpoints refuse access.

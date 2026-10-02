# Account deletion: billing safety and release gate

Status: draft implementation. No production migration or real customer deletion
has been performed as part of this change.

## Reproduced defect

On main `eb06c07e45b1e07aa552d1b289490ba98be1bedc`, the account-deletion handler
could delete an account, its private workspaces, and their billing mappings
without checking Stripe. Deleting Supabase data does not cancel a Stripe
subscription. The synthetic handler regression demonstrated an HTTP 200 and
irreversible deletion calls with a linked subscription that was never inspected.

Review then reproduced two related races: a stale request could release a newer
request's per-user membership holds, and another tab could create a new owned
workspace after the deletion snapshot. Both could let auth's owner cascade erase
records outside the verified private/billing-safe set.

## Bounded fix

- Claim the existing checkout lease for each planned private workspace before
  placing any deletion hold
- Place a token-owned user deletion fence and membership holds in one database
  transaction; require its owned-workspace set to match the claimed set
- Refuse new checkout claims, workspace creation and ownership changes while
  the user fence is active
- Check Stripe read-only for all linked subscriptions, unfinished checkouts,
  open/draft invoices and future schedules, with complete pagination
- Re-read subscriptions after checking sessions to catch a hosted checkout
  completing between those queries
- Treat missing mappings beside paid/recoverable profile evidence as unknown
- Renew checkout leases and confirm/refresh the token-owned database fence and
  exact workspace set immediately before auth deletion
- Release only the request's own fence atomically; stale cleanup cannot release
  a newer request's membership protection

This does not cancel subscriptions, settle invoices, expire checkouts, issue
refunds or change prices. Such billing remains an explicit user/operator action.
Uncertain and unsettled states preserve the account and direct the user to
manage billing or contact support. Never-paid, manual and first-party trial
workspaces remain deletable when their state is verified.

## Required release order

1. Obtain explicit approval to apply
   `20261002182226_account_deletion_request_fence.sql` to the intended database
2. Drain or stop account-deletion requests before applying the migration
3. Apply the migration and execute the isolated/rollback database checks under
   an appropriately approved verification plan
4. Deploy the matching handler only after the migration is confirmed
5. Verify the exact release SHA and the affected workflow in an isolated Stripe
   sandbox, including failed billing reads and concurrent requests

The migration intentionally makes the legacy hold RPC refuse. Old application
builds receive a recoverable failure rather than performing unprotected deletion.
New code also fails closed if the new RPCs are missing. Old live membership holds
may take their existing 15-minute TTL to expire before a new request can start.
Do not merge/deploy this draft as a code-only change.

Rollback must keep account deletion disabled while requests drain. Keep the
additive fence in place; restoring the old protocol reopens the races. Do not
clear another request's fence or remove safeguards just to make deletion pass.

## Verification evidence and limits

- The new handler regression failed against the original implementation
- 82 account-deletion tests passed locally, including stale-request interleaving
  against the real handler with synthetic Supabase/Stripe boundaries
- The prior hold migration plus the new migration and rollback check executed
  successfully in a temporary PGlite PostgreSQL engine with minimal referenced
  tables; all fixture users rolled back
- A mutation removing the release token comparison failed the SQL fixture with
  "Stale request released B", proving that assertion detects the restored defect
- The new `account-deletion-database` GitHub workflow runs the same SQL on an
  isolated PostgreSQL 16 service; its actual conclusion is a separate gate
- The full local test chain requires the equivalent `node --import tsx --test`
  entry point for its PDF suite because this environment refuses the tsx CLI's
  temporary IPC socket. The normal `npm test` command must still pass in CI

Synthetic boundaries and a minimal database fixture do not establish production
schema parity, real Stripe delivery, or end-to-end cancellation. External Stripe
Dashboard actions remain outside XBAR's database fence and must not be performed
concurrently with a supervised deletion. A preview deployment using a live key
is not a Stripe test sandbox.

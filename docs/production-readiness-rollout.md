# Readiness changes and rollout holds

This PR is based on main `71310d4000487180bd9baea678c285a0c048d1d9`.
It is not a production launch approval. No production migration, deployment,
backup, customer email or payment has been executed by this work.

## Verified production facts (September 25, 2026)

Read-only Supabase catalog and migration-ledger queries against project
`uxvwfepyothlakhqazwv` found neither `20260924120000_billing_period` nor
`20260924130000_trial_entitlement`. The expected billing-period columns and
trial helper functions are absent, corroborating the ledger. These migrations
remain a rollout prerequisite, not an approved action.

`workspace_subscription_profiles` has RLS enabled and exactly one policy for
`authenticated`, a SELECT policy for active members/owners. No authenticated
INSERT/UPDATE/DELETE policy was present. CI now verifies those restrictions
against PostgreSQL, including owner, member and outsider sessions.

## Backup and database checks

See [database recovery](database-recovery.md) for encryption, storage limits,
restore instructions and the distinction between a database dump and a complete
disaster-recovery backup. A local PostgreSQL 17 drill restored the encrypted
synthetic database and compared all 30 tables (including the new audit table), schema and RLS.
CI repeats the drill with the current migrations. This is not a hosted Supabase
restore and uses no customer data. Hosted scratch-project access, production
database credentials, backup encryption key custody and backup activation are
blocked on Erin. Supabase Free does not supply the proposed paid backup/PITR
guarantee. Missing or stale backup/restore evidence makes preflight exit 1.

The CI platform fixture supplies the auth/storage tables, JWT functions and roles
needed to execute every repository migration in order on real PostgreSQL 17.
It does not emulate Supabase Auth or Storage HTTP services. External integrations
and platform-specific hosted restore behavior still require acceptance checks.

## Request protection and deletion

Production protected requests now return 503 with `rate_limit_unavailable` when
Upstash is missing, unreachable, times out, returns an error, or returns malformed
data. Over-limit requests return 429. INCR and expiry execute atomically in Lua.
There is no production memory fallback. Explicit `RATE_LIMIT_MODE=memory` is
allowed only for NODE_ENV=test/development and never when VERCEL is set.
**Configure and validate the free shared Redis service before deploying.**

Packet POST requires manageSales. Template generation requires uploadDocuments.
Bulk preview requires uploadDocuments; auto mode also requires createHorse,
editHorse and reviewDocuments because it can perform all those actions. Explicit
commits require the capabilities of their selected actions before any write.

The new account_deletion_events migration is held for Erin's approval. It stores
operation/user/workspace UUIDs and phase, not email addresses or document content.
No foreign keys cascade away evidence. Service role has INSERT/SELECT only;
authenticated users have no access. Acknowledged `started` is required before
membership/auth deletion. Missing completion evidence or incomplete cleanup
returns an explicit failure with an operation ID; support must reconcile pending
operations before retrying. This is not an atomic deletion transaction. Retention
and administrative erasure policy still need owner review. Rollback order is in
the migration; preserve existing receipts.

## Error tracking and uptime

Sentry React/Node clients activate only with VITE_SENTRY_DSN/SENTRY_DSN. Use an
owner-configured free project and keep paid overages disabled. Error payloads
are whitelisted: no raw messages, user objects, request bodies, cookies, tokens,
breadcrumbs, replay or tracing. The server wrapper awaits delivery for up to
1.5 seconds and preserves handler authentication/method/error responses.
Configure Sentry's email issue alert and verify one synthetic event before launch.
DSNs/account configuration and real alert delivery are blocked on Erin.

The independent GitHub Actions watchdog checks `/api/health` every 15 minutes,
both successful cron completion timestamps (26-hour deadline), and successful
scheduled backup age (36-hour deadline). GitHub schedules can be delayed and
disabled after repository inactivity; this is best-effort free monitoring, not
an uptime SLA. Cron records live in shared Redis and expire after three days.
Missing configuration/records, failed jobs and partial reminder failures cannot
refresh a successful completion. Unauthorized requests cannot write heartbeats.
The watchdog opens one GitHub incident on failure and closes it on recovery.
Erin must enable Actions schedules, set Redis secrets, subscribe to repository
issue/failed-workflow notifications and verify receipt of a synthetic alert.
For independent watchdog coverage, configure Sentry's included uptime monitor
against `/api/health`; do not buy additional cron monitors. No external account
or alert subscription was configured by this PR.

## Media and remaining lanes

New uploads remain Pending. Admins/Sales Leads can inspect the image in the
horse profile and explicitly approve it for sale presentation or return it to
review. Shared review uses the authenticated `/api/account/media-review` action,
which checks the existing manageSales capability and changes only the selected
stored asset's status. It compares the viewed image and stored payload before
writing, refuses conflicts, and requires an acknowledged write before updating
the screen. This permits invited Sales Leads to review without expanding whole-row
horse RLS writes. Device-only mode explicitly reports local persistence. Existing
historical statuses are preserved; this does not establish
historical human review or immutable ownership. #255 buyer signing/revocation
work is unchanged and remains a separate lane. Existing URLs retain their TTL.

Pricing, trial semantics, billing configuration, branding and report/timestamp
repairs are unchanged. Stripe price/payment reconciliation, real signup email
delivery and real-document OCR acceptance remain owner/integration blockers.

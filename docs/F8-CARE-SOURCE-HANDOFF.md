# F8: private care source handoff (sender remains off)

A normal browser save makes several separate relational writes, so a committed
horse or document row is not evidence that the whole browser save returned
success. A backup in `workspace_snapshots` is not authoritative for delivery.
This slice observes only committed relational writes and does not create
recipient-specific work or prove any email is sent.

The opt-in database fence has no enrolled workspace, App API, cron, recipient
or message sender. A named workspace can be turned off even after future
enrollment; retain the version row when disabling it. In the disposable QA
fixture, a real-role Medical Lead saves completed care and advances only that
workspace's revision. Membership changes and document/horse updates invalidate
a projection pinned to an older revision. A rollback or timestamp-only
resubmission does not. Existing OCR reminder processing is unchanged.

## Remaining integration gate

1. Establish the authoritative care snapshot and permitted archive treatment.
   Prefer a bounded service-only projection snapshot taken from versioned
   relational rows; validate identities and full keyset pages and reject
   mixed revisions. Never promote the browser backup blob or a partial response
   into work. If acknowledging all source tables together is required, give
   the care write a server-owned atomic commit marker first.
2. Approve workspace calendar/timezone/schedule, notification channels, role
   capability, explicit opt-in and verified recipients. No owner fallback.
   Default off; do not enable live enrollment as part of applying this migration.
   Initial enrollment must include a complete after-enrollment reconciliation
   under a stable source-write fence; do not assume it observes concurrently
   committed mutations whose transactions started before enrollment.
3. Pin the observed version in a service-only database transaction that both
   validates the current enabled/revision row and supersedes/creates outbox
   occurrences, keyed by source occurrence/version, channel and recipient.
   Reject stale versions instead of acknowledging them. Use a complete scan
   and start again at the beginning for subsequent sweeps; a mutation behind
   the page cursor is picked up on the next sweep. Bound each invocation.
   Source revisions are decimal text at the service boundary, not JS numbers.
4. At each claim and immediately before provider handoff, revalidate source,
   membership, verified address, channel consent and equivalent legacy OCR
   suppression. Membership fencing does not prove current email verification
   or consent; these must be checked independently. Provider acceptance and
   delivered receipt are separate; uncertain acceptance must not be retried
   blindly. Ship no parallel enabled senders for the same occurrence.
5. In isolated QA, run the real normal-edit → durable acknowledged source →
   fenced create/supersede → authorized controlled inbox journey. Include new
   care completion, document unlink, deactivation/revocation, two tenants,
   repeated optimistic upsert, retry/backlog beyond 200, restart, known
   provider rejection and ambiguous acceptance. Test overlapping writes,
   enrollment and projection using multiple PostgreSQL sessions before
   enrollment. This slice's one-session fixture is not dispatch QA.

Recovery before any enrollment: disable the private pilot using the
administrative connection, if necessary, leaving existing reminders intact.
Removing the unused schema requires separate migration approval: drop the
three source triggers first, then the two trigger helpers and page function
as well as the table (which owns its enrollment trigger). Never remove the
fence while a future sender still depends on it.

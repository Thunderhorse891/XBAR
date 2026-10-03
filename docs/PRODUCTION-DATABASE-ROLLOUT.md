# Production database reconciliation and release hold

## Initial evidence (September 28, before 15:39 UTC)

Read-only inspection of `uxvwfepyothlakhqazwv` confirmed:

- `horse-media` is public with zero objects at inspection. This is an exposure
  path for future uploads, not evidence of a customer photo leak.
- `billing_period` and `xbar_trial_active(jsonb)` are absent. The subscription
  event RPC has 14 arguments; deployed code supplies `p_billing_period` too.
- The four September 24 migration versions are absent. The deletion-audit
  migration prepared in this PR is also absent.
- Subscription profiles have RLS and one authenticated SELECT policy, without
  authenticated write policies.
- No public-table policy targets anon or PUBLIC. The anonymous frontend uses
  the two authorized public-share RPCs, not direct table reads. A new held
  `20260928150000_restrict_anon_table_discovery.sql` removes unnecessary anon and
  PUBLIC table/column read and write grants, preserving function grants and verifying
  authenticated/service-role access is unchanged. The read-only inventory also
  confirmed unnecessary anonymous write grants; SELECT-only revocation would
  leave mutation privileges behind. The migration aborts on unsafe grant
  inheritance instead of adding broad privileges. It is not applied live.
- Production's document policies intentionally retain legacy uploader access.
  Some definitions were applied with different ledger versions. Never infer
  that every missing filename should be replayed.

Production and remote main were both `6d6d9273d0a4cd31371e916452d8fba070189ece`;
Vercel `dpl_87BjnhWgQXM6VCrMMYSmyz4bJ6yh` was READY. Those deployment facts do
not clear the database mismatch. No production writes were performed.

## Subsequent reconciliation (September 28, after 15:42 UTC)

Separate PR #271 (`9bc2561bec6da1ca6bdb3deaa1d0161e5dc44f4a`) records a hosted
batch migration. A fresh read-only catalog check independently confirms
`billing_period`, `xbar_trial_active(jsonb)`, a 15-argument subscription event RPC,
private `horse-media`, and ledger versions `20260928153909` / `20260928154229`.
The 25 existing public tables still grant anonymous SELECT; this PR's anonymous
privilege correction remains unapplied. This task performed no production writes.

These facts supersede the earlier absence/public-bucket snapshot above. They do
not prove complete definition equivalence, immutable media ownership, hosted
restore, payment/email delivery or whole-app acceptance. The other PR reports
rolled-back live behavior tests; those are its author's evidence, not execution
by this task. At that snapshot its code was unmerged and trial eligibility
review was still in progress; the later closure below supersedes that status.

Before composing a release, reconcile #271's exact SQL files and batch ledger
mapping with this PR's baseline and required versions. Do not replay the older
files, invent individual ledger entries, or loosen the gate just to pass it.
The dependency order below remains held and must be revised against the actual
combined source and deployed definitions before any further execution.

## Reviewed integration (September 28, after 17:02 UTC)

#271 merged as `04cc7a374fc7a0f55eeee995584316ebd3115eb2`, with the same tree as
reviewed `cd6aa6d2abae61c6d40c2b67333b639696586ae5`. Final-head checks and review
closed the recorded trial/reminder/share corrections. Production alias is READY
at `dpl_EM5v6NGk4u58f4M8vkxVawnYtUCF` for that merge. This branch incorporates
that source while retaining its stricter missing-Redis refusal and atomic limiter.
No merge to main, deployment or production write was performed by this task.

Read-only ledger SQL was compared to the committed files. All six statements
inside the `20260928153909` batch match their source text after removing only
individual transaction wrappers and the added source headings; the batch has
one outer transaction. The helper-private statement matches its source commands
with comments/whitespace omitted. Both reminder migrations match exact source
text after trimming surrounding whitespace. Hosted `20260928161212` maps to
`20260928163000_reminder_email_delivery_claims.sql`; hosted `20260928163507` maps
to `20260928170000_reminder_declined_retry.sql`.

`migration-ledger-map.json` pins this project's batch names, statement counts,
raw SQL SHA-256 values and normalized source-file SHA-256 values. The gate accepts
these aliases only for this project with matching read-only ledger metadata.
Changed source needs a new reviewed mapping; a batch ID alone is insufficient.
The full actual catalog still must match, including reminder RLS, columns,
constraints and retry index. Unrelated missing versions (including this PR's
deletion-audit/anonymous-grant migrations) remain blocking. No ledger rows are
inserted or renamed. This does not establish payment/email or recovery acceptance.

## Read-only release check

`scripts/database-readiness.mjs --inspect <private-evidence.json>` takes
`READINESS_DATABASE_URL` privately through the environment and
`XBAR_DATABASE_SOURCE_REF=uxvwfepyothlakhqazwv`. Use the matching direct database
connection or session pooler, PostgreSQL 17, and verified TLS. Never put a password
in command arguments, PRs or logs. The script uses a bounded, repeatable-read,
read-only transaction; it reads metadata and migration versions, never customer
rows, and performs no RPC, DDL or ledger repair.

It compares the actual function definitions, execution/table privileges, policies,
RLS, enforcement triggers, billing column and three bucket privacy flags with
`supabase/checks/release-catalog.expected.json`. Missing, changed and extra
objects all require disposition. Function hashes detect definition drift; they
are not signatures or proof that the implementation is correct. Harmless body
formatting or stricter live grants can also cause drift. **Do not loosen live
permissions or overwrite production definitions just to match this baseline.**
Review each difference against the intended contract and correct the source
migration/baseline if production is safer. The baseline is generated from an
isolated database with the repository's full schema and migrations; CI verifies
that same result instead of trusting hand-edited `true` flags.

Set `DATABASE_EVIDENCE_PATH` to the receipt before `npm run preflight`. Preflight
requires client/server Supabase project URLs to match, the receipt to name that
project, its timestamp to be within one hour, the schema/query/mapping digest to
match this checkout, each critical version or verified batch alias to exist and
the actual catalog to match. Configuration and `/api/health` success cannot bypass this gate. Evidence
is a local, unsigned operator receipt: keep the original read-only output and
review it. Never fabricate, relabel or copy a scratch receipt as production proof.

After an intentional schema change, create a new isolated PostgreSQL 17 database,
run the platform fixture and generated schema there, then run
`node scripts/database-readiness.mjs --baseline --write` with its local
`TEST_DATABASE_URL`. Review the generated diff and run `npm run test:database` in
another empty local database. Never generate the baseline from production.

## Prerequisites before requesting production execution

1. Review the combined #265/#271 source and its generated local baseline. #266's
   atomic trial/event correction and #267's date correction, including SQLSTATE
   `22009`, are incorporated through #271; do not apply those branches again.
   Their passing isolated contracts do not replace full hosted workflow checks.
2. Resolve the media ownership finding before calling private media secure:
   the existing proposed SELECT policy trusts paths inside editable horse gallery
   JSON. A private bucket alone does not prove immutable object ownership.
   PR #255's approval filter/recheck does not resolve this separate finding.
3. Reconcile the deliberately deferred document-storage contract migration with
   currently deployed and older clients; see `DOCUMENT-STORAGE-ROLLOUT.md`.
   Do not delete legacy access policies blindly or replay the whole generated
   schema over production.
4. Obtain a verified encrypted production backup and hosted scratch restore,
   including separate Storage object recovery. See `database-recovery.md`.
   Local synthetic PostgreSQL evidence is not this prerequisite.
5. Capture existing function definitions, grants, policies, bucket settings and
   schema/ledger versions in a private recovery bundle. Pin the reviewed source
   SHA and migration file checksums. Rehearse that precise sequence on scratch.
6. Present the final bounded rollout and recovery bundle to Erin for explicit
   production migration approval under contract section 15. Approval has not
   been given by this PR or this document.

## Historical dependency order and remaining held work

The following records dependencies, **not instructions to replay applied work**.
Steps 2–4 and the bucket-private portion of step 5 were applied in the reviewed
hosted batch. The reminder claim/retry migrations also have verified aliases.
Remaining production changes still require the prerequisites and explicit approval.

1. Reconcile pre-September-24 prerequisites and historical ledger aliases against
   their actual definitions. Recording a version requires verified equivalence;
   never mark an unapplied migration as applied to silence preflight.
2. `20260924120000_billing_period.sql`: additive column and 15-argument RPC.
3. `20260924130000_trial_entitlement.sql`, followed by #267's reviewed corrective
   migration before writes resume. Do not leave the known malformed-date helper
   as the final production state.
4. `20260924223000_preserve_trial_in_event_rpc.sql`, followed by #266's reviewed
   atomic correction before writes resume. The earlier advisory lock alone does
   not serialize the separate trial UPDATE.
5. The reviewed private-media migration plus the resolved ownership policy.
   Current deployed client signed-URL handling and legacy paths must be verified.
6. `20260925180000_account_deletion_audit.sql` before releasing this PR's deletion
   handler, otherwise that handler deliberately refuses unaudited deletion.
7. `20260928150000_restrict_anon_table_discovery.sql` after the table and function
   inventory review. Recheck the two buyer RPCs, authenticated CRUD and GraphQL
   schema visibility. Do not revoke authenticated SELECT to hide its schema:
   the signed-in application needs those table privileges with RLS.

Use a maintenance window with writers and webhook processing controlled under a
reviewed operations plan. Record every transaction result and migration version;
stop on the first error. Re-run the read-only catalog check after each stage.
Never auto-retry a failed production migration.

## Acceptance and recovery

On isolated scratch, `ci-release-behavior.sql` exercises authenticated insertion
of a sixth horse during a valid trial, denial after expiry, the real named-argument
billing RPC with annual-period/trial preservation, private bucket configuration,
uploader reads and unrelated-user denial. `ci-rls.sql` covers subscription write
denial and deletion-audit durability. `test-database-readiness.mjs` changes seventeen
catalog conditions inside rolled-back transactions and verifies each blocks the
release check. These do not emulate Storage HTTP, Stripe delivery or trial races;
#266 owns the concurrent database test.

`ci-anon-table-access.sql` verifies direct anonymous reads are denied while valid
tokened shares and intentional tokenless Public Links each resolve and record
exactly one view, invalid/missing private tokens stay denied and an authenticated
owner still reads their horse. Grant regression tests
cover table/column/PUBLIC grants, repeat application and transactional refusal
when revoking inherited privileges would remove an intended role's read or
write access. An authenticated owner update is exercised as well.

Before release, use authorized disposable accounts/records for Storage HTTP
upload/read/signed-URL/outsider tests and an actual Stripe test-mode checkout,
webhook, entitlement read-back, cancellation and redelivery. Test-mode evidence
does not establish live-mode catalog correctness. Keep live prices and accounts
owner-controlled. No real payment, email or production data mutation is part of
the read-only gate.

Recovery should stop writes and preserve the failing database, receipts and
diagnostics. Prefer a reviewed forward correction for additive billing schema;
do not drop `billing_period` or wipe newly recorded trial history. Retain the
deletion audit table/receipts even if application code is rolled back. **Do not
make horse-media public as an automatic rollback**: that would expose future
objects. Keep it private and suspend the affected media feature while repairing
access. Restore verified captured definitions only after checking dependencies
and obtaining the same explicit production authorization. A destructive restore
requires a separately reviewed recovery decision and proven archive.

Matching catalog evidence is necessary, not sufficient: it does not clear known
substantive findings, backup/hosted restore, real email/payment acceptance, iOS
Simulator/device/TestFlight, account configuration or visual approval gates.

The audit's recommendation to enable Supabase leaked-password protection also
has a budget constraint: [Supabase documents it as Pro-plan and above](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
It cannot be reported enabled on the required Free plan. No paid upgrade or
authentication-policy change is included here. Advisor schema visibility does
not itself prove anonymous row access; retain the intended public-share RPCs and
test authorization before changing grants.

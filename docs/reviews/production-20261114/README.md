# Production review: batch 1, 2026-11-14

Baseline: draft PR #396, commit `17d4f3c53c20143a1794ff2a301225ed73089980`.
This branch intentionally continues that unchanged draft, not the withdrawn
naming proposal in #397. Plan naming remains an owner decision. Production was
read-only verified READY at `c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0`.
No production writes, migrations, merges, charges or deployments are authorized.

## Actual coverage

`coverage.csv` inventories 929 baseline tracked files: 14 manually reviewed,
775 maintained code/configuration files pending, and 140 excluded generated,
lock, documentation or artwork files. Hashes identify the actual bytes reviewed;
this is not a claim that every test passing constitutes a line review. New review
artifacts themselves are not part of the baseline denominator. Generated output
and supplied assets remain unchanged. Check hashes again before carrying review
status to a new head.

The first batch reads four build/preparation/preflight scripts, the S3 transport,
the upload controller/service, shared server workspace authorization, client
upload state machine and journal, their journal tests, the preflight regression
suite, the gallery browser suite and CI configuration.
No behavioral defect was established in the three preparation/build scripts or
S3 transport in this bounded review. That is not exhaustive verification of
all their integrations. Gallery tests create the first horse through the UI,
but inject photos into local state: they do not prove a hosted photo upload.

Reproduced and fixed: with all Supabase configuration present but S3 upload
credentials absent, preflight never reports the controlled upload subsystem.
Added independent reporting for its required credentials and optional endpoint
and per-file setting. Reports say CONFIGURED (UNVERIFIED), not operational.
Tests first failed for missing reporting, then passed for each missing variable,
configured presence, and non-disclosure of synthetic secret values. This fix
changes operator reporting only; no upload or entitlement behavior changes.

## Existing exact-head evidence

[PR CI run 43170647035](https://github.com/Thunderhorse891/XBAR/actions/runs/43170647035)
on the baseline succeeded. Its job logs independently confirm 107 production
smoke tests, 221 product/document/report tests (retries disabled), 81 configured
auth recovery tests, 24 unreachable-workspace recovery tests, and two native
bundle configurations with 4 tests each. Native bundle here means Chromium
rendering a store-target bundle, not a device or installed native application.

The run retains `workspace-design-review` (artifact 13921973210) and
`ranch-branding-review` (13922708068), expiring November 19. Their metadata and
head association were inspected; artifact image contents were not downloaded or
visually reviewed in this batch. Job steps and logs were inspected directly.

Local browser execution was attempted on unchanged #396. Vite failed before
browser tests with `uv_interface_addresses` / permission error. Do not retry by
bypassing that environment restriction. Local canonical npm test/build commands
also cannot complete their tsx CLI IPC step; use the supported Node loader only
as separately identified supplemental evidence. Hosted preview is not assumed
isolated: a preview can point at the production Supabase project. No writes were
made to it without verified isolation.

## Shortest remaining acceptance sequence

Prerequisite: identify an approved preview pinned to the final candidate SHA and
prove its database, storage buckets, account and Stripe test configuration are
isolated. Do not create a paid branch or use production records. Check migration
versions, S3 credentials, browser/native CORS and capacity read-only first. Stop
if isolation or provider limits are unknown.

1. On an actual iPhone and Android, create a disposable account, confirm the
   email, sign out/in, create a workspace and add one horse using the UI. Reload
   and verify the same horse ID and fields. Record elapsed time and device/OS.
2. Upload a uniquely named synthetic JPEG. Interrupt connectivity after upload
   admission, reload, and confirm retained original bytes and the recovery ID.
   Reconnect and resume explicitly. Verify one object, matching byte length/hash,
   one linked photo and settled accounting; no false success or duplicate charge.
   Also test a lost completion response: check status before retry, preserve any
   unresolved reservation and original. Never clear the ledger to force success.
3. On a disposable paid fixture, upload a synthetic registration image through
   OCR. Verify extracted text against its pixels, correct a field manually,
   confirm the intended horse ID, retain Needs Review until explicit approval,
   reload and verify. Free must refuse OCR without changing saved records.
4. Export PDF/CSV from known synthetic records; compare totals and source rows.
   Exercise the actual supported share/download path on each device and verify
   the recipient receives the intended file. Do not label export as report-email
   delivery: scheduled report email is not implemented. Use approved recipients.
5. Recheck exact final SHA, remote checks/review threads and device evidence.
   Resolve hosted old signed-upload capability revocation/drain guarantees before
   claiming strict shared quota enforcement. Obtain separate explicit migration
   and release authorization; green tests alone do not close these gates.

## Next review batches

Continue with auth/bootstrap and server authorization/RLS, billing and canonical
entitlements, migration order/concurrency/rollback, reserved upload client/server
reconciliation and local vault ownership, OCR identity/corpus, mobile core flows,
then remaining maintenance scripts and maintained code. Keep each fix reproduced,
regression-tested and small; leave healthy code unchanged. The 775 pending rows
remain pending until actually read. Actual-device, hosted interrupted-upload and
report-sharing verification remain open, independently of Stripe catalog review.

## Batch validation

The focused five-test preflight suite passes. Typecheck, ESLint (four existing
warnings, no errors), Prettier and diff checks pass. Canonical npm test was
attempted and stops at the environment-forbidden tsx IPC socket. Full configured
step execution through the supported loader adapter is recorded separately from
a canonical pass. Remote checks must be read again on the new draft head.

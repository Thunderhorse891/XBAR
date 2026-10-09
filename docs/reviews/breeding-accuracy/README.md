# Breeding accuracy and guarantee truth (RP-03 / RP-04)

## Baseline and scope

- Current remote main was read on 2026-10-09: `68cc074a32ff5b9197036ba89ba78c8e0afea7b9`.
- The read-only production audit identified the same SHA on READY deployment `dpl_6uSZSUFXvSf8haMBXEehkBrmppMm` (checked around 14:21 UTC).
- Work is isolated from the audit snapshot and other checkouts. The implementation is submitted in [PR 350](https://github.com/Thunderhorse891/XBAR/pull/350). Release status is established by exact-head checks, review and the accompanying deployment verification report; a local result alone is not a release.
- The existing breeding work in open PR [302](https://github.com/Thunderhorse891/XBAR/pull/302), head `fc9c350d0e0bed2463d3a0a88dfa9295204b6c51`, was inspected and its bounded implementation/corpus reused. Newer main's care and quick-create changes were preserved. PR 302 itself was not altered or merged.
- No production/customer records, schema, migrations, billing rules, credential controls, document identity/storage controls or backup implementation were changed. Tests use synthetic in-memory records.

## Behavioral contract

New breeding entries require their event kind and an explicit Completed, Planned or Cancelled choice in both entry forms. Completed pregnancy checks and foalings also require an outcome. Missing/invalid choices, impossible dates and future completed events are rejected before mutation or persistence. Planned/cancelled entries remain on the timeline but cannot establish or erase an observed pregnancy, cover or birth.

Legacy records remain unchanged and readable. Specific structured outcomes outrank contextual notes. Conservative legacy recognition excludes preparation, bookings, negated covers, unobserved plans and appointment confirmations. A recorded birth does not require an earlier cover, and no missing foaling result defaults to a live foal. Follow-up plans in another clause do not erase an actual recorded result.

The latest chronological check governs the active reproductive episode. An old negative cannot beat a later positive, nor can an old positive beat a later negative. Explicit pending results do not erase an earlier definite result; ambiguous results require review. Conflicting date-only checks or births remain unknown. Real offset-bearing timestamps order observations and are checked against the exact as-of instant. Same-time conflicting outcomes remain unknown. For mixed/date-only cover and foaling boundaries, the established newest-first timeline ordering is retained because these legacy records do not contain a clinical clock time.

Elapsed time alone never promotes a cover to confirmed pregnancy or contributes its foal projection to carrying value. A new pregnancy after foaling cannot borrow the old cover, sire or due date. Forecasts and prenatal checkpoints use calendar-day boundaries; both breeding screens refresh on local-day changes. The overview uses the shared evidence classifier instead of a private title regex. Per-mare value and dates are labeled as entered projections/estimates.

Biological status never adjudicates an agreement. Guarantee state defaults to not recorded or unconfirmed. Optional explicitly recorded terms must reference the current breeding episode and a document linked to that horse, with counterparty, terms and review provenance. Excluded, conditional, expired-deadline and reviewed-terms records remain distinct. Even a loss with reviewed terms only calls for claim review. No path says covered, fulfilled or rebreed owed. This patch does not add a contract-review editor or validate the underlying document's legal terms; unsupported records remain unconfirmed.

## Reproduction and tests

Ten new primary audit tests were run against unchanged main before implementation: **0 passed / 10 failed**. These cover foaling prep, future planned birth, elapsed 320 days without a check, chronological rechecks, future/cancelled checks, same-day conflicts, contradictory heartbeat prose, a real birth without a cover, no-contract coverage and no-contract loss entitlement.

The inherited PR 302 pregnancy/outcome corpus was retained and expanded. Explicitly defective old expectations were replaced: automatic no-contract guarantee entitlement, insertion order overriding precise observation timestamps, and same-day contradictory checks producing a definite outcome. Corrected expectations are independently covered by new failing-before fixtures.

Independent adversarial review found and drove additional tests for:

- real outcomes followed by scheduled follow-up prose;
- same-day precise timestamps and future timestamps earlier than the next date;
- timezone-offset boundaries between a cover and its later check;
- local-day checkpoint rollover;
- equally recent contradictory birth outcomes (2 failing-before cases, passing after correction).

The registered suites cover observed/planned/cancelled entry persistence, all denied roles, no-write failures, source-ID/contract-data preservation through an ordinary synthetic JSON backup round trip, and input immutability. Seven focused browser scenarios cover both forms, overview/detail agreement, reload, invalid outcomes/dates, plans/cancellations and midnight refresh.

## Verification boundaries

- Local focused domain/store and adjacent regression commands are recorded in the accompanying evidence report. Local testing did not run the held credential/document/byte-backup suites. Hosted CI uses the repository's unchanged required workflow and full test command; no held repair was revived or gate disabled.
- Production `tsc --noEmit`, whole-tree ESLint and whole-tree Prettier checks passed. ESLint reports four existing react-refresh warnings and no errors.
- Production Vite compiled 2,496 modules. The exact `npm run build` stopped in its existing postbuild tsx IPC startup with `listen EPERM`; the marketing/sample-packet generator was not rerouted.
- Whole test compilation is blocked by the audit materialization's absent existing `tests/helpers/fakeIndexedDb.ts` referenced by four held suites. That helper and those suites were not changed or run. The breeding browser-test type error found during compilation was corrected.
- The normal browser configuration could not enumerate sandbox network interfaces. A temporary loopback-only server started successfully, but installed Chromium aborted before any page opened with `socket() failed: Operation not permitted`. A narrowly reviewed escalation produced the same failure. Therefore **none of the seven browser scenarios has a passing local workflow result**.
- Hosted CI executed all 206 main browser scenarios, including the seven new breeding scenarios, on an earlier PR head. Every subsequent code change requires its own full CI and independent exact-head review before merge. Production deployment and read-only live-release verification are separate gates, recorded in the release report. Local results do not establish those stages or veterinary/contractual correctness of entered source data.

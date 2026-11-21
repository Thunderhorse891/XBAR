# Breeding accuracy and guarantee truth (RP-03 / RP-04)

## Current baseline and release status

- On November 21, 2026, GitHub main was verified at `6d548c4ccc7e19864566847774316b6b0a575ecd`. This isolated candidate branches directly from that commit. The canonical customer Vercel alias was separately verified READY on `c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0`; main's newer READY build did not own the customer alias. Neither baseline includes this breeding candidate.
- The candidate supersedes the approach in [PR #350](https://github.com/Thunderhorse891/XBAR/pull/350), incorporating its bounded breeding changes and the earlier corpus from [PR #302](https://github.com/Thunderhorse891/XBAR/pull/302). Those PRs are historical inputs, not delivery locations for this candidate. Neither was changed or merged by this work.
- This candidate is held for draft review only. It has not merged or deployed. Do not force-push this main-based branch over #350, or treat its October checks or previous previews as validation of this candidate.
- No production/customer records, schema, migrations, billing, credentials, document identity/storage controls, or backup implementation changed. All tests use synthetic data.

## Behavioral contract

New breeding entries require their event kind and an explicit Completed, Planned or Cancelled choice in both entry forms. Completed pregnancy checks and foalings also require an outcome. Missing/invalid choices, impossible dates and future completed events are rejected before mutation or persistence. Planned/cancelled entries remain on the timeline but cannot establish or erase an observed pregnancy, cover or birth.

Legacy records remain unchanged and readable. Specific structured outcomes outrank contextual notes. Conservative legacy recognition excludes preparation, bookings, negated covers, unobserved plans and appointment confirmations. A recorded birth does not require an earlier cover, and no missing foaling result defaults to a live foal. Follow-up plans in another clause do not erase an actual recorded result.

The latest chronological check governs the active reproductive episode. An old negative cannot beat a later positive, nor can an old positive beat a later negative. Explicit pending results do not erase an earlier definite result; ambiguous results require review. Conflicting date-only checks or births remain unknown. Real offset-bearing timestamps order observations and are checked against the exact as-of instant. Same-time conflicting outcomes remain unknown. For mixed/date-only cover and foaling boundaries, the established newest-first timeline ordering is retained because these legacy records do not contain a clinical clock time.

Elapsed time alone never promotes a cover to confirmed pregnancy or contributes its foal projection to carrying value. A new pregnancy after foaling cannot borrow the old cover, sire or due date. Forecasts and prenatal checkpoints use calendar-day boundaries; both breeding screens refresh on local-day changes. The overview uses the shared evidence classifier instead of a private title regex. Per-mare value and dates are labeled as entered projections/estimates.

Biological status never adjudicates an agreement. Guarantee state defaults to not recorded or unconfirmed. Optional explicitly recorded terms must reference the current breeding episode and a document linked to that horse, with counterparty, terms and review provenance. Excluded, conditional, expired-deadline and reviewed-terms records remain distinct. Even a loss with reviewed terms only calls for claim review. No path says covered, fulfilled or rebreed owed. This patch does not add a contract-review editor or validate the underlying document's legal terms; unsupported records remain unconfirmed.

## Reproduction and tests

Five targeted synthetic repros failed on exact November 21 main before integration: false live birth from foaling prep or a future event, elapsed time promoted to near-term, an older negative overriding a later positive, and a missing heartbeat interpreted as confirmation. The inherited corpus preserves ten original failing-before October cases and tests chronological ordering, uncertainty, explicit outcomes and unsupported guarantee claims.

The November candidate also covers the final #350 review findings: historical stillbirth discussion is not a new loss; an unrelated lost record or slip must not replace an actual pregnancy result; contextual wording such as “foaled as expected” does not erase an observed event. A completed open check without a cover now remains visible without implying a forecast or including mares with no observed event. A deliberately cleared Quick Create date now blocks the mutation; an untouched displayed default remains valid and a corrected date is submitted as entered.

Registered tests cover both entry forms, record validation, role denial, persistence failures, old-record and contract-data preservation, and program calculations. Seven browser scenarios cover both forms, reload, status agreement, invalid outcomes/dates, planned and cancelled events, and midnight refresh. The old #350 hosted run failed to re-find the filled Breeding note. This candidate binds the label directly to the textarea without weakening the existing assertion; hosted verification is still required.

## Verification boundaries

- On code commit `26d8766327f4974123e9e5af050d1eea96fc277a`, all 187 configured commands in the Node test chain ran in one uninterrupted portable pass, with **3,390 reported tests passed and zero failures**. The only command substitution was using `node --import=tsx --test` for five standalone tsx invocations because this sandbox blocks the tsx CLI's Unix IPC socket. No tests were removed or skipped to obtain this result.
- On that same code commit, 345 focused tests passed, and TypeScript, whole-tree ESLint (zero errors and four pre-existing warnings), whole-tree Prettier, Vite, the marketing postbuild, and the isolated Copilot build passed. The postbuild used Node's supported tsx loader to avoid the same IPC restriction.
- Local Playwright did not reach a page: the standard web server hit `uv_interface_addresses` permission denial, and Chromium could not create its required socket. No local browser pass is claimed. The follow-up documentation changes do not alter the tested code.
- Before merge, verify final-head hosted CI, CodeQL, browser outcomes and independent review. Review and release are separate: confirm actual deployment SHA and repeat affected behavior verification only after an authorized production release. None of these test results establishes the correctness of user-entered veterinary facts or contractual terms.

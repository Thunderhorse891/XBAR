# Breeding outcomes: audit 26

This update reuses PR302 (`1064b5d9f86d1b161b4ae5e65d1081fb407166f2`) and integrates current main336 (`356084b779f67654b17a2aa5fea21d6b8f0062ea`). The previous unpublished local follow-up was lost with its execution workspace. This candidate was reconstructed from the published branch and recorded behavioral requirements, then retested; earlier local passes are not proof for this reconstruction.

## Reproduced contracts

The existing pregnancy corpus is retained. Four additional tests failed against the published implementation: a birth without historical cover appeared open; an unknown foaling outcome defaulted live; future/impossible positive checks established pregnancy; and a foaling could be saved without choosing an outcome. All four now pass. Additional legacy foaling wording tests prevent a healthy mare or a negated live outcome from being interpreted as a live foal.

Pregnancy and foaling entry types require a chosen result. Explicit unconfirmed foaling is supported. Non-note future events and impossible dates are rejected without writes. Plans can be saved as notes. Both overview and detail read the shared chronology/outcome model; backfilled older scans cannot replace a later birth or become the overview's latest record. A positive check without a cover does not invent a cover date, sire or due window.

Two existing assertions that treated a pending check or known live birth without cover as open were corrected. Pending remains unconfirmed; the known birth remains foaled-live; the earlier positive still cannot revive an old pregnancy. Existing negation, re-check and same-day cycle-boundary assertions remain intact.

## Verification

- Behavioral corpus and additional date/outcome evidence tests.
- Actual store tests for saved structured outcomes, chronological backfill, backup round trip and no-write validation/permission failures.
- Two Playwright workflows for entry, overview/detail agreement, backfill, reload and explicit unconfirmed outcome. Local browser startup is sandbox-blocked, so hosted CI is required.
- Full registered local chain uses `node --import=tsx --test` instead of the one tsx CLI invocation whose IPC socket is blocked here. Exact npm test remains a hosted-CI gate.

The overview also gains a keyboard-accessible horse link and an explicit breeding-records destination. No new schema or production SQL is needed: existing timeline JSON carries the structured outcome. Final-head CI, review, authorized merge and exact production verification remain separate gates.

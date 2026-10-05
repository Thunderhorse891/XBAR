# Care evidence remediation (audit 24–25; PR 303)

## Baseline and reuse

- Original main: `de684de5c6526f66d26ac4108ed50378236a67dd`, tree `5258fa54046e8d633d36ba232f374a00fd9f3bed`.
- Refreshed main: `c20f601d2d15c5f064c91087e3422388e9986fcb`, tree `f48284223b974e061e1d2f391634213c726702c2`.
- Reuses PR 303's care, Coggins and repair-link corrections instead of creating a parallel feature. Preserves its history with a non-forced merge commit.
- Reuses the calendar arithmetic helpers from pending PR 276 for the affected care surfaces.

## Reproduction and behavior

The original main failed 7 of 9 care-evidence cases: a purchase counted as treatment, completed timeline care did not, and undated Coggins gained currency from upload. Reapplying PR 303 made those cases pass, but two additional cases failed: planned care became completed when the day arrived, and completion was assumed for legacy records.

New medical events store explicit `completionState`. Completed events require a valid non-future date; planned events stay planned until an operator confirms completion. Legacy records without completion evidence remain unconfirmed. No historical data is rewritten. Medical records provide an explicit confirmation action. Editing an existing completed event cannot bypass date validation or report success for a missing target. Care updates require the same medical capability as care creation.

Care status and sale readiness consume the same confirmed events; receipts remain financial records. Coggins requires a valid non-future exam date. Its expiration boundary agrees with the existing canonical document-currency function in multiple timezones, including the last valid day. Existing configured intervals are preserved; this change supplies no veterinary advice.

Health overview rows have real keyboard-accessible horse links and an explicit health-records destination (coordination with audits 31/33).

## Verification

- `careEvidence.test.ts`: behavioral receipt, exam-date, malformed-date, completion, chronological, local-day and currency-boundary regressions.
- `careCompletionStore.test.mjs`: actual store creation, planned-to-completed transition, authorization, no-write failure and backup round trip.
- `care-evidence.spec.ts`: three synthetic browser cases for completed dental/deworming and planned care across a date change, reload and explicit completion.
- Existing sale-readiness fixtures now explicitly represent completed care. The backup shape assertion retains its follow-up validation and adds completion metadata validation.

Local browser execution is blocked by the executor's Chromium socket restriction (`socket() EPERM`). The browser cases must pass hosted CI before merge. The exact `npm test` command is also blocked at the existing `tsx` CLI IPC socket; the portable local run executes every registered command with that single runner invocation replaced by `node --import=tsx --test`. Neither environment restriction is treated as a test pass.

Production acceptance, deployment SHA, final-head CI and review remain separate release gates.

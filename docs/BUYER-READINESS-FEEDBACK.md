# Buyer readiness feedback

Baseline: `a17aaf930a4b4d138f591f148851a4a110422fa9`.

## Reproduced defect

The Buyer follow-up “Revoke” handler ignored a refused `updateSalesLead` result, attempted to create a buyer-room event, and displayed “Access revoked.” A controlled actual-component test returned a sales-permission refusal and observed both the event attempt and success toast.

There was also a meaning problem on its successful path: `shareReady` is an internal preparation flag. Updating it does not rotate a listing token, change its access mode, or invalidate a downloaded sale packet. The old control, status labels and telemetry claimed an access change this handler cannot perform.

## Bounded correction

- Call the existing operation “Mark not ready,” and label its state as sharing readiness. The Sales pipeline uses the same truthful readiness wording rather than claiming the link is live/private.
- Explain that existing listing links and downloaded packets are unchanged. The customer can open the existing listing-management screen separately.
- Keep refusals and exceptions inline as well as in notifications. A failed mutation produces no buyer history event or success telemetry.
- Revalidate the displayed buyer, account/workspace context and role before the action. Verify the intended local state change after an okay return.
- Repeated/reentrant clicks cannot duplicate the change or buyer history entry.
- Record a truthful readiness history note only after the mutation succeeds. Report a history refusal or exception as partial progress, not complete success.
- Rename the telemetry event to `buyer.sharing_readiness_changed` so it no longer alleges revocation.

No listing-token implementation, server permissions, cloud synchronization, buyer contacts, customer data or database schema is changed. The confirmation describes the current workspace state, not a cloud-save acknowledgment.

## Evidence

The first eight actual-component regressions failed before the correction and passed afterward. Eleven now cover refusal, thrown mutation/history calls, repeated clicks, stale buyer/account, okay-without-write, partial history failure, removed buyers, changed/read-only roles, and matching Sales pipeline copy. Three Playwright cases cover desktop/mobile behavior, single history creation and persistent refusal feedback; rendered verification remains a hosted CI gate because local Chromium cannot create its required sockets in this executor.

All 164 configured Node steps pass through the same supported Node import-loader adapter used for the sandbox-blocked `tsx` CLI. Typecheck, full ESLint (zero errors/four existing warnings), formatting, app build and marketing generation pass. Hosted browser/CI evidence and independent review remain required before merge.

# Mobile email-code submission: narrow launch fix

## Baseline and ownership

Main and READY production were read as c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0.
This draft starts from that main commit. Checkout-only #405 remains separately
owned and untouched at bc67a55356ed0a150390c875b6729ad3e28ffa66. No migration,
pricing, receipt template, Stripe artwork, production setting or data change is
included. Existing broader drafts #402 (4b65efc), #403 (d1390fa) and #404
(9d00369) were rechecked: all their configured exact-head workflow runs passed;
#403 also passed CodeQL and six database/policy workflows. Those conclusions
are not verification of this new head or of hosted signup/checkout.

## Found and reproduced in a controlled route

A native/store customer may sign in with an emailed code instead of a password.
The code input lived inside the password form, whose password input is required.
Its verify button was type=button with only a click handler. The keyboard's
Enter action therefore had no independent code submit path and was subject to
the empty password's validation. The code field also lacked an explicit label.
This affects native code sign-in/re-entry, including customers whose accounts
were originally created with a third-party provider; it is not a claim that all
mobile web signup fails.

A regression renders the real Login component with controlled auth boundaries,
requests a code, and asserts a distinct code form that can submit without a
password. It failed against main because that submit path did not exist. After
the correction it passes, including blank-code refusal, busy duplicate refusal,
retained code on error, visible inline error and re-enabled retry. All 12 route
workflow tests pass. The harness's optional boundary overrides do not change
its default behavior or production dependencies.

## Correction and contract

Email-code controls now occupy their own sibling form. A visible label points
to a stable useId input; one-time-code autocomplete and numeric input remain,
with the mobile Go keyboard hint. Enter and the submit button use the existing
verifyEmailCode method. Busy/blank submissions refuse before requesting auth.
Password signup/sign-in validation, provider gating, callback handling, account
mapping, entitlements and selected-plan routing remain unchanged.

The supported native-bundle suite adds a 390px case: request a synthetic code,
leave password blank, press Enter, see the intercepted rejection inline,
correct the code, click retry, verify both exact email/token/type payloads and
zero password requests, and retain the login route without horizontal overflow.
All auth calls are intercepted at mobile-smoke.invalid; no email or charge is
sent. Real iOS/Android keyboards and hosted mail/code delivery remain unverified.

## Local checks and execution limits

- Canonical npm test was attempted and reaches the known tsx IPC listen EPERM.
- Every configured test step passes with only standalone tsx invocations using
  Node's supported --import=tsx loader; no assertions or test steps removed.
- Typecheck, ESLint (four existing Fast Refresh warnings), formatting and diff
  checks pass.
- The supported native-auth smoke build compiled and bundled successfully;
  its canonical postbuild tsx launcher then hit the same IPC restriction.
- The normal Playwright native workflow was attempted; Vite preview stops at
  uv_interface_addresses permission denial before browser navigation. No
  sandbox/security flags or alternative network path were used to bypass it.

Remote canonical CI and the new browser test must pass on the published exact
head before describing checks as green. This draft does not claim actual-device,
hosted auth, Free migration, receipt or checkout acceptance. Next gate: read
final-head browser results and any review findings; fix supported failures.

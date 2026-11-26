# Public launch accuracy repair — local review candidate

## Baselines and ownership

- Public canonical URL: `https://xbar-horse-management-app.vercel.app`.
- Reported deployed baseline: `c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0`; the signed-out public prices observed on 2026-11-22 agree with that source.
- Remote `main`, verified by `git ls-remote` and fetch: `6d548c4ccc7e19864566847774316b6b0a575ecd`. Its difference from the deployed baseline is the separately merged fictional Copilot demonstration, not a pricing release.
- Prepared checkout candidate: `0ce79f0fd3ff19a9055bf9eb18c839f473928f41`, directly based on that main. Its 39-file change prepares the approved monthly pair and provider preflight. The Windows handoff archive and Git bundle were verified before use.
- This follow-up branch depends on the prepared checkout candidate so it does not rebuild or overwrite the reviewed checkout work. The exact rehearsal checkout remains separate and unchanged. Open drafts #405, #402, #403, #408, #415, #416, and #417 remain untouched. In particular, this does not import the formal Free-tier/storage migration or the iOS changes.

## Public mobile observation

Fresh disposable headless installed Chrome, signed out, 390×844 viewport; no existing browser profile, credentials, form submission, provider API, or payment used. Stripe/Supabase hosts and non-GET browser requests were blocked. No screenshots are deliverables.

| Path                               | Observed result                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                | HTTP 200; Create your workspace navigates to signup. Document width 390px.                                                                                                                                                                                                                                        |
| `/demo`                            | HTTP 200; fictional example screens; both tour images loaded. Primary links have 15px text and 51px height. This is a public tour, not an authenticated hands-on trial.                                                                                                                                           |
| `/samples/sample-sale-packet.html` | HTTP 200; fictional horse and sample watermark/notice present; no page-level horizontal overflow.                                                                                                                                                                                                                 |
| `/pricing`                         | HTTP 200; Starter $12/month or $120/year; Professional $29/month or $290/year; Ranch Ops $79/month or $790/year; Enterprise $199/month or $1,990/year. All Choose links point to signup with a paid plan parameter. Professional link navigation was exercised. Primary plan CTAs have 15px text and 51px height. |
| `/app/login?mode=signup`           | HTTP 200; Create Account form and Email or User ID / Password fields visible, no submission. Submit height 50px. Source and subsequent local browser regression identify the stale Sign in tab title.                                                                                                             |

Every path had document width equal to the 390px viewport and no uncaught page error. These are emulated mobile layout/DOM checks; physical-device behavior and a complete visual/accessibility audit are unknown.

## Repair

`api/_lib/public-plan-catalog.json` owns supported new-sale plan names and integer cents: Professional 1999 and Ranch Ops 4999. Server price checks, client plan rates/selection, marketing plan list, and metadata use it. Existing capacity parity tests remain. Historical Starter/Enterprise and annual entitlement mappings are preserved.

Public pages label the pair as planned monthly rates and state that paid upgrades are not available yet. Generic signup no longer selects Professional; plan-card actions create an account without a plan parameter. Purchasable structured-data offers and claims of a verified Stripe upgrade were removed. No new Free tier or no-charge entitlement is promised.

Signup and sign-in tab titles track mode changes and reload. Paid-plan deep links are described as interest, and sign-in continues to describe sign-in. Account creation is explicitly distinct from starting a subscription. The public mobile DOM showed 18px-high sign-in and 15px-high legal links; the scoped auth footer now uses 44px minimum targets and 14px text, covered by the mobile browser regression.

## Evidence and remaining gates

The new marketing regression failed on the prepared checkout source before the repair. Focused price/configuration tests and real-browser synthetic auth cases are run locally. The repository's full single-line npm test command exceeds Windows command length; its configured commands are run sequentially unchanged under the preinstalled Node 24.21 toolchain. Text files in this disposable checkout use canonical LF because several existing tests inspect source text with LF-only assertions. This creates no unrelated content diff.

Local synthetic auth fixtures do not verify real signup, email delivery, hosted workspace persistence, or session refresh against Supabase. A real test-mode Stripe purchase, actual signed event delivery, entitlement write, and access after reload are also pending. Use only the approved isolated Stripe sandbox and Supabase QA project. Confirm their identities through the private operator runbook before connecting; never substitute a live account or a preview with unverified scopes.

The smallest hosted blocker is owner entry of QA-only runtime credentials through the staged trusted local hidden-input supervisor. Values must never enter chat, command arguments, logs, Git, persistent plaintext, browser screenshots, or another account's connector. Account, exact prices, QA origin and project-bound service role are checked before using the application. No production or shared preview mutation is permitted.

## Release sequence — still held

1. Review the checkout candidate and this follow-up diff, then reconcile with current main and any overlapping drafts. Recoverable local bundles/patches are the delivery; no branch push or automatic hosted preview is assumed.
2. Run the exact reviewed combined head in the isolated private QA environment. Verify synthetic signup → actual confirmation → workspace creation → session refresh/reload, preserving existing no-charge behavior.
3. Rehearse both approved sandbox prices through real hosted test Checkout, signed webhook handling, correct persisted tier/rate and access after reload. Verify cancel/retry/deduplication without entitlement drift.
4. Obtain final-head CI/CodeQL and independent review. Keep managed sales disabled until provider/account/catalog/history/webhook checks and the above acceptance pass. Any public availability notice must then be changed with evidence.
5. Only after separate owner authorization consider merge/deployment and read-only canonical mobile verification. Advertising remains on hold until the agreed product gates close.

No deployment, merge, migration, live billing, ads, key rotation, provider configuration change, or customer-data mutation is part of this repair.

## Final local validation

- All 184 configured test commands passed sequentially under Node 24.21.0: 3,107 tests passed, zero failures or skipped tests. Canonical `npm test` is blocked by Windows command-line length, so the command sequence was split without changing its commands or assertions.
- `tsc --noEmit` passed. ESLint passed with zero errors and the same four pre-existing React-refresh warnings. Whole-repository Prettier and Git diff checks passed.
- The synthetic auth build and isolated application/marketing build passed. The isolated build disables dotenv loading and provider access; it does not use production runtime credentials.
- Eight auth browser cases passed with retries disabled, including mobile title/mode/reload, 44px secondary targets, paid-plan intent and six signup/confirmation-return storage-failure cases.
- Three built-app browser cases passed with retries disabled: public paths at 1440px and 390px, plus existing local no-charge setup/billing behavior. These are synthetic tests, not hosted account or payment acceptance.
- The test fixture's VM module loader now loads the shared JSON catalog as a JSON default export, preserving the checkout-reuse/retry assertions. Its former attempt to parse JSON as JavaScript failed; the corrected suite and full chain pass.

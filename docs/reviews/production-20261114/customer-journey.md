# Approved pricing and customer journey: batch 5

Based on unchanged draft #396 at `17d4f3c53c20143a1794ff2a301225ed73089980`.
Owner's latest decision supersedes the previous $20 draft: Free in XBAR,
Professional **$19.99 USD/month (1999 cents)**, Ranch Ops **$49.99 USD/month
(4999 cents)**. Preserve the actual plan identifiers and historical subscriber
mappings/rates. Do not use #397's naming proposal. New annual sales remain off.

The owner thread separately verified the new Stripe catalog entries exist and
legacy pricing is retained. This is catalog-amount evidence only: no identifiers
are copied into code, and deployment wiring, actual checkout, receipts and paid
entitlements remain unverified. No live config changes, charges or external
messages were performed for this patch.

## Implemented and bounded evidence

- Canonical app/server/marketing list rates, metadata, operator guidance and
  current-price fixtures use $19.99/$49.99. A failing catalog regression pins
  the owner decision. Historical $29/$79 and stored $20 Professional records
  remain explicit preservation cases. No customer record or entitlement is removed.
- Exact-price validation now rounds the code-owned decimal list rate to integer
  cents before comparison: JavaScript represents 19.99 * 100 as
  1998.9999999999998. The regression fails before correction and accepts only
  1999/4999 cents, rejecting adjacent cents and old new-sale prices. Current
  checkout/webhook/upgrade/cadence suites pass 116 tests, including synthetic
  signed-event entitlement and legacy-renewal cases. These are not live charges.
- Pure email tests reproduce an invented running trial/workspace and incorrect
  Starter expiry limits. Welcome now describes account next steps without
  claiming setup or a trial happened, explains manual Free uploads and OCR
  review, and expiry uses canonical Free limits (2 horses, 10 active documents,
  1 user). Existing records remain available. All 32 mocked lifecycle tests pass;
  no email is sent. Existing email artwork/layout is retained.
- A checkout response can say `allowed: true` if entitlements changed since the
  offer. The prompt now acknowledges included access instead of leaving the
  purchase offer displayed. That response path is established by the server
  handler. New synthetic browser assertions are pending remote execution;
  do not call this browser-reproduced locally.
- Close controls and upgrade actions have 44-pixel touch dimensions. New
  desktop/390px tests check dimensions, exact $19.99 disclosure, retry after
  a synthetic failure, acknowledgement of included access, Close/focus return,
  and unchanged route. Existing repeated/dismissed-prompt, Escape, late-response
  and workspace-switch tests remain. Viewport emulation is not device evidence.

- An explicit Free selection now continues from setup/sign-in to the workspace
  instead of a billing detour; paid-plan destinations are retained. Free signup
  explains no card is needed, and unconfigured cloud setup says Device-only
  setup rather than implying a paid trial. The new browser case supplies only
  business/ranch names and checks Free, zero seeded horses, derived owner defaults
  and the first-horse action; it is pending remote browser execution.

## Customer acceptance inventory

`customer-surfaces.csv` inventories discovered app route files, public renderers,
transactional templates and shared components (including branding, fields and
dialog/notice/photo controls, with runtime usage still to trace), plus external Stripe
surfaces. Each starts pending unless its exact code scope is documented. A file
inventory cannot enumerate every runtime state or establish that a route is
usable. Continue with these explicit state transitions:

| Surface                                                  | Required synthetic/isolated acceptance                                                                                                                           | Remaining live/device evidence                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Landing, pricing, public FAQ/legal/support, brand images | Three monthly prices/benefits, links/back, retained hero/artwork, no overflow or invented claims                                                                 | Actual iPhone/Android readability and touch use                                        |
| Signup, confirmation, sign-in/reset, Free setup          | Unconfigured/error/retry states; real defaults; card-free Free; first horse and reload; no automatic paid grant                                                  | Hosted isolated auth delivery/callbacks, actual devices                                |
| Free limits and paid feature prompts                     | Two horses/one user/manual documents; preserved over-cap data; accurate upgrade target; no automatic prompt loop                                                 | Hosted RLS/limits and blocked-growth recovery                                          |
| Upgrade overlay                                          | Keyboard trap/escape/Close/focus return; repeated/dismissed prompts; stale offer/workspace/account changes; error/retry; exact cents and renewal disclosures     | New browser checks pending CI; actual devices; final contrast/imagery review           |
| Checkout and return                                      | Approved catalog only; duplicate prevention; success pending until signed entitlement; cancel/error/timeout/retry; current identity pinned                       | Isolated Stripe test workflow required; live wiring and charges unverified             |
| Photos, OCR, notes, reports and sharing                  | Interrupted upload retains bytes/recovery ID; explicit OCR identity/review; customer notes preserved/escaped; source-correct exports and intended recipient/file | Hosted upload/drain/CORS; actual camera/gallery/files/share sheet on each OS           |
| Transactional email, receipts and portal                 | Welcome/expiry reflect actual state and Free limits; no false OCR promise; payment-failure paths and support links; receipt amounts/identity                     | Templates tested only; actual receipts/delivery/portal not verified; no external sends |

The intentional graphite/white design, homepage hero and original supplied brand
assets are unchanged. This patch does not certify every picture, note, contrast
pair or customer path. Preserve that distinction in status reports.

## Review coverage and continuation

The ten rows in `coverage-customer-journey.csv` are newly completed whole-file
reads. Combined with the four previous batch overlays: **48 baseline files
reviewed, 741 pending maintained code/configuration files, 140 excluded**, out of 929. Changed pricing/email/setup sections in larger files are reviewed at the
changed scope but those entire files remain pending where not fully read. Newly
authored review/test/migration files are outside the baseline denominator.

Continue through the remaining customer surfaces and auth/RLS/migrations/OCR
and maintenance code in small reproduced/tested batches. Do not mark a file or
flow verified merely because CI is green. Hosted isolation and real devices are
still unavailable here; do not point preview writes at a production database.

## Final local validation

Every configured npm-test step passes on this candidate using the supported
Node tsx loader substitution. Canonical npm test/build were attempted and cannot
complete the tsx CLI IPC socket in this environment. Typecheck, ESLint (four
existing warnings, zero errors), Prettier and diff checks pass. The final app
bundle and marketing generation pass through the same loader substitution;
the generated pricing artifact contains Free/$19.99/$49.99 and no public $20.
New browser acceptance is not yet verified here. Read final-head remote CI and
reviews rather than transferring a green result from another branch.

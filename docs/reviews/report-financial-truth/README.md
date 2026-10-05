# Report financial truth: audit 14–19

Base: main `de684de5c6526f66d26ac4108ed50378236a67dd` (including recovery #318). The local base tree was verified equal to GitHub's `5258fa54046e8d633d36ba232f374a00fd9f3bed`.

## Corrected contracts

- **14:** Missing cost proof is unknown, never 100% profit or a zero floor. Null values flow through screen, CSV, PDF, rankings and margin bands. Unusable cost dates/amounts also mark costs incomplete rather than silently lowering a negotiator's floor. Existing explicit incomplete-cost override policy remains.
- **15:** Won animals no longer retain asking-price forecasts or discount floors. Their agreed transaction value and recorded-cost result are separate from held/pipeline projections and explicitly do not claim receipt of cash. The reproduced $5,000 sale against $10,900 recorded costs shows a $5,900 loss.
- **16:** Reports and Dashboard use the existing evidence-derived readiness engine. Stored scores no longer produce readiness credit. Dashboard labels record readiness, not sale clearance. Reports separates readiness from its documented ownership/Coggins/medical gates and excludes sold animals from the active-readiness average.
- **17:** Reports uses Sales' recorded-cost break-even and 15% protected floor rounded up to $100. The hidden two-month carrying-cost assumption is removed; no scenario is invented. Configurable scenarios remain separate product work.
- **18:** An absent month remains unknown. An older receipt cannot certify missing intervening history. Three months with records can produce a clearly labeled recorded-spend average, with completeness explicitly unconfirmed. Spend-anomaly conclusions require explicit confirmed-month coverage; existing callers provide none, so they do not invent trend alerts. No persisted completeness-confirmation UI is introduced.
- **19:** Shared receipt-calendar parsing preserves date-only local days. Future, impossible and invalid dated receipts do not become spent money. Costs retains its established parsing API through a re-export. Reports and Sales/Money share as-of filtering; invalid linked costs prevent a trustworthy profit/floor conclusion.

## Evidence

Six exact audit regressions failed on the initial implementation and passed after correction. Two additional adversarial regressions cover an old stray receipt falsely certifying missing months and invalid receipt dates silently reducing a safe sale decision. Reintroducing zero-filled missing history makes the stray-receipt regression fail again.

Existing tests that pinned defective behavior were replaced explicitly: stored-score buckets, hidden carry-price assumptions, absence of history represented as zero, and PDF's stored-score disclaimer. Pricing fixtures now include actual receipt dates; their correct break-even/loss-protection assertions remain unchanged. Source-wiring regex accepts formatter whitespace without relaxing its branches.

The complete 155 configured Node test commands pass through the existing supported Node-loader adapter. TypeScript, full ESLint (four pre-existing warnings), Prettier and diff checks pass. The production TypeScript/Vite bundle and marketing generator pass. Canonical `npm test` / `npm run build` encounter this executor's `tsx` IPC `EPERM`; the same entry point runs through `node --import=tsx`, with no assertion or suite removed. Final-head remote canonical gates remain required.

Actual PDF rendering tests verify registers and text boundaries. Two new desktop/mobile browser scenarios assert visible unknown costs, separate sold losses and CSV exports. Local browser execution is blocked before application startup by Vite's `uv_interface_addresses` system error, including an approved retry. These browser tests remain to be executed by CI; screenshots are not claimed.

Independent focused review found the original earliest-receipt completeness inference unsound. It was replaced as described above, and re-review found no additional blocker. Remote final-head review, CI, merge, matching production deployment and affected workflow verification are separate gates.

## Boundaries and coexistence

No data migration, paid AI, production data mutation, receipt confirmation, configurable pricing scenario or invented transaction is included. Payment collection/receivable work stays with existing PR #304. Its settlement fields and Sales close-out UI are not recreated here. The shared financial module gains optional as-of dates and incomplete-cost detection; settlement integration must preserve those changes. Sales/social PR #331 remains independently owned; SalePacketWizard changes here only make the shared economics' unknown values truthful.

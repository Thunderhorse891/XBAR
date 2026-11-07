# Runtime ownership and bounded cleanup

Baseline: main `c20f601d2d15c5f064c91087e3422388e9986fcb`, exact source tree
`f48284223b974e061e1d2f391634213c726702c2`.

Delivery base: main `ff043870ad5095f46e28d01379ff937a820f19b6`, exact tree
`0d62c9a3f167909f919cf9d45f4a1619a2ece753`. The cleanup patch applies cleanly
and preserves the newer financial-truth implementation and tests.

## Retirement decisions

The baseline import graph starts at `src/main.tsx`, both separate marketing build
entries, and every exposed API entry outside `_lib`. It follows relative/alias
imports, re-exports and literal dynamic imports using TypeScript's parser.
`baseline-reachability.json` records all roots and results. A full-source symbol
reference search confirms that remaining consumers are dedicated tests and
historical comments, rather than dynamic runtime dispatch.

- `activation.ts`: retire the disconnected checklist model. `GettingStarted.tsx`
  is the shipping setup workflow and already owns native purchase visibility.
  The retired model includes a billing step that must not be exposed by a native
  integration. Its dedicated model tests are removed; live setup/native tests stay.
- `operationalValuePulse.ts`: retire the unused weighted-score presentation model.
  `Dashboard.tsx` uses actual document, care, ownership and financial signals.
  Do not introduce another summary score simply to make unused code reachable.
- `xbarGrowth.ts`: retire the unmounted command-center/field-tool card models.
  Dashboard, the actual route map and command search own those live entry points.
  Dedicated tests of the unshipped card models are removed.
- `buildUsageMeters` and its private `UsageMeter` shape: retire the test-only
  presentation adapter. Preserve `featureGate`, `usageGate`, `usagePressure` and
  all active entitlement/capacity behavior. The existing pressure-threshold tests
  remain; only the unconsumed meter assertion is removed.
- `documentTemplateLibrary.ts`: retire the unused client HTML preview/generator.
  Before removal its 15 IDs, tiers and minimum plans were compared with the
  exposed server catalog: all metadata matched. There was no runtime client
  caller and no cross-catalog parity mechanism. `api/_lib/document-templates.js`
  is the preserved canonical runtime; all 15 server choices and tier/render tests
  remain, with an explicit ID contract added. No server endpoint, authorization,
  template rendering logic or document capability is removed. Shared file-saving
  tests continue to cover shipping exports.

The follow-on task-adapter retirement removes `todayWork.ts` after the active
care-task workstream confirmed it is not used by the intended task correction.
The shipping `TodayWork.tsx` route and `operationsPriority.ts` remain unchanged;
only the orphan adapter, its unused WorkTask/WorkCategory/WorkLinkedType shapes,
its dedicated test case and its obsolete path in the route-source inventory are
removed. Shared ChipTone and TaskPriority types remain. Active priority
ranking/follow-up tests stay. This completes the five explicitly identified
dead-module retirement decisions, not a claim that every unused export in the
entire repository has been removed.

These removals are recoverable from Git history. This is not permission to delete
other source just because the SPA does not import it: `landingMotion.ts`,
`marketing/signatureMotion.ts` and `lib/signatureMotion.ts` are all reachable
from the separate marketing build and remain untouched.

## Style ownership

Only `premiumOperatingSystem.css` is retired: its shell/topbar selectors and all
three keyframes have no source/public/script consumers. Its import is removed.
The exact old stylesheet remains only as an explicitly historical browser-test
fixture. Existing `xbarSaas.css` owns shared `xs-*` components; all other style
layers, fonts, colors, supplied logo artwork and component markup are unchanged.
This is not a claim that the larger layered-style consolidation is complete.

Rendered regression tests compare screenshot bytes with the retired stylesheet
re-injected versus removed, on dashboard, Health, Breeding and Equipment at
1440px and 390px widths. Both screenshots are retained as CI test artifacts.
Their actual result must be checked before release; local browser restrictions
prevent claiming an executed local pixel comparison.

## Documentation and evidence

The stale typed-wordmark claim is replaced by the verified `XbarWordmark` →
`XbarMark` → original B artwork chain. The brand asset consumer inventory and
historical-preview label now agree with the October 4 restoration. No artwork is
changed. Runtime documentation distinguishes the declared Node minimum from the
Node 24 release CI rather than claiming untested native-toolchain support.

Before CSS removal, the production SPA build after dead-module retirement had
exactly the same hashes for all 122 compiled JS/CSS assets as the baseline.
Only the copied brand README changed in `dist`. This supports no shipped-code
change from retirement; it is not a substitute for full tests or the CSS browser
comparison. No Apple submission, payment readiness or overall launch-readiness
claim is made.

On the delivery base, all 152 remaining registered Node test steps pass using the
supported Node import-loader adapter. Canonical `npm test` reaches the sandbox's
`tsx` IPC socket restriction; assertions and test selection are unchanged by the
adapter. Typecheck, ESLint (four existing Fast Refresh warnings), full Prettier,
production SPA build and marketing build pass. Browser screenshot equality,
exact-head review and deployment remain release gates.

## Task-adapter follow-on verification

The follow-on retirement was rebased onto delivered main
`5b12ed4bce77e7bd8c7d615da963f09707557da0` (tree
`764bcd0db994f8ad38ae4acd516b609daae5ac0b`). A fresh whole-source reference
search found no runtime consumer of `buildTodayWork`, `WorkTask`, `WorkCategory`
or `WorkLinkedType`; only the retired module and its dedicated tests referred
to them. The shipping `TodayWork.tsx`, active priority/care logic, shared
`ChipTone`/`TaskPriority` and both marketing entry points are unchanged.

All 166 currently registered test steps pass using the same supported Node
import-loader adapter described above. Both no-emit typechecks, ESLint (the
same four Fast Refresh warnings), full Prettier, application and marketing
builds pass. Separate before/after builds on that exact main have identical
SHA-256 hashes and paths for all 137 JavaScript, module and CSS assets,
including both marketing bundles. This is source retirement without a shipped
runtime or style change; it does not complete the separate task workflow audit.
Hosted exact-head checks and authorized release remain required.

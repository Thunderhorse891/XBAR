# Safari icon discovery repair

## Exact release scope

Baseline: live production `b8b3eac347cfd47a3856a783921868ad2373cc1c`, deployment `dpl_DMqqf8WTYc33Hb87wbRYaPhKJ1RF`, stable customer URL https://xbar-horse-management-app.vercel.app/. Official Vercel readback at 2026-11-28 02:30:51 UTC confirmed both `sourceSha` and `gitCommitSha` as this baseline. Main remains `6d548c4ccc7e19864566847774316b6b0a575ecd`, including the separate held #413. This branch deliberately starts from the actual deployed source; do not merge or deploy main to publish it.

Public no-cache HTTP checks reproduced 404 for `/apple-touch-icon.png` and `/apple-touch-icon-precomposed.png`; `/` and `/app/login` returned 200. The explicit revisioned Apple link already served the approved icon. Therefore the missing fallback is established, but it does not establish why any particular existing iPhone tile is stale.

The two root PNGs are byte-for-byte copies of the existing approved 180px export. Both have Git blob `a7b77cee197d3abfe14b27662c8473e0237e02b5`, SHA-256 `61a4678fba3178cf80b9eb1bcc646b6ea75e021adc1181dc4819034a20a299a4`, 180x180 RGB without alpha. Master approval remains SHA-256 `43b7b697184aaa4906f39df66698f2154b8a60b6606320557d1d011018334e98`. No artwork was redrawn or regenerated.

Public heads now reference the existing manifest and use the same Safari standalone/title/status metadata as the app shell. Explicit Apple links declare 180x180. Browser favicons remain the approved revisioned 16/32 PNGs. Manifest `id`, `start_url` (`/app`), scope (`/`), and all manifest bytes remain unchanged. Service worker, registration, cache names, app runtime, IndexedDB, offline queues, auth, APIs, dependencies, native assets and provider settings are unchanged.

Apple documents the root PNG fallback, explicit Apple icon link and size selection, title and standalone metadata in [Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html). This repair follows that discovery contract; it does not force an OS tile-cache refresh.

## Verification and publication boundary

The new root-byte and head-metadata tests fail against the deployed baseline, and pass after this patch. The built-browser regression checks public `/`, `/pricing`, app `/app/login` and signup entry, manifest identity, fallback and revisioned icon bytes, dimensions and PNG content types. Clean WebKit and Chromium cases run at 390px and 1440px. Windows WebKit is browser regression evidence, not an iOS Simulator or physical iPhone test. No Xcode/iOS Simulator is available on this Windows computer; physical Home Screen refresh remains unverified.

Run the complete configured tests, TypeScript, ESLint, formatting, production build and exact-head GitHub CI/CodeQL/Vercel. Windows cmd.exe cannot launch the oversized `npm test` script as one line; the external evidence runner executes all configured `&&` commands sequentially without changing package.json, skipping commands or relaxing assertions. A local build uses local-mode configuration for static browser checks and is never substituted for the production-configured immutable staged deployment.

Local results: all 182 configured sequential test commands passed, reporting 3,093 tests. TypeScript passed; ESLint passed with the same four pre-existing refresh warnings; formatting and build passed. Four built-browser cases passed: clean WebKit 26.6 and Chromium at 390/1440px, with HTTP/hash readbacks and actual screenshots. Evidence directory: `C:\Users\Erin0\xbar-icon-safari-evidence-20261128`.

Read-only production backend verification at 2026-11-28 02:38 UTC returned `ACTIVE_HEALTHY`; advisors are not clean. Security advisories include GraphQL exposure (25 anon and 25 authenticated findings), executable security-definer functions (2 anon and 15 authenticated), and one leaked-password-protection finding. Performance advisories include 21 auth/RLS init-plan and 37 multiple-permissive-policy findings. The unchanged standing clean-advisor release rule is not satisfied by these results. No remediation, configuration or migration is included or authorized in this icon patch.

Existing manual publishing was read back at 2026-11-28 02:29:46 UTC: `autoAssignCustomDomains=false`. Stage the clean exact remote head with the authenticated official CLI using `--prod --skip-domain`, source metadata and the existing project ID `prj_txqRTJIiPwo9xDiOlkICBRRWR4dC`. Preserve the setting. Verify immutable source and resulting files before any promotion; do not reuse old-head approvals. Keep #425 and #426 intact. A review-only PR can collect final-head checks without merging the held main delta. Standing review and Supabase/release gates still apply.

After authorized publication, revalidate `/` and `/app/login` on the stable customer hostname, both conventional PNGs, revisioned favicons/Apple images, manifest identity and actual alias/source metadata. `xbar.app` is a separate DNS result, not a substitute. No claim of live repair until those reads succeed on the new deployment.

## Rollback and device acceptance

Rollback anchor: `dpl_DMqqf8WTYc33Hb87wbRYaPhKJ1RF`, source `b8b3eac347cfd47a3856a783921868ad2373cc1c`, immutable host https://xbar-horse-management-rh286obh9-thunderhorse891s-projects.vercel.app. Use the normal authorized Vercel rollback route only if needed. No data rollback, cache reset or reinstall is part of this asset repair.

Physical acceptance: open the existing XBAR Home Screen icon online, verify its launch URL and retained records, then observe the icon itself. Also inspect a new Safari Add to Home Screen preview from the stable `/app/login` entry without completing an unwanted install. Record iOS version, actual URL, deployment and screenshot. Do not promise automatic icon refresh, remove the existing installation, clear storage or risk device-only work to force an appearance change.

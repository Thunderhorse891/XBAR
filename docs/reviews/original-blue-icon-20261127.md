# V2 icon release candidate isolated from production

This candidate is exactly production c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0 plus the approved V2 icon delta from PR #424, not a build of current main. The package conflict was resolved from c81's package.json with only the approved-icon test appended; no Copilot test, marketing build change or runtime code was imported. The additional browser assertions check no-cache HTML, PNG content types and per-file hashes on / and /app/login.

The sole approved master is SHA-256 43b7b697184aaa4906f39df66698f2154b8a60b6606320557d1d011018334e98. The 1024 master is unchanged. 16/32/64/180/192/512 normal exports and the whole-source padded maskable 512 are exactly the #424 blobs. The canonical mapping, public heads, app head and manifest use /brand/icons/original-blue-20261127-v2/. start_url and explicit id remain /app, scope /, display standalone. Old public assets remain available. No worker/cache reset, owner UI, source runtime, database, native binary, provider configuration, DNS or billing change is included.

Apple touch path: public/brand/icons/original-blue-20261127-v2/icon-180.png.
Git blob: a7b77cee197d3abfe14b27662c8473e0237e02b5.
SHA-256: 61a4678fba3178cf80b9eb1bcc646b6ea75e021adc1181dc4819034a20a299a4.
Dimensions: 180x180, opaque RGB PNG.

## Live anchor and evidence boundaries

The read-only Vercel alias lookup in this run still resolves https://xbar-horse-management-app.vercel.app to production READY dpl_5jofKNrk927A73vrgm5R9xxWwhwa at c81b03b. That deployment is the rollback anchor, immutable URL https://xbar-horse-management-48pu1dbjh-thunderhorse891s-projects.vercel.app. xbar.app DNS is not independently verified here and is not substituted for the stable customer hostname.

Local tests and preview checks are supporting evidence only. They do not mean the icon is live. No existing iPhone tile refresh was observed; iOS controls that cache. Do not tell users to remove the icon or clear local records to force it.

## Publish path: capability versus current approval

Vercel officially supports an independently built staged production deployment with `vercel --prod --skip-domain`; this prevents automatic alias assignment for that deployment without changing project settings. Later promotion and rollback are separate actions. Preview promotion may rebuild under production environment variables, so a QA-bound preview is not an interchangeable production artifact.

Sources: https://vercel.com/docs/cli/deploy ; https://vercel.com/docs/cli/alias ; https://vercel.com/docs/deployments/promoting-a-deployment

Current manual-assignment setting was verified at 2026-11-27 16:47:16 UTC through the existing authenticated official Vercel CLI: GET /v9/projects/prj_txqRTJIiPwo9xDiOlkICBRRWR4dC returned autoAssignCustomDomains=false and link.productionBranch=main. No setting, browser permission or credential was changed. The connector omitted this field; browser inspection had timed out on Emulation.setFocusEmulationEnabled, then native Computer Use stopped because it could not determine the Windows browser URL confidently enough to enforce policy. All Computer Use stopped at that point. The supported CLI used its own existing authentication; no browser credentials/cookies or secret values were extracted, logged or transferred.

The deployment connector does not expose a per-deployment skip-domain option. A production-environment staged build should use the official authenticated CLI's explicit --skip-domain option as an additional no-alias safeguard; preserve the project's false setting. Production promotion is a separate gated release-owner action. No raw key is needed in chat.
GitHub Main ruleset 16702794 remains active: PR plus ci/Vercel, no bypass actors/force pushes. CLAUDE.md requires exact-head CI/CodeQL/Analyze and review-thread clearance, and describes the normal main-merge/matching-production-SHA path. ci runs for codex/** pushes. The CodeQL workflow only runs on main pushes or PRs targeting main, and has no workflow_dispatch. An isolated non-main candidate must not claim #424's checks as its own. A review-only draft PR targeting main can obtain exact-head checks. GitHub uses the merge base for its three-dot PR diff, so it shows the icon delta; a three-way merge into main would retain the held #413, not remove it. Do not merge this release-review PR: a main merge build would contain that held production difference. Review the explicit c81-to-candidate production comparison. The release owner must explicitly establish the bounded standalone path and keep all exact-head review, CI, Vercel/Supabase and production-verification gates.

Current main 6d548c4 contains the separate held #413 (two commits/17 paths beyond production). It is not an ancestor of this candidate. No /app/owner fixes are included: that remains a separate candidate and authenticated owner/ordinary-account QA task.

## Acceptance and rollback

Before publication, review the production-to-candidate comparison, approved master/Apple blobs and exact-head checks; confirm the production build is pinned to this candidate and uses the existing production environment. Stage without assigning domains, inspect actual candidate outputs and service gates, then let the authorized release owner decide promotion. A staged deployment ID does not exist until actually created and READY; never substitute #424's main-based preview ID.

After authorized promotion, revalidate GET / and /app/login on the stable hostname using Cache-Control: no-cache and Pragma: no-cache. Confirm the HTML Apple/favicon links, JSON install identity, PNG content types, dimensions and source.json SHA-256 for each selected icon, and read the alias SHA/deployment again. Record UTC timestamp and literal URL. If unsuccessful, use the anchored prior production deployment via the normal rollback route, not a data reset. Do not clear IndexedDB, unregister workers or modify auth.

Full local configured test chain, app TypeScript, lint, formatting and built-browser results are retained outside the repository with the release evidence. Until exact candidate checks, route and live readback exist, production result is BLOCKED, not fixed.

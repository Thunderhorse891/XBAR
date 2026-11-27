# Customer access and owner mobile repair — review evidence

This is a bounded functional repair, not a premium redesign or launch approval.
The [milestone completion rule](https://github.com/Thunderhorse891/XBAR/blob/9f2e181f042ef31748def57beedfb1681aa4a895/docs/PRODUCTION-ENGINEERING-CONTRACT.md#26-xbar-milestone-completion-rule) remains in force.

## Baseline and isolation

- Branch: `codex/customer-access-mobile-20261127`.
- Base: `b042b1e67e152f42bf43be65c1dffee41e73acb4`, the unchanged, unmerged Guarded B/upload candidate in PR #422.
- Current main read before editing: `6d548c4ccc7e19864566847774316b6b0a575ecd`.
- Vercel alias metadata independently read: public `xbar-horse-management-app.vercel.app` maps to `dpl_5jofKNrk927A73vrgm5R9xxWwhwa`, READY, production, source `c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0`. The latest production deployment _record_ is different; it is not proof of alias routing.
- Reason for this base: preserve the isolated persistence/upload work without introducing main's unrelated Copilot changes. This diff does not change that persistence logic. Review the new commit relative to b042b1e; do not treat its ancestry as independently approved.
- No shared design tokens, billing or DNS files changed. Separate design/infrastructure/billing tracks retain ownership.
- Reviewed the opt-in static token handoff at `87cb06e0815c9fb32314d10814a4f55daee98229`. Its dark surface wrapper requires deliberate panel and portal adoption; it remains separate from this light-card defect repair. No broad reskin, motion or WebGPU was added, and prototype images are not application evidence.

## Reproduced and repaired

The real health handler returned environment variable names in JSON. The owner route rendered those diagnostics verbatim. A controlled provider rejection also returned raw provider text from `sendEmail`. These are source/controlled reproductions; the reported production screen disclosed configuration names, not proof that credential values leaked.

- Public health responses retain readiness booleans and actionable public text. Detailed configuration assertions remain pinned against the internal `inspectHealth` collector. Provider response bodies are neither returned nor logged. Logs use bounded event/reason/status fields, not credential values.
- Hosted payment-link mode retains an explicit manual-plan-confirmation warning. Sanitization must not hide that operating limitation. The legacy health `billingReady` flag is not evidence of a completed purchase or paid entitlement.
- Welcome and packet-email failure responses use stable public copy. Email rejection, rate-limit, ambiguous transport and receipt semantics stay distinct. An unconfirmed send is not silently retried or claimed successful.
- Packet generation preserves application-authored recovery instructions through `PublicOperationError`. Unknown provider/database exceptions receive generic copy. Existing tests still require failed authoritative reads to stop before output or persistence.
- The owner client refuses to echo old-server diagnostic strings. Authentication/callback messages filter the specified configuration diagnostics while preserving useful invalid-password, confirmation and connection messages.
- Owner header uses Grid, the unchanged supplied artwork on a contrasting silver frame, and an accessible Radix account menu. Sign-out, failure/retry, keyboard focus, Escape dismissal and session clearing remain explicit.
- Refresh is secondary. Warning and checked text use the existing text token. Owner main reserves `env(safe-area-inset-bottom)` in normal document scrolling, with a small-viewport minimum height. There is no fixed app bottom toolbar on this standalone owner route. Browser-owned Safari controls are outside page z-index control and were not physically tested.

## Time and contrast

November 27, 2026 is the operating date, not inherently future. The server supplies an ISO instant via `new Date().toISOString()`. The controlled response captured `2026-11-27T14:39:25.285Z`. The new formatter displays the reader's timezone and retains an ISO `time[datetime]`; missing/invalid/unzoned inputs say the check time is unavailable. It does not invent a replacement instant.

The UTC/local-day boundary is covered: `2026-11-27T00:15:00Z` is November 26 in Los Angeles and appears as November 26, 6:15 PM CST in the Windows browser. Locale coverage includes en-US and de-DE. No future-date fault was reproduced.

Computed light-card text is `rgb(32,36,40)` on white, **15.62:1**. Header text is **17.42:1**, silver frame against the dark header **14.21:1**. The prior muted timestamp color was **8.85:1**, already AA: its presumed contrast failure was not reproduced. Artwork itself is unchanged. No new hex colors were added. Existing raw px spacing in `src/routes/ownerDashboard.css` remains; this bounded patch does not claim a complete design-token conversion or localization system.

## Verification and retained artifacts

Artifacts are outside the repository at `C:\Users\Erin0\xbar-review-20261127`.

- `output/playwright/mobile-repair/before-{mobile,desktop}-b042b1e.png`: actual built baseline, synthetic owner/auth responses.
- `output/playwright/mobile-repair/after-{mobile,desktop}-same-fixture.png`: equivalent controlled fixture after repair.
- `output/playwright/mobile-repair/after-{mobile,desktop}.png`: controlled diagnostic/time-boundary/empty-directory case after repair.
- `mobile-repair-public-response.json`: literal output of the real handler in a controlled missing-email/incomplete-billing environment, not a hosted response.
- `mobile-repair-browser-final.log`: rebuilt owner route suite; synthetic GoTrue/owner API fixtures, no customer records.
- `mobile-repair-auth-browser.log`: existing passwords, failed callback and honest signup/confirmation states; synthetic provider responses, not email delivery.
- `mobile-repair-test-summary.json`, `mobile-repair-test-chain.log`: exact configured npm test chain executed sequentially with the existing Windows adapter; provider environment scrubbed.
- `mobile-repair-tsc.log`, `mobile-repair-eslint.log`, `mobile-repair-prettier.log`: repository checks.
- `mobile-repair-test-chain-initial.log`: initial failures retained. Configuration-detail assertions were moved to the internal collector, and safe packet recovery errors were retained; assertions were not loosened to hide a failure.

The browser cases check 390×844 and desktop, horizontal overflow, visible 44×44 targets, account-menu keyboard behavior, safe public copy, session/data clearing, retry, and scrolling the last footnote into the viewport. These are Chromium emulation/regression results, not physical mobile or production acceptance.

Final local results: all **188 configured test commands** passed with the Windows adapter, TypeScript passed, ESLint had **0 errors / 4 existing refresh warnings**, and the repository Prettier check passed. The rebuilt owner suite passed **13 cases**, including a rejected sign-out followed by successful retry; the separate authentication suite passed **8 cases**. Measured header height at 390px was **70.515625px**, with **40px** bottom padding when the emulator's safe-area inset is zero. The recorded computed styles are in `owner-layout.json`; physical insets remain unverified.

## Launch gates still open

The production browser origin approval was denied before navigation. Exact denied action: create a normal Edge tab at `https://xbar-horse-management-app.vercel.app/app/login`. Auto-review said it could not acquire authority for origin network access and required specific approval for that origin/scope. No alternate browser, raw CDP, cookie extraction or indirect request was used to bypass that denial. Independent earlier xbar.app HTTP requests timed out; no DNS change was made.

Consequently this run did not execute a production password sign-in, new signup or inbox confirmation, new ranch/horse, real PDF/JPEG uploads, clean-session retrieval/opening, or hosted checkout. Supabase Auth confirmation/SMTP/rate limits are a different service path from XBAR's packet/welcome email adapter; this patch does not configure either service or alter rate limits.

The separate billing track reported missing sandbox prices/webhook destination. No test card or charge was attempted here. Root subsequently reported an authorized read of the live webhook pointing directly at the Vercel production hostname, clearing the DNS-specific hold; this thread did not independently inspect or change Stripe. A webhook destination must remain direct and non-redirecting through any future cutover. Infrastructure owns the DNS action.

The integrated a58a52d branch contains `ios-submission/README.md`, a tracked Capacitor `com.xbar.ranch` project and `.github/workflows/ios.yml` for unsigned macOS/Simulator checks. This c81-based repair branch has no tracked iOS project/workflow. No Mac, physical iOS device, eligible signing/upload access or successful enrollment was verified here. No signed build, TestFlight upload or date commitment is claimed.

Next acceptance action: obtain ordinary, explicitly approved production-browser access or an authorized production-shaped staging browser/backend, then run the real fixture journey. Keep #422 upload acceptance and coordinated #420/schema cutover separate from these controlled UI results. No merge, public production deployment, migrations or settings changes are authorized by this evidence.

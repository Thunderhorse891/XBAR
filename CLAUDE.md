# XBAR — working agreement

## Governing production engineering contract

Read and follow [Erin's XBAR Production Engineering Contract](docs/PRODUCTION-ENGINEERING-CONTRACT.md) before modifying XBAR. It governs implementation, review, delivery, and status reporting. If older guidance below conflicts with the contract, follow the contract. Green checks never replace final-head review or verification of the affected workflow.

## Shipping a change: the full loop, every time

A change is not done when the code is written. It is done when it is **live and verified green in all three places**. Owner's standing instruction: commit, push, merge to `main`, then confirm green in Vercel and Supabase — for every premium change, upgrade or fix, no exceptions.

1. **Branch** from current `origin/main`. Never stack new work on a branch whose PR already merged.
2. **Verify locally before pushing** — `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`. All four green.
3. **Commit** with a message that says what was wrong and why the fix is shaped the way it is.
4. **Push** to the branch.
5. **Open a PR** to `main`.
6. **Wait for CI to conclude green** — `ci`, `codeql`, `Analyze (javascript-typescript)`, Vercel. Read the actual conclusions.
7. **Merge to `main`** once, and only once, those are green.
8. **Confirm the production Vercel deployment reaches READY on the merge commit** — check the deployment's `githubCommitSha` matches, not just that _a_ deployment exists.
9. **Confirm Supabase is healthy.** No exceptions — the owner's instruction names Supabase alongside Vercel, and "this change probably doesn't touch it" is exactly the assumption that lets a billing, sync or RPC regression through. Always check the project responds and its advisors are clean. When the change does touch auth, storage, policies or the schema, also check the specific surface it touched.

### Merge green, not hopeful

**Never merge while the PR's own checks are still in progress.** Read each check's `conclusion`, on the PR's head commit, before merging.

### Merge on open threads, not just green checks

**Green CI is not "no open findings."** Before merging, re-read the review threads on the PR's **current head** — not an earlier one — and confirm every finding is resolved or answered. Reviews arrive on their own clock: a reviewer can post against the exact head your checks just went green on.

This is written down because it shipped a regression. #222 was merged on four green checks while four findings — one of them a P1 — had been posted three minutes earlier against that same head. Five wrong-name regressions reached production as a result. The checks were green and the merge was still wrong, because the threads were never read.

Checks and threads are two separate gates. Both must be clear on the head SHA before the merge.

### Read the right checks: pre-merge and post-merge runs are different things

A merge commit starts its own `ci` and `codeql` runs on `main`, and those necessarily begin **after** the merge. They are not the PR's checks and say nothing about whether the merge was safe.

This is written down because it caused a false alarm. #201's head `4fb48d4` had `ci` green at 05:31:05, `Analyze` at 05:25:35 and `CodeQL` at 05:25:27; it merged at 05:31:24 — properly green. What was observed instead was the post-merge runs on `f6af00d` sitting `in_progress`, which got reported as "merged before CI confirmed". The merge was fine; the reading was not.

To check whether a PR merged green, look at the check runs **for its head SHA** and compare their `completed_at` against the PR's `merged_at`.

### Report only what was actually observed

Never say "green", "deployed", "pushed" or "broken" without having read the result that says so.

- Verify a claimed commit is **on the remote** before believing any report that work landed: `git fetch origin <branch>` then `git branch -r --contains <sha>`. Several such claims on this repo turned out never to have been pushed.
  `git cat-file -t <sha>` is **not** that check. It reads only the local object database, so a commit created locally and never pushed passes it — precisely the case being guarded against. Measured here: a commit built with `git commit-tree` and pushed nowhere returns `commit` from `cat-file` and nothing at all from `branch -r --contains`.
- An empty API result is not evidence of absence. Check the query first — a malformed `since` timestamp on the Vercel deployments API once returned nothing and was read as "no deployment started", when the deployment had in fact succeeded.
- Before reporting something as broken, confirm the thing you measured is the thing you are describing. Both false alarms above came from measuring the wrong object, not from bad data.

## What this app is for

XBAR keeps one trustworthy operational record per horse — documents, ownership, care, sale readiness. The people using it are running real ranches and making real money decisions from these records.

## The brand is not decoration

Owner's standing instruction: **use her logo and brand identity on this app, everywhere, so that anyone who sees a screen, an export or a share card knows immediately whose product it is.** Recognition is a product requirement here, not a finishing touch — it is most of what "premium" means to the person paying for it.

- **The artwork in `public/brand/` is Erin's supplied master. Use it.** Do not redraw, trace, simplify, recolour, re-letter or approximate the horse, the X mark or the wordmark, and do not invent a new mark because the supplied one is awkward at a size. `public/brand/README.md` governs this and is the inventory: which asset each surface uses, which files are byte-identical aliases despite their names, and which `.svg` files are really PNGs in a wrapper rather than vector masters.
- **Colour comes from the `--xbar-*` tokens** (`public/brand/xbar-brand-tokens.css`, `src/styles/brandTokens.css`), never from a hex typed into a component. Raw hexes are how this app once arrived at nine unrelated blues with the primary button below AA contrast. `tests/brandTokens.test.ts` measures that, contrast included.
- **Every user-facing surface carries the identity** — app shell, sign-in, dashboard, PDF exports, favicon and PWA icons, the OG card. A new surface shipped without it is unfinished, not "styled later".
- **Identity never costs readability.** Decoration stays off working data surfaces where it lowers contrast, and brand artwork never carries state or instructions.
- A new visual derivative — a redraw, a recompose, a small-size mark, a wordmark set in a font — is **Erin's decision, not an implementation detail**. Ask.

## The principle behind most of the fixes here

**Silent success is the enemy.** Nearly every serious defect found in this codebase has the same shape: something reported success while doing nothing, or did something plausible where it should have refused.

- Signup said "check your inbox" about an email it never sent.
- Password reset sent the mail but never called `auth.updateUser`, so the reset could not complete.
- A horse whose paper had no readable name was created named by its **registration number**, twenty times in one intake.
- A filename of `Bill of Sale.pdf` would have created a horse called `BILL OF SALE`.
- The account-deletion guard ran _after_ the owner FK cascade, so it read an emptied table, concluded nothing was shared, and marked every workspace purgeable — a guard that could only widen the purge while reading as protection.

When a value cannot be determined, **refuse** — return nothing and let a person decide. A plausible answer is worse than no answer, because nobody checks it.

## Hold the whole contract, not the case in front of you

A fix is finished when the **whole** behaviour is right, not when the case that prompted it passes. The OCR name extractor took five review rounds in ninety minutes: every round verified its fix against the case just raised, and every round silently broke a different one — twice reaching production — because nobody was holding the whole behaviour at once.

The fix was `tests/registrationExtractionCorpus.test.ts` — 26 rows, every case anyone raised across #222 and #223, each asserting **what a person reading the paper would say**, not what the code currently does. It made "am I done?" checkable instead of a matter of opinion. Scores, for context: 11/26 before this work, 21/26 after the bad merge, 26/26 now.

- A change to that extractor is done when **all 26 rows pass**, not when the row that prompted it passes.
- When you find a new case, **add a row.** The corpus only holds the contract if it keeps growing with it.
- **Never relax a row to make a change go green.** A row that pins correct behaviour is fixed by fixing the code — exactly the guarantees rule below. If a row is genuinely wrong, correct it and verify the correction by reintroducing the old behaviour and watching it fail.

The same discipline applies to any surface with more than one case to satisfy: pin the full set, and measure against the full set.

## Guarantees that must not be weakened

Tests pin these deliberately. If one fails, fix the code — do not soften the assertion.

| Guarantee                                                 | Pinned by                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Sign-in screen says so when cloud auth is unconfigured    | `tests/prod-smoke/smoke.spec.ts`, `tests/auth-smoke/no-cloud-auth-notice.spec.ts` |
| Failed sign-out on workspace setup shows the error inline | `tests/auth-smoke/setup-signout.spec.ts`                                          |
| Brand tokens                                              | `tests/brandTokens.test.ts`                                                       |
| A registration number never becomes a horse's name        | `tests/horseNameFromDocument.test.ts`                                             |
| The OCR extractor reads names the way a person would      | `tests/registrationExtractionCorpus.test.ts`                                      |
| Account deletion re-checks membership _before_ deleting   | `tests/api/accountDeletion.test.mjs`                                              |
| Server and client permission matrices cannot diverge      | `tests/api/permissionsParity.test.mjs`                                            |
| Server and client entitlement helpers cannot diverge      | `tests/api/entitlementHelperParity.test.mjs`                                      |

A test that pins broken behaviour gets replaced, not deleted — and the replacement is verified by reintroducing the defect and watching it fail.

### Duplicated policy needs a parity test, not a comment

When the same security or entitlement policy exists in two places — because one copy runs client-side and the other runs where it cannot import the first — **a comment saying "keep these in sync" is not a mechanism.** Two copies drift, and for a security matrix one direction is worse than the other: if the server copy ever grants a capability the client withholds, a role the product presents as unable to act can act through the API, and nothing in the UI would show it.

Pin it with a test that reads both files and compares them, the way `tests/api/permissionsParity.test.mjs` and `tests/api/entitlementHelperParity.test.mjs` do:

- Assert the privilege-escalating direction (server ⊆ client for grants) **separately**, because that is the direction that escalates.
- Pin that an **unknown** role falls closed, not open.
- Pin the specific grants the privileged path actually depends on, so a well-meaning tightening elsewhere can't silently break it.
- Verify the test by **simulating the drift** — grant one side a capability the other lacks and watch the assertions fail — not by assuming it works.

This is why `api/_lib/permissions.js` exists as a second copy at all: the CSV import handler holds the Supabase **service role**, which bypasses table RLS by design, so it must authorize the action itself before any privileged write and cannot reach the Vite-aliased client module to do it.

## Repo notes worth knowing

- `npm test` compiles via `tsconfig.test.json`. Store modules using Vite's `@/` alias **cannot** be compiled by the node test runner — keep testable logic in dependency-free `src/lib/` modules and pin the call site to source if needed.
- **New _Node_ test files must be registered in the `test` script in `package.json`, or they never run.** That script enumerates every file by hand: `.codex-test-dist/tests/*.js` compiled from `tests/*.ts`, plus the `tests/api/*.mjs` suites run directly.
- This does **not** apply to browser tests. Each Playwright config discovers specs automatically under its own `testDir` — `tests/e2e`, `tests/auth-smoke`, `tests/auth-slow-workspace`, `tests/mobile-smoke`, `tests/prod-smoke`. Adding one of those to the Node chain would run it under the wrong runner and fail.
- Playwright needs a browser. CI installs its own (`.github/workflows/ci.yml` runs `npx playwright install --with-deps chromium`), and a clean dev container has none — run the install there. Some sandboxes preinstall one and set `PLAYWRIGHT_BROWSERS_PATH`; check that variable rather than assuming a path exists.
- Rebuild before browser-driving a change — a stale `dist/` will happily serve the old bundle and produce a false pass.

## Supabase is on the FREE tier until launch

Owner's standing instruction: **she has not purchased Supabase. Stay on the free tier until the app is ready and live in production.** Nothing here may assume, require, or quietly trigger a paid plan.

- **Never propose or enable a feature that requires Pro.** Verify the plan requirement in the Supabase docs before recommending an auth or platform setting, rather than assuming a toggle in the dashboard is available. Known Pro-only items already checked: **leaked-password protection** (HaveIBeenPwned), and **session time-boxing / inactivity timeout / single-session-per-user**.
- **Never run anything that asks to confirm a cost.** The Supabase MCP has `get_cost` and `confirm_cost`; a call that routes through them is a purchase. That includes creating projects and database branches.
- **The project pauses if it goes quiet.** A free project is paused after roughly 7 days without database activity. A warning email arrives about a week ahead, and a paused project can be restored from the dashboard for 90 days. A few real requests a day prevent it. This matters during a quiet build week — production going "down" may just be a pause.
- **Free egress is 5 GB uncached + 5 GB cached per month**, shared across database, auth, storage and functions. Documents, scans and report images are the ones that consume it here, so avoid designs that re-download originals where a cached or smaller asset would do.
- The current state, read rather than assumed: organization `Thunderhorse891's Org` is on plan `free`; project `xbar-records` is `ACTIVE_HEALTHY`.

When something genuinely needs a paid plan, say so plainly with what it costs and what it buys, and let Erin decide. Do not implement a workaround that weakens security to avoid the conversation.

## Authorization — ask first

- **Database migrations** are not applied without the owner's explicit say-so.
- **Anything that costs money** — a Supabase plan upgrade, a paid add-on, or any call that asks to confirm a cost.
- **Production promotion** beyond the normal merge loop above, rollbacks and redeploys are the owner's call.
- Do not weaken billing, Stripe or cloud permissions.

## Known open items

- The account-deletion race is **narrowed, not closed**. Closing it needs a locking RPC, which needs a migration, which needs authorization.
- `engines.node` declares 20.19 while CI runs Node 24.
- **The official wordmark is served but never rendered.** `public/brand/xbar-wordmark.png` is deployed and smoke-tested for a 200, and `public/brand/README.md` lists it as sign-in artwork — but no component references it. What renders as the wordmark is `XbarWordmark` in `src/components/BrandMark.tsx`, which sets the letters XBAR in Outfit beside two hardcoded hexes, exactly the font approximation the brand README forbids. Swapping it to the master is a brand decision for Erin, not a silent refactor.

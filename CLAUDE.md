# XBAR — working agreement

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

### Read the right checks: pre-merge and post-merge runs are different things

A merge commit starts its own `ci` and `codeql` runs on `main`, and those necessarily begin **after** the merge. They are not the PR's checks and say nothing about whether the merge was safe.

This is written down because it caused a false alarm. #201's head `4fb48d4` had `ci` green at 05:31:05, `Analyze` at 05:25:35 and `CodeQL` at 05:25:27; it merged at 05:31:24 — properly green. What was observed instead was the post-merge runs on `f6af00d` sitting `in_progress`, which got reported as "merged before CI confirmed". The merge was fine; the reading was not.

To check whether a PR merged green, look at the check runs **for its head SHA** and compare their `completed_at` against the PR's `merged_at`.

### Report only what was actually observed

Never say "green", "deployed", "pushed" or "broken" without having read the result that says so.

- Verify a claimed commit exists (`git cat-file -t <sha>`) before believing any report that work landed. Several such claims on this repo turned out never to have been pushed.
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

## Guarantees that must not be weakened

Tests pin these deliberately. If one fails, fix the code — do not soften the assertion.

| Guarantee                                                 | Pinned by                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Sign-in screen says so when cloud auth is unconfigured    | `tests/prod-smoke/smoke.spec.ts`, `tests/auth-smoke/no-cloud-auth-notice.spec.ts` |
| Failed sign-out on workspace setup shows the error inline | `tests/auth-smoke/setup-signout.spec.ts`                                          |
| Brand tokens                                              | `tests/brandTokens.test.ts`                                                       |
| A registration number never becomes a horse's name        | `tests/horseNameFromDocument.test.ts`                                             |
| Account deletion re-checks membership _before_ deleting   | `tests/api/accountDeletion.test.mjs`                                              |

A test that pins broken behaviour gets replaced, not deleted — and the replacement is verified by reintroducing the defect and watching it fail.

## Repo notes worth knowing

- `npm test` compiles via `tsconfig.test.json`. Store modules using Vite's `@/` alias **cannot** be compiled by the node test runner — keep testable logic in dependency-free `src/lib/` modules and pin the call site to source if needed.
- New test files must be registered in the `test` script in `package.json`, or they never run.
- Playwright needs a browser. CI installs its own (`.github/workflows/ci.yml` runs `npx playwright install --with-deps chromium`), and a clean dev container has none — run the install there. Some sandboxes preinstall one and set `PLAYWRIGHT_BROWSERS_PATH`; check that variable rather than assuming a path exists.
- Rebuild before browser-driving a change — a stale `dist/` will happily serve the old bundle and produce a false pass.

## Authorization — ask first

- **Database migrations** are not applied without the owner's explicit say-so.
- **Production promotion** beyond the normal merge loop above, rollbacks and redeploys are the owner's call.
- Do not weaken billing, Stripe or cloud permissions.

## Known open items

- The account-deletion race is **narrowed, not closed**. Closing it needs a locking RPC, which needs a migration, which needs authorization.
- `engines.node` declares 20.19 while CI runs Node 24.
- **The official wordmark is served but never rendered.** `public/brand/xbar-wordmark.png` is deployed and smoke-tested for a 200, and `public/brand/README.md` lists it as sign-in artwork — but no component references it. What renders as the wordmark is `XbarWordmark` in `src/components/BrandMark.tsx`, which sets the letters XBAR in Outfit beside two hardcoded hexes, exactly the font approximation the brand README forbids. Swapping it to the master is a brand decision for Erin, not a silent refactor.

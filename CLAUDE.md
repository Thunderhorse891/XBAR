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

**Never merge while checks are still in progress.** This has already cost a scare: PR #201 merged at 05:31 with `ci` and `codeql` still running, on a head whose previous CI run had failed. It happened to pass, but nobody knew that at merge time.

### Report only what was actually observed

Never say "green", "deployed" or "pushed" without having read the result. Verify a claimed commit exists (`git cat-file -t <sha>`) before believing any report that work landed — several such claims on this repo turned out never to have been pushed. An empty API result is not evidence of absence; check the query was right first.

## What this app is for

XBAR keeps one trustworthy operational record per horse — documents, ownership, care, sale readiness. The people using it are running real ranches and making real money decisions from these records.

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

# Isolated mobile and public-error release candidate

## Exact production baseline

The production alias was independently re-read for this release attempt:

- Alias: `xbar-horse-management-app.vercel.app`.
- Deployment: `dpl_5jofKNrk927A73vrgm5R9xxWwhwa`, READY, production.
- Source: `c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0`.
- Current main: `6d548c4ccc7e19864566847774316b6b0a575ecd`.
- Candidate branch: `codex/mobile-error-production-c81-20261127`.

The candidate starts directly from c81b03b. Only the incremental repair from
`7dd82a51c3ceeb80128999f86c40b3d64e68d82f` (#423) was ported. The package-script
conflict was resolved using c81's test script plus the two repair suites; none
of #422's extra tests or implementation were imported. #423's historical
stacked-branch ledger was omitted in favor of this release-specific record.

## Eligible change and exclusions

The port contains the compact owner header/account menu, sign-out retry,
secondary Refresh, safe-area-aware page padding, wrapping/touch targets,
timezone/missing-time display, and safe public email/owner/auth error handling.
Packet generation preserves known application-authored recovery errors while
refusing to echo provider/database exceptions. Email retry and ambiguous-send
semantics remain intact; this does not configure an email service.

No store, CloudBootstrap, workspace setup, horse/document/photo intake,
upload/persistence, schema, dependency lockfile, workflow, billing, DNS or
environment configuration changes belong in this diff. #420/#422 and their
unreleased ancestry are excluded. The inherited original artwork is unchanged.
No customer records are written during this release attempt.

The original owner component and stylesheet at c81 and b042 are byte-identical
(Git blobs `0e10111f883fc7a58374312a9172477b32c7561c` and
`48db6a64e39b2bd242b70434bdaadd227e8c21ba`, respectively). The prior before
screens remain valid component comparisons, not a claim of new production
verification. The c81-only candidate gets its own build and regression run.

## Release gates and current path conflict

The current Main ruleset (`16702794`) is active on the default branch. It requires
a pull request and successful `ci` and Vercel checks. It blocks non-fast-forward
updates and deletion, has no bypass actors, and reports
`current_user_can_bypass: never`. The legacy branch-protection endpoint returns
404, but that does not remove the active ruleset.

The governing contract permits narrow repairs (section 11) and requires real
workflow evidence (sections 17/20), final-head review (19), and the production
SHA to equal the merge commit (18). `CLAUDE.md` specifies PR to main, all named
CI/CodeQL/Vercel conclusions green, merge to main, then production and Supabase
verification. No separate targeted-hotfix exception was found in that workflow.
The owner's instruction to make these repairs live does not waive these gates.

Main is two commits ahead of the actual aliased production source:
`da4594f` and merge `6d548c4` add the unreleased Copilot demo across 17 files.
Merging a repair on main and promoting it would include those changes. Merging
this c81-only candidate into main would revert those files. Neither operation
is part of the authorized mobile/error-only scope. A review-only comparison
against c81 must not be represented as an approved alternative production path.

## Validation and acceptance

Evidence is retained at `C:\Users\Erin0\xbar-review-20261127` under the prefix
`release-mobile-error-`. Commands target this worktree, not #423:

- All 184 configured test commands via the existing sequential Windows adapter,
  with provider environment scrubbed. The two added suites pin public response
  sanitization and timezone/missing-value behavior.
- `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`.
- `node scripts/build-auth-smoke.mjs`, then Playwright's owner dashboard,
  existing password, signup confirmation and callback failure specs.
- Before/after 390px and desktop, account-menu and computed layout artifacts.
  These are built-route synthetic-auth/API regressions; they do not establish
  physical Safari chrome behavior or customer login/upload/checkout acceptance.
- Verify the exact protected preview SHA/target, ordinary protected browser
  entry and public health response before declaring hosted smoke successful.
  No API environment variable names or provider diagnostics may appear in that
  response. Do not bypass Vercel or browser access gates to obtain it.

Final counts, run links and preview status are reported in the task handoff;
commands listed here are not automatic pass claims. There is no production
release until the source/path conflict and all applicable evidence gates clear.

The completed local run passed all **184 configured commands** (3,095 reported
test cases), TypeScript, full Prettier and **21 built browser cases**. ESLint
reported zero errors and four existing refresh warnings. No node/provider test
fixture is being represented as real hosted authentication or delivery.

## Deployment and rollback runbook — prepared, not executed

1. Re-read the production alias and stop if its source changed from the baseline.
   Re-evaluate the exact eligible diff; do not publish #423's stacked ancestry.
2. Establish an owner-approved path satisfying the existing protected main,
   final-head review, CI/CodeQL/Vercel, real affected-workflow and Supabase gates
   while excluding unapproved source changes. Do not force-push main, lower
   checks, edit protections, create a public bypass URL or silently choose a
   different release workflow.
3. Verify the merge/release SHA and protected same-build smoke. Before release,
   retain the active production deployment ID and its READY artifact. This
   candidate changes no schema or saved record format.
4. Only through that approved workflow, publish the exact eligible SHA. Confirm
   READY and that all intended production aliases resolve to it. Read the
   actual public health response and inspect the signed-in owner route on phone
   and desktop; verify menu sign-out/retry, last-line scrolling, public copy,
   service failure handling and accurate local timestamp. Use scoped approved
   fixtures/read-only checks; do not create real customer writes or charges.
5. If release verification fails, stop traffic promotion and retain sanitized
   evidence. The normal rollback is a reviewed revert of this repair through
   the existing green-check release process. If an emergency Vercel restore is
   explicitly authorized, re-verify and restore the retained prior READY
   deployment `dpl_5jofKNrk927A73vrgm5R9xxWwhwa` through the approved rollback
   operation, then verify aliases, public HTTP, owner entry and Supabase. Do not
   change DNS/settings, manually edit data, apply SQL or select a guessed build.
   No rollback was performed or validated by switching production in this task.

No launch-ready claim follows from this targeted repair.

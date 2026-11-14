# Isolated readiness integration candidate

This candidate combines only draft #396's existing work and compatible patches
from #398–#402. It is a draft for combined verification, not merge, migration or
production-deployment authorization. Current main and production remain
`c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0`.

## Immutable inputs

| Source                                   | Published head                           |
| ---------------------------------------- | ---------------------------------------- |
| #396 existing readiness baseline         | 17d4f3c53c20143a1794ff2a301225ed73089980 |
| #398 upload prerequisite reporting       | c9bae112d38aa91bfe3ab94d2a3647b6bd71559f |
| #399 verified capacity counts            | f71628f30c687928a5eb332cab31c19a43f29774 |
| #400 local web build isolation           | 655cad9e2a88d4c24d0df3b0880b55ac0b2fdb28 |
| #401 database packet allowance           | 6ff0a86ff866561f41c5b44afe0dcc769d965b26 |
| #402 approved pricing and customer flows | 71ee05c32715c1ad486f58de8b17e921f0490b7b |

The candidate contains published #402 through 71ee05c plus the four other
immutable patches, applied cleanly with normal three-way application. Combined
preflight retains the controlled-upload group and approved $19.99/$49.99 monthly
prices. The runbook retains both the new prices and prepared migration
instructions. No #397 naming changes or unrelated branch work is included. No
source PR is merged or closed. Review-ledger CSV line endings are normalized to
LF only.

The candidate is suitable for one full combined CI run rather than inferring
compatibility from five independent green branches. Source-branch CI results
are historical evidence and do not certify this integration head. The earlier
batch documents remain snapshots of their stated heads; this document and
`coverage-current.csv` describe the combined candidate.

## Current coverage and bounded validation

`coverage-current.csv` is the consolidated 929-file baseline inventory. Retain a
prior completed review only when its source hash still matches, otherwise reread.
The two combined/changed reviewed files (preflight and price verification) were
fully reread. Four additional auth/recovery modules were fully read: bootstrap,
session storage, recovery gating and token-bound password updates. No new
reproducible defect was established in those four, so their code is unchanged.
The small billing-route and horse-create gate modules were also fully read; their code is unchanged.
Counts: **54 reviewed, 735 maintained code/configuration files pending, 140
excluded**. Newly authored files and review metadata remain outside that original
denominator. Larger customer-facing modules previously read in sections still
remain pending as whole-file reviews.

Focused combined checks pass 81 auth/recovery tests and 99 checkout/webhook/
capacity/preflight tests. The disposable PGlite Free-tier/trial/downgrade and
rolling-packet matrix passes. Full configured tests, static checks, build and
exact-head remote CI are reported independently. Minimal in-memory database
fixtures do not prove hosted behavior, real RLS or multi-connection concurrency.

## Browser/environment evidence

A normal temporary loopback-only Vite configuration started successfully with
fixture-only env values and mocked billing routes. Installed system Chromium
then aborted before application navigation at `socket() failed: Operation not
permitted`. Both targeted browser cases are environment failures, not verified
app failures or passes. No security flags or system permissions were changed to
work around it, and no production backend was contacted. Browser execution is
therefore delegated to the existing remote CI workflow. Viewport tests there
still do not establish actual iPhone/Android behavior.

The denied optional checkpoint command was not retried. Integration uses scoped
patch application and publication of the tested tree through the connected
GitHub API; it does not stage arbitrary work or disable repository hooks for a
checkpoint. Existing worktrees and running production remain unchanged.

## Remaining release gates

Read this candidate's exact-head CI, CodeQL and review conclusions; fix supported
failures and rerun affected checks. Do not transfer status from #402 or another
head. Continue the expanded 101-entry customer-surface inventory and pending source review.

Hosted auth callbacks/email, original/photo upload interruption and recovery,
provider limits/CORS, old signed-upload revocation/draining, OCR review, real
report sharing, Stripe test checkout/return/receipts and actual iPhone/Android
acceptance remain unverified. Catalog amounts were separately verified in the
owner thread; live wiring and payment behavior were not. Prepared migrations
and their rollback require explicit production approval. Preserve customer
records, historical billing and original files throughout. No live writes,
external emails, financial actions, paid branches, merges or deployments occur
as part of this candidate.

## #402 CI failure and supported follow-up

Run 43614219054 at 7dd3094 passed canonical unit/static/build and 107 production
smoke tests, then reported 223 product tests passed and one failed. Both new
390px/desktop upgrade-dialog scenarios passed. The sole failure expected an
exact "Add your first horse" button. The retained error-context artifact proves
the Free workspace existed and its primary button was "Add first horse"; the
longer secondary action includes a description in its accessible name.

The follow-up corrects that selector and strengthens acceptance through primary
first-horse creation, inherited owner/entity defaults, Back navigation and reload
with the same saved ID. It does not remove the assertion or weaken the product
contract. The snapshot also reproduced a real misleading Free dashboard promise
of automatic document reading/filing. Dashboard/horse-roster copy now describes
manual linking and review when OCR is available. No redesign or entitlement
change accompanies that correction. These changes are published in #402 through
71ee05c and included here. Their new browser assertions still need final-head CI.
The dashboard source is added to the surface inventory; its whole-file review
remains pending.

A read-only desktop browser observation of the READY #402 preview at 7dd3094
confirmed Free/$19.99/$49.99, visible benefits and opaque card text. No account,
upload, checkout or payment action was performed on that hosted preview. This
pricing-only snapshot does not validate later heads, mobile, app-wide contrast
or hosted workflows. The preview URL observed was
https://xbar-horse-management-app-git-22bc33-thunderhorse891s-projects.vercel.app/pricing.

## Final combined local checks

Every configured npm-test step passes through the supported Node tsx loader
substitution on the combined source, including the strengthened fixture/copy
follow-up. Typecheck, ESLint (four existing warnings, zero errors), formatting
and diff checks pass. App bundle and marketing generation pass through the same
loader substitution. Canonical npm test was attempted and reaches the blocked
tsx IPC socket. New first-horse/browser assertions still require remote CI;
source integration and a built artifact are not proof of the hosted flow.

The draft integration PR targets unchanged main so the whole inherited #396
patch plus these compatible fixes receive the complete configured CI/CodeQL
checks together. This target is not authorization to merge or deploy. All
source drafts remain separate and unmerged.

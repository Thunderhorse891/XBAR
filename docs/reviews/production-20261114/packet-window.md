# Production review: batch 4, database packet allowance

Based on unchanged draft #396 at `17d4f3c53c20143a1794ff2a301225ed73089980`.
This is a prepared migration, not permission to apply it. No live database,
Supabase branch, provider setting, billing catalog or original file was changed.

## Reproduction and scope

The API and client already count packets generated in the past 30 days. The
last effective database commercial-resource trigger counts lifetime packets.
In disposable PGlite 0.5.16, insert 30 Professional packets dated 45 days ago,
then generate the first current packet: the original trigger rejects it with
`Sale packet limit reached for this workspace.` Both the unchanged Free-tier
matrix and the actual trigger are used, not a reimplementation of quota logic.

The prepared migration replaces only that trigger function's sale-packet count
query with the existing rolling window. It uses 720 elapsed hours, matching the
API/client millisecond calculation across timezone/DST transitions. A direct
comparison against the prior function shows no other branch change. CREATE OR
REPLACE retains attached triggers and existing grants. No data rewrite, deletion,
price, entitlement limit, role or policy change is included.

The rollback-only SQL fixtures prove historical records remain, 30 current
packets refuse the next, the exact window edge counts, an older edge renews,
edits/upserts add no packet, and Free refuses new generation while preserving
existing packets. The default disposable runner passes these plus its full
existing Free-tier/trial/downgrade fixture matrix. This minimal fixture does not
prove real RLS or multi-connection concurrency. CI runs the same new SQL against
the complete generated schema in native PostgreSQL 17.6 alongside existing RLS
and concurrency checks. Its final-head conclusion must be read before release.

## Repeatable isolated checks

With an optional PGlite installation outside the application dependency tree:

```sh
PGLITE_MODULE=/path/to/pglite/dist/index.js node supabase/checks/run-distinct-free-tier.mjs
PGLITE_MODULE=/path/to/pglite/dist/index.js node supabase/checks/run-distinct-free-tier.mjs --packet-window-baseline
```

The first must pass. The second applies the prepared rollback in memory and
must fail the historical-packet regression with the original quota error. That
also verifies the rollback restores the prior trigger behavior. Do not use
these fixture SQL files in production. Optional test tooling changes no app pin.

## Production and rollback gates

Obtain explicit owner migration approval after full-schema CI and release
review. Coordinate with #396's already-required application/storage rollout.
Read-only inventory and verified hosted storage configuration/draining remain
separate requirements. Green local fixtures do not close those gates.

Prepared rollback is
`supabase/rollbacks/20261114120000_sale_packet_rolling_allowance.sql`. It restores
only the prior function, preserves data and grants, and deliberately restores
the lifetime limitation; operators must disclose that creation may be blocked
again. It also requires explicit production approval. Do not rerun the whole
older Free-tier migration as a rollback and do not delete packets to free quota.

## Coverage

`coverage-packet-window.csv` adds six newly read baseline files and records three
newly authored migration/rollback/test files separately. Overlay it on the prior
three batch ledgers: 38 of the original baseline's maintained files reviewed,
751 pending, 140 excluded, total 929. New implementation/review artifacts are
outside that denominator. Auth modules only partially read earlier remain
pending. This is ongoing review coverage, not a launch-ready or exhaustive claim.

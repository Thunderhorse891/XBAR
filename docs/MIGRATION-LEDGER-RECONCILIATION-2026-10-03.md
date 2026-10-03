# Migration ledger reconciliation: 2026-10-03

Status: source-side reconciliation candidate, **not production-ready**. No production SQL, migration replay, migration-history repair, grants, policies, or customer rows were changed or read by this repair.

## Evidence and provenance

Source baseline: PR #265 at `cc155fa5309b00e8a0947e8cb73302eb9bad139e`. This candidate is deliberately based on that readiness branch, in an isolated checkout; it does not edit the externally owned branch. Hosted metadata and stored migration SQL were observed at 2026-10-03 04:31:10 UTC for project `uxvwfepyothlakhqazwv` through bounded read-only queries of `supabase_migrations.schema_migrations`.

Four September mappings retain their original fingerprints. Four additional **one-to-one** mappings are justified:

| Source version | Hosted record                                       | Comparison                                           |
| -------------- | --------------------------------------------------- | ---------------------------------------------------- |
| 20261002090000 | 20261002042804, seat_reservation_consumed_on_accept | Same SQL tokens; comment/formatting differences only |
| 20261002100000 | 20261002134542, account_deletion_hold               | Same SQL tokens; comment/formatting differences only |
| 20261002120000 | 20261002144027, staff_write_policies                | Same SQL tokens; comment/formatting differences only |
| 20261002182226 | 20261002192519, account_deletion_request_fence      | Byte-exact                                           |

The ledger map pins the full source SHA-256 and the raw stored SQL SHA-256, name, version, and statement count for each entry. Review compared complete statements while retaining literal/identifier contents (518, 789, 1352, and 1514 tokens respectively). Runtime acceptance does **not** strip comments or normalize SQL: any hosted byte change requires a new review. Original source migration files remain unchanged.

## Explicitly unresolved

- `20261001090000_workspace_keyed_storage_expand.sql`: hosted records `20261002011346`, `20261002012750`, and `20261002014528` provide capability, INSERT-policy, and listing pieces, but the combined SQL omits the source's conditional media SELECT-policy recreation and removal of media/document UPDATE policies. These three records do **not** prove complete source coverage. None is mapped to satisfy this source version.
- `20261001090100_workspace_keyed_storage_contract.sql`: hosted `20261002205713_workspace_keyed_storage_contract_guarded` is materially stronger, with an atomic lock and legacy/ambiguous-namespace refusal. Preserve those safeguards. It is **not** an equivalent alias of the weaker source. Reconcile the intended final contract in a separately reviewed, forward-only proposal; do not replay weaker SQL or rewrite the applied file.
- `20260924134000_horse_media_private_signed_urls.sql`: the source changed after the historical batch. Its existing exclusion and replay refusal remain intact.
- Held migrations `20260925180000` (audit), `20260928150000` (anonymous access), and `20261003021000` (media guard) remain held. Alias review is not approval to apply them.
- Current function-body formatting differences and unresolved EXECUTE grants remain catalog blockers. No hosted grant is added to the expected baseline merely because it is present.

## Baseline regeneration and validation

The map is part of the source digest. Its initial change intentionally left the old baseline stale. [CI run 37097544617](https://github.com/Thunderhorse891/XBAR/actions/runs/37097544617), database job `111130453797`, applied the schema and migrations to fresh PostgreSQL 17.11, passed the preceding policy/storage tests, then failed specifically at baseline freshness. The original check stayed red while the failure-only diagnostic exported a separate candidate from synthetic `127.0.0.1/xbar_ci`.

Artifact `11264154878` has ZIP SHA-256 `ce52ddfbf1d7cc1d41eb3bebe804a1b799a9cf1b7a8ac2f13313005d2bbf1cad`; its generated JSON has SHA-256 `96b3da89c13b3c06fa70d56f4273cf526d424e45bf75a47bbde624c1dfd794bf`. This PR-triggered run checked merge SHA `c805d8031d18181fc69723e0eff79db42675bf5f` (head `6ca2c9718dae0f21c119fa100f9be1d0c239b545` into unchanged base `cc155fa5309b00e8a0947e8cb73302eb9bad139e`). Independent parent review confirmed catalog and requiredVersions are exactly unchanged; only sourceDigest differs, matching the reviewed source tree. The genuine generated candidate is now imported with repository Prettier formatting only (parsed JSON equality verified). No digest was manually invented or replaced.

All 14 focused readiness tests pass after import. Full exact-head CI, including database checks after the former freshness failure and encrypted restore, must still finish successfully; the initial run did not reach those later checks. The diagnostic refuses catalog/grant differences and cannot overwrite an existing file. It remains diagnostic evidence, never a production-readiness waiver.

## Controlled rollout order

1. Review these four alias pins and obtain/review the isolated PostgreSQL 17 baseline artifact. Commit the generated baseline and rerun Node tests, TypeScript, lint, formatting, and database CI on the exact head.
2. Reconcile incomplete expand coverage and the stronger hosted contract as distinct issues. Inventory actual catalog dependencies and preserve the hosted lock/namespace safeguards. Keep held migrations unapplied until their SQL, order, rollback/recovery plan, and explicit production authorization are settled.
3. Resolve function EXECUTE disposition and other catalog differences against the intended least-privilege contract; never accept the live catalog wholesale.
4. Verify backup/restore and workflow-acceptance gates. Obtain explicit approval for the exact production migration/reconciliation plan before any production write.
5. After approved operations, collect fresh project-bound read-only catalog/ledger evidence and verify every release gate. A mapping or synthetic CI pass alone does not establish production readiness.

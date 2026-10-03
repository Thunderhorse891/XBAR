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

The map is part of the source digest. Its change intentionally makes the old baseline stale until a real isolated PostgreSQL 17 run generates a candidate. The CI database check remains red; the failure-only diagnostic exports a separate SHA-labelled candidate from synthetic `127.0.0.1/xbar_ci`, only if its complete catalog and required migration list equal the committed baseline. It refuses schema/grant differences and cannot overwrite the baseline. Review the artifact, then commit the generated result and rerun all gates. Do not manually replace the source digest.

## Controlled rollout order

1. Review these four alias pins and obtain/review the isolated PostgreSQL 17 baseline artifact. Commit the generated baseline and rerun Node tests, TypeScript, lint, formatting, and database CI on the exact head.
2. Reconcile incomplete expand coverage and the stronger hosted contract as distinct issues. Inventory actual catalog dependencies and preserve the hosted lock/namespace safeguards. Keep held migrations unapplied until their SQL, order, rollback/recovery plan, and explicit production authorization are settled.
3. Resolve function EXECUTE disposition and other catalog differences against the intended least-privilege contract; never accept the live catalog wholesale.
4. Verify backup/restore and workflow-acceptance gates. Obtain explicit approval for the exact production migration/reconciliation plan before any production write.
5. After approved operations, collect fresh project-bound read-only catalog/ledger evidence and verify every release gate. A mapping or synthetic CI pass alone does not establish production readiness.

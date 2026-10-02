# Private-file authorization cutoff (F02)

## Scope and baseline

This completes the existing storage contract; it is not a new application permission model. Application guards and workspace-first uploaders are already on main. On 2026-10-02, the production migration ledger contained the capability, media INSERT, and listing-workspace resolver pieces of the expand phase, while the old gallery-based media SELECT and both update-own policies remained.

Read-only inventory at 20:09 UTC found 21 document objects, all workspace-keyed, no media or sale-packet objects, and no horse-bucket object whose prefix matched an auth user UUID. All three buckets were private. Recheck these facts immediately before an approved rollout; a past inventory is not authorization or a permanent guarantee.

## Exact change requiring owner approval

Apply only `supabase/migrations/20261001090100_workspace_keyed_storage_contract.sql`, in one transaction, to the intended project. Do not run all pending migrations.

- Hold a `SHARE ROW EXCLUSIVE` lock on `storage.objects` while checking the inventory and switching policies. Storage writes may briefly wait; reads continue until policy DDL acquires its required lock
- Abort with every policy unchanged if either horse bucket has an object without a real workspace namespace or a namespace also matching an auth user UUID. User and workspace UUIDs are otherwise ambiguous because workspace IDs are caller-selectable
- Remove the legacy uploader-keyed media upload/update and document read/upload/update policies
- Replace media SELECT with workspace authorization, removing editable-gallery trust; replace document SELECT/UPDATE with the existing workspace read/manager-write rules
- Preserve media workspace INSERT, document workspace INSERT, all table grants, all functions/public-share RPCs, service-role helpers, bucket privacy, billing, and account-deletion fences
- No stored bytes or record rows are moved, rewritten, or deleted

The lock prevents an old client from adding a legacy upload between the inventory check and policy contraction. A stale uploader using a personal prefix will be refused after commit and must reload the current app. If the preflight refuses, stop and inspect the ambiguous ownership; never delete a file or rewrite a workspace ID merely to make it pass.

## Preconditions and verification

Confirm current deployed code uses workspace-first uploads; the listing resolver returns its authoritative workspace ID; workspace access/manage/capability helper definitions and grants are correct; and no unexpected permissive policy grants the same access. In particular, `horse media update workspace` must be absent. Read every storage policy, not just its name or migration ledger entry.

The disposable PostgreSQL workflow checks:

1. Legacy and user/workspace-collision objects in both buckets abort the migration with their bytes/metadata and original policies preserved
2. The original gallery-read attack fails the security check before applying the fix
3. Expand and contract preserve owner/member reads, role-scoped uploads, membership-removal denial, anonymous/outsider denial and invalid-prefix handling
4. A document cannot be moved into a personal namespace in either horse bucket by combining permissive UPDATE policies
5. Reapplication and superseded-migration guards do not reopen access

The document UPDATE policy permits moves between two workspaces the same caller manages; this existing behavior is unchanged. SQL fixtures prove PostgreSQL authorization over object metadata. The API tests prove signed-path validation with mocked Storage clients. Neither alone establishes actual Storage HTTP byte transfer. Post-rollout owner/teammate/outsider upload/sign/download acceptance remains a separate explicitly authorized check. Do not use customer data for it.

After an approved apply, read back effective policies, privacy flags, unchanged object counts, helper grants and migration history. Previously issued signed URLs keep their original expiration; policy changes do not revoke them.

## Recovery

Any error before COMMIT rolls back all changes and releases the lock. Use a bounded lock/statement timeout at the deployment client and stop on error rather than retrying blindly.

After a successful commit, do not restore the old gallery policy, uploader branches, or public bucket flags: that reopens F02. Keep the restrictive policy state while diagnosing and obtain approval for a narrowly scoped forward correction if a legitimate workflow fails. Files remain intact. Re-running the contract is idempotent after its preflight passes. This rollout does not authorize rollback, data cleanup, or another migration.

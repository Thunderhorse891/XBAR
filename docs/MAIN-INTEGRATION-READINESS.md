# Main integration release holds

The readiness branch reconciles main `28732db8e32b8be06462f87d459b3b86fd72ccd1`
with the previously verified readiness head
`a12f833799ae0de51b2732e6f6a421d8da529240`. The prior native success applies to that
old head. Integration requires its own checks and review before release.

Account deletion keeps main's request-token and checkout fences, membership
holds, shared-document preservation and packet cleanup. One operation UUID
correlates the mutable operational receipt with the existing append-only audit
phases. Both start and outcome writes require acknowledgments. A failed cleanup
or outcome acknowledgment returns a safe failure, including whether the account
was already deleted. The immutable audit table and its historical migration
remain intact.

Main's staff policies allow Sales Leads to edit horses and Ranch Managers to
create them. Those capabilities must not grant sale-media approval to other
roles. The additive, held `20261003021000_guard_sale_media_approval.sql` migration
preserves pending uploads and horse edits while refusing new approved images or
replacement images carrying an old approval unless the caller may manage sales.
It preserves service writes and already approved image identities only when the
workspace and horse keys also remain unchanged for callers without sales authority.
Actual staff-policy regressions cover a Ranch Manager approving in a second
workspace they own and trying to carry that approval back, plus a horse-key change.
Pending transfers and ordinary edits remain permitted by the existing policies.
Storage ownership, private buckets, buyer signing, and the review API's selected
image compare-and-set remain separate requirements. Do not release this combined
application/database change without reviewed migration ordering and recovery.

The catalog now checks every public table's RLS and policies, plus deletion
receipt, request, hold and immutable-event columns, constraints and indexes.
Existing function definitions, grants, storage policies, triggers, reminder
structure and bucket checks remain. Generate its baseline only from an actual
freshly migrated isolated PostgreSQL database and review the resulting changes.
Local synthetic checks and restores do not establish hosted recovery acceptance.

Upstream added replay-refusal guards to two historical storage migration files.
The previous hosted batch still has its original recorded SQL fingerprint; it
cannot prove application of the modified media source. The ledger map therefore
removes that file from batch coverage and retains its old hash as historical
metadata. All other exact source mappings remain. A matching full catalog does
not waive the missing version: the release gate remains blocked pending a
separately reviewed reconciliation. Never replay the superseded SQL, manufacture
ledger entries, or overwrite safer live definitions to clear this hold.

Hosted backup/restore and key custody, live service acceptance, independent
integration review, signing, physical devices, TestFlight and App Store acceptance
remain separate open gates. No production deployment or migration is performed
by these local checks.

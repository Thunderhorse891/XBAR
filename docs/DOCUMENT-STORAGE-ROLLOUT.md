# Document storage rollout — expand phase

Verified against Supabase project `uxvwfepyothlakhqazwv` on September 12, 2026.

## Applied

`20260912055000_expand_document_storage_paths.sql` adds workspace-scoped
INSERT, SELECT and UPDATE policies. It preserves the existing uploader-scoped
policies so the older production app continues to work. No app promotion,
customer-file movement or deletion was performed.

The three legacy and three workspace policies were read back after application.
The schema mismatch that rejected workspace-prefixed uploads is resolved at the
database-policy layer.

## Evidence

The migration executes assertions under the authenticated role, with synthetic
owners, an Admin, a reader and an outsider. It verifies:

- Both uploader-prefixed and workspace-prefixed inserts and reads.
- Owner uploads without a redundant membership row.
- Active teammate reads of workspace files; legacy files remain uploader-only.
- Rejection of cross-workspace uploads and moves, malformed paths, reader writes,
  outside-tenant reads and signed-out reads.
- No successful client deletion.
- Read access ends after membership deactivation.

All fixture rows are rolled back through a nested subtransaction, while the
policies persist. An unexpected assertion aborts the migration. Post-run counts
remained one auth user and zero workspaces; no rollout fixture objects remained.

The first attempt rolled back on Supabase's storage.protect_delete safeguard.
The assertion now accepts either a permission denial or zero affected rows.
No deletion safeguard was disabled.

This is real PostgreSQL/RLS evidence, not a test of Storage HTTP uploads, signed
URLs, file bytes, email delivery or the entire cloud workflow. Those remain
separate release checks.

## Contract phase remains deferred

Do not apply `20260912060000_workspace_keyed_document_storage.sql` to this live
project while the older production client still uploads by user ID. That later
migration removes legacy writes. The expand migration is deliberately ordered
before it in a fresh schema; generating the combined schema is not permission
to apply every pending migration to the live project without a rollout review.

While compatibility remains, old clients can still create uploader-only files.
Their uploaders retain access after leaving a workspace. This existing legacy
behavior is not fixed by expansion. Team launch gates remain open.

Rollback must preserve access to new workspace-path objects: do not simply
remove workspace policies after new files exist. Retain both formats while
rolling the app back, or prepare a separately verified data migration.

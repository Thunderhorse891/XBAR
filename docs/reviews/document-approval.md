# Document approval boundary

Prepared migration: `supabase/migrations/20261107160000_guard_document_approval.sql`.
Production application requires Erin's explicit approval. Merging/deploying the app does not apply SQL.

## Defect and change

Ranch Manager and Sales Lead can upload documents but lack `reviewDocuments`. Existing table policies let them forge `Ready` through direct insert, update or upsert. The isolated PostgreSQL check failed on the actual authenticated insert before the guard.

The new trigger rejects approval in either the relational state or JSON payload without the canonical review capability. Uploaders may save an approved record unchanged (including upsert), or explicitly return it to review before changing it. All evidence and identity fields are compared, including future columns; only `updated_at` may differ. Changing workspace, horse, document key, original source, extracted claims or review flags cannot carry approval. The trigger runs AFTER the actual insert/update branch, and an exception rolls back the statement. It does not change grants, RLS policies or existing records.

Trusted service/admin writes retain their existing boundary. Template generation now produces `Needs Review` records for every role: generating a form is not approval of signed evidence. Server OCR commit permission is separately handled in PR371.

## Verification

`supabase/checks/document-review-writes.sql` uses real authenticated RLS with synthetic records inside a rolled-back transaction. It covers upload-role direct writes, contradictory state representations, source replacement, cross-workspace approval transfers, horse/document identity, authorized Medical Lead review, unchanged saves/upserts, and outsider refusal. The existing staff-policy checks also run after the migration. CI proves failure before the guard, success after, and repeat application.

The five template role cases execute the actual handler and inspect its database write. All failed before the change and pass afterward. No production customer records were read or changed by these tests.

## Application and recovery

Apply only the exact reviewed migration after approval. Check trigger identity, function definition, invoker security, grants and canonical capability dependency using database catalogs. Do not create synthetic customer records in production.

Before commit, migration failure rolls back the transaction. After commit, do not remove this guard to restore writes: that would restore the approval bypass. If a compatibility defect is discovered, preserve original records, keep the guard, and prepare a reviewed forward correction. The application can return a document to `Needs Review` explicitly before editing, then obtain review from an authorized role.

## Limits

This does not retroactively certify existing `Ready` rows, authorize public original-file downloads, or replace the separate horse-photo approval guard. It does not sanitize the contents of a document or decide whether a human review was accurate. Those remain distinct boundaries.

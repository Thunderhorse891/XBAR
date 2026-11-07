# Sale photo approval boundary

Prepared migration: `supabase/migrations/20261107163000_guard_sale_media_approval.sql`.
Production application requires Erin's explicit approval. Website deployment does not apply SQL.

## Scope

New photo uploads always wait for review. Uploading a first photo no longer sets sales readiness. Admins and Sales Leads can explicitly approve or withdraw an active photo in the gallery; other roles cannot. Restoring retained bytes does not restore approval for someone without sales authority, including a stale local Admin after cloud demotion.

Shared review calls a narrow authenticated endpoint. It checks canonical workspace membership and sales permission before reading and again before writing, compares the selected source identity, rejects archived or ambiguous assets, compares the complete horse payload atomically, and confirms the exact saved horse. It preserves unrelated horse fields and reports errors or missing acknowledgments. The client checks workspace, account, original source and role again before changing its displayed status. Local-only review is labeled as device-only.

The database guard prevents ordinary horse writes from forging approval. Existing approval is reusable only for the same asset ID, URL and storage path on the same horse in the same workspace. Pending uploads and unchanged approved saves remain valid. An AFTER trigger checks the actual INSERT/UPDATE branch so ordinary unchanged upserts continue working. It uses invoker security and the canonical manageSales capability. Trusted service writers remain responsible for their own authorization.

This ports a bounded protection from PR265 cc155fa5, using a new migration without editing or replaying the historical source. No originals, historical approvals, storage ownership, pricing or Stripe settings are changed.

## Verification

Real isolated PostgreSQL role writes reproduce the approval bypass before the guard, then pass after applying it. Cases cover forged insertion/update, changed source identity, transfers between workspaces/horses, legitimate sales review, ordinary edits, unchanged upserts and retained pending transfers. CI repeats the migration and runs existing staff policy checks.

Actual store tests cover pending uploads and denied/stale roles; actual handler tests cover acknowledgments, concurrent changes, membership loss and archived images. Browser tests exercise explicit approval/withdrawal, reload persistence, role visibility and existing original-file operations without retries.

## Production application and recovery

After review and explicit approval, apply only this exact migration. Verify function/trigger definitions, invoker security and grants through catalogs. Use synthetic records only on isolated databases, not production customers.

The migration is transactional. A failure before commit rolls it back. After commit, keep the approval guard in place and prepare a reviewed forward fix for compatibility problems; dropping it would reopen the bypass. Pending photos remain available internally. Existing originals remain retained.

## Limits

This does not prove the quality of a human review or retroactively validate historical Approved records. Storage access, public buyer projection, old-client behavior and restore acceptance remain separate boundaries. An API acknowledgment is required for shared approval, and a failed response may require reloading to learn whether a server write committed.

# Sale photo approval boundary

Prepared migration: `supabase/migrations/20261107163000_guard_sale_media_approval.sql`.
Production application requires Erin's explicit approval. Website deployment does not apply SQL.

## Scope

New photo uploads always wait for review. Uploading a first photo no longer sets sales readiness. Admins and Sales Leads can explicitly approve or withdraw an active photo in the gallery; other roles cannot. Restoring retained bytes does not restore approval for someone without sales authority, including a stale local Admin after cloud demotion.

Shared review uses the existing guarded autosave path. Account/workspace readiness and both local and authoritative cloud roles are checked before changing the selected active image. Approval and pending primary/source edits stay on one autosave baseline; the authenticated database guard and atomic payload/revision comparison enforce the server boundary. The action reports that cloud save is queued, not that a server write has been confirmed. Users must confirm sync completes before sharing. Local-only review is labeled as device-only.

The database guard prevents ordinary horse writes from forging approval. Existing approval is reusable only for the same asset ID, URL and storage path on the same horse in the same workspace. Pending uploads and unchanged approved saves remain valid. An AFTER trigger checks the actual INSERT/UPDATE branch so ordinary unchanged upserts continue working. It uses invoker security and the canonical manageSales capability. Trusted service writers remain responsible for their own authorization.

This ports a bounded protection from PR265 cc155fa5, using a new migration without editing or replaying the historical source. No originals, historical approvals, storage ownership, pricing or Stripe settings are changed.

## Verification

Real isolated PostgreSQL role writes reproduce the approval bypass before the guard, then pass after applying it. Cases cover forged insertion/update, changed source identity, transfers between workspaces/horses, legitimate sales review, ordinary edits, unchanged upserts and retained pending transfers. CI repeats the migration and runs existing staff policy checks.

Actual store tests cover pending uploads and denied/stale roles. The real cloud persistence helper reproduces an approval/primary-photo autosave conflict before coordination and successfully saves both changes afterward. Browser tests exercise explicit approval/withdrawal, reload persistence, role visibility and existing original-file operations without retries.

## Production application and recovery

After review and explicit approval, apply only this exact migration. Verify function/trigger definitions, invoker security and grants through catalogs. Use synthetic records only on isolated databases, not production customers.

The migration is transactional. A failure before commit rolls it back. After commit, keep the approval guard in place and prepare a reviewed forward fix for compatibility problems; dropping it would reopen the bypass. Pending photos remain available internally. Existing originals remain retained.

## Limits

This does not prove the quality of a human review or retroactively validate historical Approved records. Storage access, public buyer projection, old-client behavior and restore acceptance remain separate boundaries. A local approval is pending until autosave confirms it; network errors or concurrent remote edits retain local work and surface the normal cloud-save warning.

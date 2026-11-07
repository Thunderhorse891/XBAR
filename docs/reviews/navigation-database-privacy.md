# Navigation event database privacy

Prepared migration: `supabase/migrations/20261107170000_private_navigation_events.sql`.
Production application requires Erin's explicit approval. This is separate from PR370's deployed client/API sanitizer.

## Scope and impact

An older browser can write navigation events directly to runtime_events. A database trigger sanitizes every new or updated navigation.page_view event, including service writes: only a relative pathname remains, with query and fragment removed. Invalid pathnames produce an empty payload. Arbitrary extra navigation metadata is discarded. Other event types and all ownership, event IDs and timestamps remain unchanged.

The same transaction scrubs historical navigation payloads using the same trigger. This intentionally and permanently removes those old query strings and extra navigation fields from the live table. It does not change customer horse/document records, original files, permissions, buyer tokens or Stripe configuration. Backups and external logs may still contain historical values; this migration does not certify or scrub those systems.

## Verification

The actual PostgreSQL direct insert retains synthetic secret-bearing metadata before this migration. The same test passes after it, along with malformed payload handling, privileged updates, historical cleanup with identity preserved, unrelated event preservation and outsider RLS denial. Repeat application also passes. CI uses a disposable database with production columns/policies and synthetic records only.

## Approved application and recovery

Apply only the reviewed file after explicit approval. First record catalog identity and aggregate affected-row count without selecting payload contents. After application, verify the trigger and function definition, invoker security, unchanged RLS and zero navigation rows needing sanitization. Do not create test events in a production customer's workspace.

The transaction rolls back if application fails before commit. After commit, keep the guard; use a reviewed forward correction if a compatibility defect appears. The removal of historical sensitive metadata is intentional and has no data-restoring rollback. Never restore sensitive query strings from a backup as a rollback mechanism.

## Limits

This protects navigation.page_view payloads, not arbitrary application logs or every event type. It does not revoke previously exposed credentials or prove those credentials were accessed by someone else. Credential decisions require separate evidence and authorization.

# Database backup and restore

## Status and $0 constraints

Supabase Free does **not** promise accessible managed daily backups or PITR.
[Supabase recommends off-site logical dumps for Free](https://supabase.com/docs/guides/platform/backups).
Do not enable a paid feature. The production database password and a hosted scratch
destination have not been supplied to this work. A local synthetic drill is not a
production backup or hosted Supabase recovery acceptance.

`database-backup.yml` schedules one daily logical dump at 03:41 UTC on main. It fails
if `BACKUP_DATABASE_URL` or the 64-hex-character `BACKUP_ENCRYPTION_KEY` secret is absent.
Use a session-pooler/direct Postgres connection (not a transaction pooler), TLS with
certificate validation, and a PostgreSQL 17 client matching production's major version.
Set secrets through GitHub settings; never paste them in an issue, PR, command argument
or committed file. Keep a separate offline copy of the encryption key for recovery.

The archive contains a complete `pg_dump` custom-format database and password-free
role definitions. AES-256-GCM authenticates and encrypts the payload before upload.
This repository is public: **only `.enc` ciphertext and its non-secret receipt may
be uploaded**. No plaintext dump, customer counts, SQL or provider errors go to logs.
GitHub artifact retention is seven days, with a 50 MiB payload cap per run. This bounds
this workflow's storage below 351 MiB for seven daily runs; other repository artifacts
also consume the free allowance. Check allowance before activation, disable paid
overages, and use another owner-approved free destination if it cannot fit. A cap
failure is an alert, not permission to truncate the dump. Daily RPO is up to 24 hours
plus any outage; there is no PITR claim.

Database dumps include Storage **metadata**, not photo/document object bytes, platform
configuration, SMTP/Stripe keys, custom-role passwords or un-synced browser data.
Keep an independently verified object archive and a secure configuration inventory.
Database recovery alone is not full-app disaster recovery or a replacement for those.

## Restore drill (never point this at production)

1. Download the encrypted artifact and its JSON receipt from the successful backup run.
   Verify the SHA-256 against `archiveSha256`; retain its GitHub run URL.
2. Provision an empty, isolated scratch PostgreSQL 17 database named `xbar_restore_*`.
   The automated helper accepts localhost only and refuses occupied databases. On a
   separate cluster, review and restore the archived role definitions first; no role
   passwords are stored. Extensions installed in production must also be available.
3. Set `RESTORE_DATABASE_URL` and `BACKUP_ENCRYPTION_KEY` privately, then run
   `node scripts/database-backup.mjs restore /absolute/path/database.enc`.
   Restore uses `--exit-on-error --single-transaction`. Any error invalidates the drill.
4. Verify schema objects, row counts and representative document/ownership/billing
   relationships against the backup-time inventory. Exercise RLS as `authenticated`
   users in two different workspaces, and verify subscription writes are denied.
   Confirm restored Storage metadata against the separately restored object archive.
5. Only after these checks, attach the scratch target, verification time and the SAME
   archive checksum to the receipt's `restore` object, with `schemaAndDataVerified`
   and `rlsVerified` true. Keep the raw test results alongside the receipt. The restore
   command deliberately does not set these flags merely because SQL loaded.
6. Production preflight needs `BACKUP_EVIDENCE_PATH` pointing to that receipt and
   `XBAR_BACKUP_SOURCE_REF=uxvwfepyothlakhqazwv`. It rejects missing/mismatched evidence,
   backups older than 36 hours, restores older than seven days and same-target drills.
   Repeat validation for a new archive; don't relabel an older drill's checksum.

For a hosted Supabase scratch project, use the official
[platform restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
Managed schemas, installed extensions and platform roles differ from vanilla Postgres;
do not replay a raw full dump over an existing Supabase project blindly. This requires
Erin's scratch-project choice and credentials. No existing project may be repurposed.

## Actual recovery and rollback

Freeze application writes, preserve the failing database and newest usable archive,
and obtain Erin's explicit production migration/restore approval. Restore and validate
in scratch first. Record RPO/data loss, measured restore duration and validation logs.
Promote only after database, auth, storage objects and app workflows pass. Retain the
original project and connection settings until acceptance; rollback means returning
to that preserved project, not deleting evidence. Never delete the original or reset
its password as part of an automated drill.

## Alerting

Enable notifications for failed `database-backup` and `production-monitor` Actions runs.
The uptime workflow also checks that a successful backup run is recent and its
matching, nonempty encrypted artifact has not been deleted or expired; a stopped
backup schedule or missing archive cannot silently remain green. Artifact metadata
does not prove decryption or restoration. An absent successful restore receipt
keeps go-live preflight blocked even if scheduled dumps succeed.

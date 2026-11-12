# Storage quota accounting and release gates

## Provider billing-period restrictions

Supabase measures Storage quota and billing using the billing-period average,
not only the live object size. Deleting files reduces future accumulated usage
but does not erase earlier usage or necessarily restore uploads immediately.
Free-plan usage restrictions generally lift at the next billing-cycle refill,
possibly after a delay. Verify the actual organization cycle and restriction
state before giving a reset date; no upgrade or purchase is authorized here.

The application's 900,000,000-byte admission budget counts current measured
objects and outstanding reservations. It does not reset provider usage history
or guarantee availability while the provider restricts uploads. Keep originals
and truthful local-only fallback; do not recommend deletion as a guaranteed
immediate remedy. Existing reads, downloads and recovery remain available where
the provider permits them.

Sources:
https://supabase.com/docs/guides/platform/manage-your-usage/storage-size
https://supabase.com/docs/guides/platform/billing-faq#how-can-i-remove-restrictions-applied-from-the-fair-use-policy

## Prepared accounting correction

`20261112130000_storage_object_accounting.sql` changes the existing usage RPC to
read backend-measured `storage.objects.metadata.size` for `horse-media`,
`horse-documents` and `sale-packets`, including receipt scans and successful unreferenced uploads.
Document and packet rows already represented by those objects are not charged
again. Unrepresented legacy row sizes remain charged. Receipt files with known
sizes are included; device-only files and external image URLs are not cloud bytes.

The read uses one database snapshot. Missing, invalid, negative or overflowing
object sizes are unknown, never zero. Legacy uploader-prefix references cannot
be attributed to a ranch from a mutable gallery alone; these and missing
unsized cloud-media references fail usage checks closed until reconciled.
Reads, exports, downloads, recovery snapshots, and unchanged or reduced existing
relational records are preserved. No object or customer record is rewritten.

The relational storage trigger uses only the byte delta not already represented
by a Storage object. This preserves above-cap edits and avoids double-charging a
successful upload when its relational record is subsequently saved.

## This is not an atomic upload quota

Actual Storage uploads precede relational writes. Correct accounting and precise
preflight checks do not serialize simultaneous uploads across devices. Do not
claim this migration alone guarantees a hard aggregate upload quota. The coordinated reservation boundary is prepared in
[Reserved Storage uploads](RESERVED-STORAGE-UPLOADS.md); it requires separate
release validation and approval. Local native PostgreSQL and real Storage/app
service tests pass, but pre-cutover signed REST/TUS upload tokens remain valid
after policy restriction, including requests completing after token expiry.
Provider-supported revocation and in-flight drain verification are mandatory;
waiting two hours alone or rotating ordinary Auth keys is not sufficient proof.
See the linked cutover gates before claiming strict aggregate enforcement.
Reservations based only on a browser-provided size cannot prevent oversized
uploads, and expiry alone cannot prove an in-flight upload has stopped.

No trigger is added to `storage.objects`. Supabase recommends treating the
Storage schema as read-only except for documented policy/index customization:
https://supabase.com/docs/guides/storage/schema/design

Source inspection on November 12, 2026 found rolled-back permission probes
before upload (with size potentially absent), followed by backend upload and a
final metadata transaction. A metadata-trigger rejection can therefore occur
after object bytes exist and depend on asynchronous service cleanup. The source
was current upstream, not a verification of the deployed project's version:
https://github.com/supabase/storage/blob/master/src/storage/uploader.ts
https://github.com/supabase/storage/blob/master/src/storage/database/pg.ts

## Required validation and application

- Run the full application test suite and final-head review.
- Load the generated schema on a disposable PostgreSQL instance and run
  `tests/database/storage-object-accounting.sql`, the Free RLS checks, and the
  real multi-connection relational quota checks.
- Before production, perform a read-only inventory of object sizes, prefixes,
  legacy references and unknown metadata. Reconcile ambiguous records through
  supported APIs without deleting originals or weakening workspace isolation.
- Validate real Storage upload, failure, cancellation and uncertain-response
  behavior before releasing any atomic reservation enforcement.
- Obtain Erin's explicit approval for this migration. Code deployment does not
  apply SQL or grant that approval.

Rollback restores the prior `xbar_workspace_storage_bytes` and
`xbar_enforce_storage_limit` definitions and corresponding application accounting.
It must never remove objects, existing rows, recovery snapshots, or trial/billing
history. Keep the private size parser if anything still depends on it.

The caller-facing usage RPC retains the workspace authorization guard also
prepared in PR395: an authenticated owner/active member or service role may read
usage; outsiders and anonymous callers cannot. Authorization runs before unknown
metadata is inspected. Its internal accounting helper has no client/service-role
EXECUTE grant and is reached only through the guarded RPC or trusted relational
triggers. Apply migrations in version order so an older RPC definition cannot
replace the newer guarded object-accounting implementation.

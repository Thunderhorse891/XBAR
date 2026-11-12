# Reserved Storage uploads: coordinated release contract

Prepared code is not deployed enforcement. Applying
`20261112140000_reserved_storage_uploads.sql` requires the owner's separate
production migration approval, working server upload endpoints, approved
server-only S3 credentials, and real-provider validation. Never apply its direct
write restrictions before the replacement path is ready.

## Authority and accounting

`workspace_upload_reservations` is private. Only service-role RPCs mutate it;
even service-role direct table DML is withheld. The API authorizes the current
actor's bucket/kind-specific capability on every action. The DB additionally
checks workspace membership/ownership at reservation and completion transitions.

A reservation binds immutable workspace, actor, request UUID, new object path,
expected bytes, content type and kind. Kinds are document, receipt, media and
packet. Media uses `horse-media`; packets use `sale-packets`; other originals use
`horse-documents`. Every key contains the reservation UUID and workspace prefix;
existing keys cannot be reserved or overwritten.

Capacity admission takes the existing workspace transaction lock. A single
snapshot combines actual object/legacy accounting with every active reservation.
For each reservation, only the expected bytes not already represented by its
actual object are added. Unknown object sizes remain a refusal, never zero.
Quota follows the existing billing/trial helpers; no customer subscription is
rewritten. No state is released merely because time or a signed URL expires.

## Durable state transitions

- `reserved`: capacity held; no provider creation may have started.
- `xbar_begin_upload` claims `uploading/create` **before** CreateMultipartUpload.
- `xbar_bind_upload` stores the provider ID and clears the creation claim. A lost
  creation response stays charged; reconciliation may bind only the recovered
  matching provider upload, not create another one blindly.
- `xbar_claim_upload_completion` claims `completing/verify`, excluding abort.
  The server verifies the full contiguous part manifest and exact measured byte
  total. Provider subset completion is allowed, so this check is mandatory.
- Known incomplete/invalid manifests can call `xbar_release_upload_completion`
  before any completion request, returning to uploading.
- `xbar_start_upload_completion` permanently records completion-started before
  the server sends CompleteMultipartUpload. After this point, no abort or return
  to uploading is allowed. A lost response remains charged and reconcilable.
- `xbar_settle_upload_stored` requires the same completion token and one actual
  object with exactly the reserved byte count. It never deletes or overwrites.
- `xbar_claim_upload_abort` can claim an untouched reservation or a bound upload,
  never an unknown creation or a competing completion. Settlement requires a
  trusted provider abort confirmation, no final object and no completion-start.
- `xbar_mark_upload_reconcile` preserves the claim token and action. A known
  abort retry can reuse its claim. An uncertain completion may only reconcile to
  an exactly verified stored object; it cannot release capacity as an abort.

Private claim tokens and provider IDs must not be returned to the browser.
Clients receive only UploadPart URLs with signed Content-Length. They never
receive provider completion authority. Same-length content changes remain
possible with UNSIGNED-PAYLOAD; this is a quota boundary, not a content-integrity
signature. Keep original files until a verified stored or aborted outcome.

## Direct writes and recovery

Restrictive INSERT/UPDATE policies block new direct authenticated writes and
ordinary upload-token issuance for all three app buckets, even if legacy
permissive policies remain. They do not revoke previously delegated signed
upload authority; the cutover gates below are mandatory.
Existing SELECT and DELETE policies are unchanged; no new delete permission is
granted. No trigger or direct object mutation is added to the Storage schema.

Pending/uncertain reservations block destructive workspace cascades instead of
silently erasing the recovery state. Existing objects, over-cap records,
non-growth relational edits, downloads and recovery snapshots are preserved.
Terminal reservation rows may cascade during the established deletion workflow.

### Verified cutover gap and mandatory gates

On unmodified Supabase Storage v1.94.0, ordinary signed REST and signed TUS
upload tokens issued before the restrictive policies still uploaded afterward
without reservations. New token issuance and direct authenticated REST/TUS
uploads were denied. An unused expired token was rejected, but a signed request
admitted before expiry completed after expiry. A two-hour wait alone is therefore
not a proven drain and does not establish a strict aggregate quota.

Before production enablement:

- Perform a read-only inventory of existing upload issuance paths, delegated
  credentials, objects and unresolved uploads. Preserve originals and recovery
  records.
- Verify provider-supported revocation and in-flight drain guarantees for the
  actual hosted Storage version and backing store. Obtain separate approval for
  any consequential revocation or configuration action. Until verified, do not
  claim strict aggregate quota enforcement.
- Do not substitute ordinary Auth-key rotation or object deletion. Storage
  v1.94.0 uses a dedicated `urlSigningKey`; Supabase's
  [signed URL guidance](https://supabase.com/docs/guides/storage/serving/downloads#signing-urls)
  warns that Auth-key rotation does not revoke Storage signed URLs and directs
  revocation requests to support. Hosted in-flight drain guarantees remain
  unverified.

## Tests and rollback

Run `tests/database/reserved-storage-uploads.sql` on the disposable full schema,
then `tests/database/reserved-storage-concurrency.mjs` on native PostgreSQL.
The latter accepts an isolated `PG_MODULE_PATH` and refuses non-local/non-fixture
databases. CI supplies PostgreSQL 17.6 and a temporary pg client installation.

Local validation passed on native PostgreSQL 17.6: generated full schema,
role/RLS and lifecycle checks, concurrent reservation admission, competing
completion/abort claims, and coherent actual-plus-reservation accounting reads.
The app service also passed against unmodified Storage v1.94.0 and its actual
catalog: exact charging, manifest rejection before completion, lost creation and
completion responses, reconciliation, and claim races.

Signed part byte limits and in-flight abort were verified locally. Physical
staging files were proved reclaimed only after the in-flight request settled on
the local file backend, not immediately at abort response or on hosted storage.
These checks used synthetic files and disposable loopback services. PostgREST
HTTP integration, live hosted behavior and browser validation are separate
checks; local native RPC/service success does not establish them. The old-token
cutover gap above remains a release blocker despite these passing tests.

Rollback must preserve all reservations, especially completing/reconcile states,
and retain their byte charges until verified settlement. Do not truncate the
ledger, relax policies into a live unreserved path, delete original objects, or
re-enable a released request ID. Stop new uploads while restoring a known-safe
coordinated server/database version and recover unresolved uploads explicitly.

## Project hosting budget (prepared additive migration)

`20261112150000_project_storage_budget.sql` adds a separate aggregate admission
budget of **900,000,000 bytes**, leaving 100,000,000 bytes below a documented
1,000,000,000-byte hosting allowance. Workspace plan entitlements are unchanged;
shared hosting capacity can prevent a new upload even below a workspace limit.
This is not a guarantee against provider shutdown: other metered resources,
provider accounting, temporary multipart staging and unreserved privileged writes
remain outside this final-object/reservation counter. The signed-token cutover
and hosted drain gates above still apply.

Every backend-measured object across every bucket, including orphans, is counted.
Active reservations add only bytes not already represented by their actual
object. Unknown object sizes refuse new admission. A singleton row lock serializes
new reservations across workspaces; the counter uses one coherent snapshot after
the lock. Admission requires READ COMMITTED isolation. Existing idempotent
requests, completion, reconciliation, reads, downloads and recovery remain
available above budget. No expiry releases a reservation, and no data is trimmed.

The private `upload_project_budget` table has no application-role access or RPC
setter. An approved operator may deliberately update its single `limit_bytes`
row through privileged SQL; the row lock also serializes that change with new
admission. Do not delete the row or expose aggregate totals to clients. Raising
the budget requires separately verified hosting capacity and explicit approval;
it is not an automatic hosting upgrade.

Apply only after migration 140000 and coordinated API handling are ready, with
separate production approval and read-only provider/object inventory. A new
transaction-refused admission returns PZ001 (capacity reached) or PZ002 (unknown
capacity); a duplicate committed reservation is checked first and never receives
those codes. Only a definitive reserve RPC error can mean “not started”; network
uncertainty retains recovery. Native regressions are in
`tests/database/project-storage-budget-concurrency.mjs`.

For rollback, stop new upload admission before restoring the previous coordinated
version. Preserve the budget row, ledger, objects and unresolved charges; removing
the admission trigger reopens shared-capacity oversubscription and is not a safe
standalone rollback. Reducing the setting never evicts existing data or cancels
held uploads.

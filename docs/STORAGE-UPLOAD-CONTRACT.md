# Controlled storage upload contract

Status: local implementation and synthetic/local-provider verification only. This is not a production rollout or a statement that the hosted Storage version has been verified.

## Boundary

The public endpoint is `POST /api/storage/uploads`, an exact Vercel rewrite to the existing documents function. It accepts JSON control messages up to 16 KiB, never file bytes. The existing OCR and template actions continue consuming their own raw JSON streams. The total Vercel function count remains twelve.

The caller is authenticated against the requested workspace on each request. Documents require `uploadDocuments`, media requires `uploadMedia`, and receipts require `manageAssets`. Server-generated sale packets require `manageSales` and continue through the existing tier-controlled packet workflow. An actor can operate only their own reservations in the active workspace. Direct client-supplied storage paths, provider upload IDs, completion manifests and overwrites are refused.

The server generates a new random destination. Media retains the established workspace/horse path and sanitization contract so buyer photo signing continues to work. Generated documents and packets retain their existing random document/packet IDs and paths. Their UUID is also the recovery reservation ID.

## Lifecycle and exact bytes

1. Reserve exact positive bytes under the database workspace lock. Existing objects plus pending reservations share the quota, without counting a reservation's existing object twice.
2. Claim creation durably before calling S3. Bind the provider upload ID before returning any URL. An uncertain creation stays charged; status can bind an exactly matching, uniquely discovered multipart upload. A reservation not yet begun is safely retryable or abortable under CAS.
3. Issue only five-minute `UploadPart` URLs for server-selected fixed part numbers and sizes. Parts are 8 MiB except the final remainder. `Content-Length` is signed. Batches contain at most 32 URLs. No presigned completion, abort or object-overwrite URL is issued. S3 credentials stay server-side, with no Supabase service-role JWT or AWS session token in the URLs.
4. Claim verification exclusively, list every provider page, and require exact part count, contiguous ordered numbers, each measured size and an ETag. Missing, extra or mismatched parts release only that verification claim, allowing the same upload to resume or cancel.
5. Record durable completion start before calling the provider. After that point cancellation cannot release the reservation. A successful result requires exact `HEAD` size and an independent database check of the actual Storage object. A lost provider response can be recovered through these checks.
6. Cancellation claims exclusively and never deletes a final object. It verifies no final object, performs multipart abort, verifies the upload no longer exists, rechecks the final object, and settles the database claim. Unknown outcomes remain charged. Elapsed time alone never releases a reservation.

The same state machine and transport handle server-generated Buffers. Failed document/packet row saves retain the original bytes and their recovery identity. There is no automatic object deletion and no direct-upload fallback.

## Hosting file-size admission

New browser-controlled uploads and generated Buffer uploads share a server-side
per-file gate before any quota reservation or provider creation. The default is
**50,000,000 bytes (decimal 50 MB)**. An explicit server-only
`SUPABASE_STORAGE_MAX_FILE_BYTES` can specify a lower verified byte limit, or a
higher limit only after an authorized hosting upgrade. It must be a positive
integer byte count within the supported multipart range. Invalid configuration
fails closed before a new reservation. This does not alter product tier quotas
or buy hosting capacity.

The [official upload-limit documentation](https://supabase.com/docs/guides/storage/uploads/file-limits)
states a 50 MB Free-project maximum and allows lower global/bucket settings. In
[Storage v1.94.0's size parser](https://github.com/supabase/storage/blob/v1.94.0/src/storage/limits.ts),
MB means 1,000,000 bytes; its tests explicitly map `50mb` to `50_000_000`. Older
tenant defaults and examples use 52,428,800 bytes (50 MiB), so the decimal default
is deliberately conservative. **The actual project's global limit and any lower
bucket limit have not been verified by this implementation.** Confirm them before
rollout and configure the application no higher than their minimum. A per-file
ceiling is distinct from the hosting project's shared total storage allowance.

An oversized new request returns HTTP 413, `upload_file_too_large`, the byte
ceiling, `uploadOutcome: not_started` and `needsRecovery: false`. It makes no
reservation, uploads no parts, performs no cleanup and retains the original.
Template/packet responses preserve that distinction. Bulk OCR checks every new
original before writing the batch inventory. Existing stored originals and plan
quotas are preserved. An earlier held reservation is never mislabeled as not
started when the ceiling changes; it keeps its recovery identity and charge.

## Shared hosting admission budget

The additional project-budget migration defaults to **900,000,000 bytes** across
all actual Storage objects in every bucket plus pending reservations, including
other workspaces. That is a conservative 100,000,000-byte headroom beneath a
decimal 1 GB hosting allowance. It does not change the product's legacy tier
limits. The budget is configurable only through privileged owner-operated SQL;
ordinary users and the application service role cannot read or change the budget
or retrieve aggregate project totals.

A project-wide lock serializes new admissions. Once it holds that lock, the
trigger rechecks the reservation ID before evaluating capacity. A duplicate ID
returns an ordinary state conflict, never a claim that an earlier upload did not
start. Existing/idempotent reservations remain recoverable. Actual bytes matched
to a pending reservation are not charged twice, and unknown object sizes refuse
new admission rather than pretending space is available.

Only the exact, transaction-confirmed new-reservation errors `PZ001` and `PZ002`
map to `upload_shared_capacity_reached` (HTTP 507) and
`upload_shared_capacity_unavailable` (HTTP 503), respectively. The API requires
the expected diagnostic, strictly null returned data and explicit new-admission
context. These responses carry the requested ID, `needsRecovery: false` and
`uploadOutcome: not_started`, without object paths, part URLs or aggregate totals.
A thrown transport error, generic SQL exception, contradictory returned data,
later lifecycle error or existing reservation retains the normal recovery path.

Generated Buffer refusals preserve the same distinction. If a bulk intake has
already saved its batch inventory, its individual refused file is marked
`not_started`, while the batch still reports that its saved records need recovery.
Earlier originals are not deleted or falsely classified as unstarted.

This controls admission through the supported application path. It does not
revoke previously issued upload authority or constrain external privileged
writes. Those remain separate coordinated rollout requirements.

## Recovery limitations

- After completion may have started, an absent object does not prove the provider can no longer complete it. Such a reservation stays charged and pending. Status does not blindly repeat completion or abort it. An operator must reconcile the specific provider operation before any further action.
- Creation with no discoverable multipart upload can still be in flight. It remains pending rather than creating another upload or releasing quota.
- The public API does not let a different member take over another actor's reservation. If the actor leaves the workspace, an authorized operator must use the service-only reconciliation/abort workflow. Database protections prevent pending reservations from being erased through workspace deletion.
- The local provider abort test proves final object absence and eventual local file cleanup for the tested version/backend. An in-flight upload can temporarily hold an already-unlinked file descriptor until it settles. Abort acknowledgment alone is not a claim of immediate physical disk reclamation.
- Signed part URLs bind size and destination, not content identity. Same-length replacement bytes are possible until completion. Completion checks provider ETags and sizes; it does not claim a cryptographic original-content guarantee.

## Release gates

Do not enable direct browser writes as a compatibility fallback. Deploying the restrictive Storage write policies without compatible clients/server credentials will deliberately stop old direct upload flows. Before owner-approved production rollout:

- Verify the actual hosted Storage version and S3 behavior, including signed length enforcement, exact part listing, abort races, old signed-upload-token replay, and large multipart uploads.
- Verify actual browser and native CORS/preflight behavior against the hosted S3 endpoint, including automatically supplied `Content-Length` and expired URLs.
- Coordinate migration, supported clients, server API routing, and server-only S3 credential configuration. Production migration and credential creation/configuration require the relevant owner authorization.
- Preserve every prior object, recovery record and visual surface. Re-run full tests, type checking, lint, formatting, final-head review and the affected real workflows before declaring delivery.

Environment variables are documented in `.env.example`. No production credentials, migration, deployment, PR or remote delivery are part of this local implementation.

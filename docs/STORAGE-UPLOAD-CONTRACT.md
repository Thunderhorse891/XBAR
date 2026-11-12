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

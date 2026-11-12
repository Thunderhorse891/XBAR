# Reserved upload browser client

This is a **local implementation**, not evidence of an atomic production upload cap. The Supabase Storage provider, browser and native tests in the rollout plan remain release gates. No production credentials or settings were used while implementing this client.

## Transport and identity

- Documents, receipts and horse media call the small JSON `/api/storage/uploads` endpoint. Receipts explicitly request `kind: receipt` (`manageAssets`), documents `uploadDocuments`, and media `uploadMedia`.
- The caller's account and workspace are pinned. The live session, selected workspace and relevant role are checked before every JSON request, before and after every part PUT, and before returning the confirmed path. The stores retain their final identity checks before installing records.
- The server chooses the object key. The client validates workspace, bucket, exact byte count, canonical object path, and the configured project's S3 origins. Redirects, credentials in destinations, wrong paths/parts and signatures without signed Content-Length are refused.
- A part is an exact Blob slice, normally 8 MiB, sent directly to Supabase Storage. JavaScript does not set the forbidden Content-Length header. The browser supplies Blob length. No original body crosses the JSON endpoint, no ETags or completion manifest are trusted from the browser, and no ordinary authenticated Storage upload is an error fallback.
- URLs are requested in batches of at most 32. Before each sequential part, local elapsed time, control-request latency and a 30-second safety margin determine whether its URL needs refreshing. Only the needed part is re-signed inside the same reservation and multipart session; completed parts are not repeated. An unexpected provider 403 receives at most one fresh-URL retry using the identical Blob slice. Refresh rechecks live identity, server upload state and destination, never retries completion, and stops if a fresh URL arrives too late. More than 32 parts and a final one-byte slice are covered by mocked behavioral tests. The actual server AWS signer is also exercised against the client validator without sending a provider request.

## Recovery and original retention

Before any reservation request, the client generates a UUID and durably writes account/workspace/kind/file metadata to this browser's recovery journal. If that small record cannot be persisted and read back, it refuses before network activity. The server-owned path and subsequent status are added after responses. Signed URLs and auth tokens are never journaled.

A second original copy is best effort in a separate IndexedDB store. Device quota failure does **not** prevent cloud upload when the metadata journal is durable. The record honestly distinguishes a retained device copy from a file that must be kept/reselected. Existing document and receipt fallback copies remain intact, and intake fallback ownership is pinned before asynchronous work. Pending copies cannot be swept by the ordinary document-vault orphan collector. Recovery metadata and retained originals have no automatic expiry or deletion.

Explicit resume checks server status first and reuses the reservation. It uploads only a retained original or the same in-memory Blob; a matching filename and byte count are not proof that a reselected file is identical. Without a retained original, status/cancellation remain available, and the user must receive confirmed cancellation before selecting the original for a fresh upload. There is no automatic retry of uncertain completion.

Settings adds an existing-style **Unfinished uploads** panel scoped to the current account and ranch. It exposes recovery IDs and paths, Check status, and an explicit confirmation for Cancel incomplete upload. Cancellation checks status again and uses only the server abort endpoint. It permits reserved or confirmed-uploading states before any completion attempt. Completed, uncertain-completion and reconciliation states cannot be cancelled from this UI. No completed object is deleted and no recovered path is automatically linked to a record.

## Remaining limits

- Completion uncertainty can require operator reconciliation. The UI says so, keeps storage pending/charged and provides its recovery ID. It does not claim a failed or cancelled upload until confirmed.
- The panel uses this device's journal. If the user clears browser storage or changes devices, server-side list/status recovery exists through the API but is not automatically imported into this panel.
- Confirmed uploads remain available behind Show confirmed uploads, including uploads completed before an account switch prevented record attachment. A recovered completed original is surfaced for review. Linking it to an existing/new record remains a reviewed support action, not an automated retry that could attach bytes to the wrong horse.
- Browser storage is not a backup guarantee. Optional original copies may be evicted by the browser, and there is no automatic journal pruning. A later explicit cleanup/recovery workflow must preserve pending and uncertain originals.
- Tests mock fetch and identity changes. They do not prove native WebView CORS behavior, actual provider enforcement of signed length, large-file throughput, or production concurrency. Those require the independent integration/native release gates.

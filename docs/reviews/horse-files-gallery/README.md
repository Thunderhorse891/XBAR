# Horse gallery and original-file Documents (audit 29–30)

This bounded follow-on builds on the equipment/selected-context patch PR #336 and incorporates main ff043870's report fixes and c20f601d's autosave fixes unchanged.

## Behavior

- Existing uploads appear as signed-URL-aware thumbnails with an accessible lightbox, primary selection and confirmation before removal.
- Removal is reversible. Gallery entries, original URL/storage references and prior approval are retained; removed entries stop counting as active photos. Restore persists through the existing workspace contract. No original bytes are deleted.
- Explicit primary selection works for storage-path-only photos. Existing upload primary selection clears old primary flags. Buyer UI selects only approved, active real horse photos.
- Horse Documents reuses the existing DocumentLibrary, showing actual horse-linked files, processing state and storage availability independently of extracted facts. Legacy unassigned references are included; another horse's assigned file is never pulled in by a stale reference.
- Open file uses the canonical preview helper. Download original resolves actual bytes and delegates saving to the existing browser/native helper. Horse-specific upload/review preserves the horse.
- File resolution and download are bounded; stale ranch/account/record changes stop delivery, late handles are released, and failures/cancellation remain truthful.

## Verification

New actual-store, download and controlled component tests cover persistence/restore, all roles, missing/duplicate targets, retained bytes, storage-only primary identity, unapproved buyer images, no-facts document rows, wrong-horse exclusion, cancellation, wrong-ranch preflight, lookup failure, timeout/late cleanup and invalidation between promise continuations. Tests are individually registered in npm test. Two browser workflows cover gallery management/reload and real original-byte download from the horse Documents tab.

Independent review caught and corrected a Cancel typo, pending-photo buyer UI exposure, missing preview revalidation, unbounded source resolution and initial stale-ranch reads. Browser execution remains blocked locally by Chromium socket EPERM; exact-head CI and its screenshots are required. Physical native sharing is not claimed as verified by browser tests.

## Separate unresolved release blocker

See [the raw public-listing RPC review](public-listing-rpc-risk.md). The gallery UI's approved-photo filter does not prove server-side raw-response privacy. No migration or live customer probe was performed.

# OCR persistence and recovery

Scope: `api/_lib/documents-bulk-upload.js`, the retained server bulk OCR API.
The current browser intake uses its existing local/store pipeline; this repair
does not change extraction rules, customer documents, billing, or database schema.

## Required behavior

- An assignment succeeds only after its horse, document links, processing jobs,
  and applicable reminders return the intended identities and changed fields.
  Read errors, incomplete document sets, duplicate requested IDs, zero-row writes,
  incorrect returned identities, and thrown/lost responses must not report success.
- Batch start, document creation, job creation, and batch completion also require
  acknowledgments. Mixed or skipped intake reports incomplete completion.
- Partial responses retain the batch/document/horse identities, confirmed steps,
  failed phase, and original-file inventory. They explicitly prohibit automatic
  retry. The batch inventory is stored before the first new file upload.
- A create assignment derives one horse identity from the workspace and sorted
  source document IDs. It uses INSERT, never an overwriting upsert. An explicit
  identical retry reuses only a horse with matching source/request fingerprints;
  changed corrections are refused rather than overwriting an owner-edited horse.
- Document links and existing-horse fills compare the read state before updating.
  Processing jobs retain their target identity. A failed/unknown assignment stops
  later assignments and reports them as not attempted.
- An interrupted preview can recover a missing processing job from the persisted
  extraction, without re-uploading the original. Existing job/horse mismatches
  refuse automatic reassignment.
- Unknown document-save outcomes preserve original bytes. Cleanup is allowed
  only for this request's newly uploaded file after a definitive SQL rejection
  and a confirmed absent document row; cleanup acknowledgment is reported too.
  Client-supplied paths are never removed by this handler.

## Verification

`tests/api/ocrPersistence.test.mjs` executes the actual handler with synthetic,
stateful database/storage IO. It covers each persistence phase, incomplete reads,
reload/explicit retry, concurrent duplicate creation, lost acknowledgments,
concurrent relinking/owner edits, original retention, known-rejection cleanup,
and preview → saved extraction → commit → reloaded links.

The original main implementation reproduced the reported false successes. The
new failure assertions failed before their corresponding corrections. Existing
parser, identity, capability, and capacity suites remain part of canonical tests.

## Limits and recovery

This is not a database transaction spanning all records and object storage.
Earlier confirmed writes remain present when a later phase fails. Do not rerun
the original file upload or blindly retry the whole batch. Use the returned or
stored batch inventory, reload the documents, review their current target, and
explicitly commit the same source assignment when it remains correct. A changed
source set is a different assignment and requires review. Original uploads are
not content-deduplicated by this change.

The audit log remains best effort under its existing contract; it is not the
acknowledgment or recovery mechanism. No live customer data is used in failure
injection. Hosted customer workflow acceptance remains separate from the local
handler, CI, and production deployment evidence.

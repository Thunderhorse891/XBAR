// Where the SERVER writes a document's bytes in the `horse-documents` bucket.
//
// The first path segment is the WORKSPACE id and nothing else. The storage
// policy added in 20260912060000_workspace_keyed_document_storage.sql compares
// that segment against real workspace membership, so a path shaped any other
// way produces a file only its creator can open.
//
// These writers used `${user.id}/${workspaceId}/...`. That put the USER first,
// which the policy reads as an object from the old uploader-keyed scheme --
// and, because it keeps those readable by their uploader so existing documents
// do not break, the failure is invisible to whoever created the file. They get
// a working signed URL (the server holds the service role and bypasses RLS
// entirely), the `documents` row is shared with the whole ranch, and every
// teammate who opens it is refused. The exact defect the migration exists to
// fix, reintroduced one layer down.
//
// The service role bypassing RLS is also why the INSERT policy cannot catch
// this: nothing at the database can stop a server writer choosing a bad path.
// Only this function can, which is why both writers share it.
//
// The client counterpart is src/lib/documentStoragePath.ts. Two languages, one
// rule: first segment is the workspace, always.

/** Canonical Postgres `uuid` text, the only shape a workspace id has. */
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reduce one path component to something that cannot change the shape of the
 * path. A `/` here would silently add a segment, and `..` would be read as a
 * traversal by anything that later resolves the name as a path.
 */
export function safeDocumentSegment(value, fallback) {
  const cleaned = String(value ?? '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(-80);
  return cleaned || fallback;
}

/**
 * Build the object name, or throw.
 *
 * Throwing is deliberate. A server writer with no usable workspace id has
 * nowhere correct to put the file, and the two callers already answer a failed
 * upload with a 502 or a skip — both of which are better than writing bytes
 * that the ranch cannot read and will not know to re-upload.
 */
/**
 * May this caller name an object that already exists, rather than sending bytes?
 *
 * The bulk endpoint accepts a `storagePath` so a client that has just uploaded
 * a file directly to Storage can ask for it to be ingested without sending the
 * bytes again. It then downloads that path with the SERVICE ROLE, which
 * bypasses RLS completely -- so an unchecked path makes the endpoint a confused
 * deputy: any authenticated member could name another tenant's object, have the
 * server read it, and receive its extracted text back inside their own
 * workspace. The path is also recorded on the resulting `documents` row, and
 * horses-export.js and sale-packets.js later download by that recorded path
 * with the same service role.
 *
 * The rule deliberately mirrors the SELECT policy in
 * 20260912060000_workspace_keyed_document_storage.sql exactly: the caller's own
 * workspace, or their own uploader-keyed object from before that migration.
 * This is what the database would have allowed had the download used the
 * caller's token instead of the service role -- which is the point. A privilege
 * held only so the server can do its job must not widen what the caller can reach.
 */
export function mayUseClientStoragePath({ storagePath, workspaceId, userId }) {
  if (typeof storagePath !== 'string' || !storagePath) {
    return false;
  }
  // An empty namespace is refused here, which is also what stops an absent
  // workspace or user id matching one: below, `namespace` is always non-empty,
  // so a missing identity compares as '' and can never match it.
  const namespace = (storagePath.split('/')[0] ?? '').toLowerCase();
  if (!namespace) {
    return false;
  }
  const workspace = typeof workspaceId === 'string' ? workspaceId.toLowerCase() : '';
  const owner = typeof userId === 'string' ? userId.toLowerCase() : '';
  return namespace === workspace || namespace === owner;
}

export function documentObjectPath({ workspaceId, documentId, fileName, fallbackName = 'upload.bin' }) {
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error('A document can only be stored under a valid workspace id.');
  }
  const idSegment = safeDocumentSegment(documentId, 'document');
  const nameSegment = safeDocumentSegment(fileName, fallbackName);
  return `${workspaceId.toLowerCase()}/documents/${idSegment}/${nameSegment}`;
}

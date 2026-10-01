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
/*
 * One rule for every object path the server reads with the service role.
 *
 * The service role bypasses Storage RLS, so any path the server signs or
 * downloads on a caller's behalf must be one the database would have let that
 * caller read. Every path XBAR writes has the same shape — the workspace id,
 * then plain name segments — so that is the only shape accepted:
 *
 *   <workspace uuid>/<segment>/.../<segment>
 *   segment = letters, digits, '.', '_', '-', never starting with '.'
 *
 * A prefix comparison is not enough on its own. Storage requests travel as
 * URLs, and the URL parser resolves `..`, `%2e%2e`, `.%2E` and `..\` before
 * the request reaches Storage, so `B/../A/x` passes a first-segment check for
 * workspace B and is served from workspace A. Refusing every segment that
 * starts with a dot, and every `%` and `\`, removes all of those spellings at
 * once; nothing XBAR writes contains them (documentObjectPath,
 * buildDocumentStoragePath and the packet writer all sanitize to this shape,
 * and every object in production already matches it).
 *
 * There is no longer an uploader-keyed exception. The older `<user id>/...`
 * layout let one member's private files from ANOTHER workspace be pulled into
 * a packet or export that this whole workspace can open; no object in
 * production uses it.
 */
const CANONICAL_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const MAX_OBJECT_PATH_LENGTH = 1024;

/** The path's segments when it has the canonical shape, otherwise null. */
export function canonicalObjectSegments(path) {
  if (typeof path !== 'string' || !path || path.length > MAX_OBJECT_PATH_LENGTH) {
    return null;
  }
  const segments = path.split('/');
  if (segments.length < 2 || !segments.every((segment) => CANONICAL_SEGMENT.test(segment))) {
    return null;
  }
  return segments;
}

/**
 * May the server read this object for someone acting in `workspaceId`?
 * Only when the path is canonical and lives under that workspace.
 */
export function isWorkspaceObjectPath({ path, workspaceId }) {
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    return false;
  }
  const segments = canonicalObjectSegments(path);
  return Boolean(segments) && segments[0].toLowerCase() === workspaceId.toLowerCase();
}

/**
 * The bulk endpoint's `storagePath` (a file the client already uploaded) and
 * every recorded `documents.storage_path` are held to the same rule.
 */
export function mayUseClientStoragePath({ storagePath, workspaceId }) {
  return isWorkspaceObjectPath({ path: storagePath, workspaceId });
}

/** Recorded `sale_packets.packet_pdf_path`, same rule. */
export function mayReadPacketPath({ packetPath, workspaceId }) {
  return isWorkspaceObjectPath({ path: packetPath, workspaceId });
}

/*
 * What the seller is told when a recorded file cannot be served. Said, never
 * dropped: an export or list that quietly omitted a file would read as
 * complete. Buyer-facing text (the packet cover) uses the short form, which
 * does not describe an internal check to a buyer.
 */
export const RECORDED_PATH_REFUSED =
  'This file is not stored in this workspace, so it was not included. Re-upload it to include it.';
export const RECORDED_FILE_MISSING =
  'This file could not be found in storage. Re-upload it (or rebuild the packet) to include it.';
export const PACKET_FILE_NOT_STORED = 'No PDF is stored for this packet. Build it again to send it.';
export const BUYER_FILE_UNAVAILABLE = 'file unavailable';

/**
 * Sign recorded object paths for a caller acting in `workspaceId`.
 *
 * Returns one `{ url }` or `{ unavailable, refused? }` per input path, in order.
 * An empty path is "nothing stored", a non-canonical or foreign path is refused
 * (and flagged so the caller can audit it), and a path Storage cannot sign is
 * reported as missing — none of them come back as a bare empty link.
 */
export async function signRecordedObjects({ supabase, bucket, paths, workspaceId, ttlSeconds, emptyReason }) {
  const results = paths.map((path) => {
    if (!path) return { unavailable: emptyReason ?? RECORDED_FILE_MISSING };
    if (!isWorkspaceObjectPath({ path, workspaceId })) return { unavailable: RECORDED_PATH_REFUSED, refused: true };
    return null;
  });
  const toSign = paths.filter((_, index) => results[index] === null);
  if (toSign.length) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(toSign, ttlSeconds);
    const byPath = new Map();
    if (!error && Array.isArray(data)) {
      for (const entry of data) {
        if (entry?.path && entry.signedUrl && !entry.error) byPath.set(entry.path, entry.signedUrl);
      }
    }
    paths.forEach((path, index) => {
      if (results[index] !== null) return;
      const url = byPath.get(path);
      results[index] = url ? { url } : { unavailable: RECORDED_FILE_MISSING };
    });
  }
  return results;
}

export function documentObjectPath({ workspaceId, documentId, fileName, fallbackName = 'upload.bin' }) {
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error('A document can only be stored under a valid workspace id.');
  }
  const idSegment = safeDocumentSegment(documentId, 'document');
  const nameSegment = safeDocumentSegment(fileName, fallbackName);
  return `${workspaceId.toLowerCase()}/documents/${idSegment}/${nameSegment}`;
}

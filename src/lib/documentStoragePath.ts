/**
 * Where a document's bytes live in the shared `horse-documents` bucket.
 *
 * The first path segment is the WORKSPACE id and nothing else. The storage
 * policy compares that segment against real workspace membership, so a path
 * built any other way produces an object the rest of the ranch cannot open.
 * That is not hypothetical: every document uploaded before
 * 20260912060000_workspace_keyed_document_storage.sql was keyed to the
 * uploader's user id, which is why a shared record listed files that only one
 * person could open.
 *
 * This lives apart from `cloudWorkspace` so it can be exercised without a
 * Supabase client: the rule that decides who can read a customer's files is
 * worth testing on its own.
 */

/** Canonical Postgres `uuid` text, which is the only shape a workspace id has. */
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWorkspaceStorageKey(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_ID_PATTERN.test(value);
}

/**
 * Reduce one path component to something that cannot change the shape of the
 * path. A `/` here would silently add a segment; `..` would be read as a
 * traversal by anything that later resolves the name as a path.
 */
export function sanitizeDocumentPathSegment(value: string, fallback: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || fallback
  );
}

/**
 * The extension is the one part of the name taken from the customer's file, so
 * it is the one part an attacker picks. A file called `note.tar/../../x` yields
 * `/../../x` from a naive `split('.').pop()`, which would inject path segments.
 */
export function documentFileExtension(fileName: string): string {
  if (!fileName.includes('.')) {
    return 'bin';
  }
  const raw = fileName.split('.').pop() ?? '';
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return cleaned.slice(0, 12) || 'bin';
}

/**
 * Build the object name, or refuse.
 *
 * Refusing is the point. An unresolved or malformed workspace id has no safe
 * repair -- sanitising it would produce a different, valid-looking segment and
 * an object the policy rejects later, or worse, accepts under the wrong tenant.
 * The caller treats `null` as "the cloud did not take this file" and keeps the
 * bytes on the device, which is the honest outcome.
 */
export function buildDocumentStoragePath(params: {
  workspaceId: string | null | undefined;
  horseId?: string | null;
  objectId: string;
  originalFileName: string;
}): string | null {
  if (!isWorkspaceStorageKey(params.workspaceId)) {
    return null;
  }
  // Postgres renders `uuid` as lowercase, and the policy compares the segment
  // as text. An uppercase id would be a valid workspace id that no longer
  // matches its own workspace, so it is normalised here rather than refused.
  const workspaceSegment = params.workspaceId.toLowerCase();
  const horseSegment = sanitizeDocumentPathSegment(params.horseId ?? 'unassigned', 'unassigned');
  // The dot is built here rather than sanitised out of a name: the extension
  // still has to survive into storage for a download to open in the right app.
  const fileSegment = `${sanitizeDocumentPathSegment(params.objectId, 'file')}.${documentFileExtension(params.originalFileName)}`;
  return `${workspaceSegment}/documents/${horseSegment}/${fileSegment}`;
}

/**
 * Why someone cannot open a document that is plainly listed in front of them.
 *
 * Only called once a signed-URL request has already been refused. Every
 * readable object is filed under its workspace (migration 20261001090100
 * removed the uploader-keyed read branch), so an object whose first segment is
 * a user id -- the scheme this app used before shared ranch storage -- opens
 * for no one, its uploader included, and re-uploading it is the one fix. A
 * namespace that is neither this workspace nor the viewer is treated the same
 * way: had it been a workspace the viewer belongs to, membership would have
 * granted the URL.
 *
 * Returns `null` for this workspace's own objects, so the caller reports what
 * the storage layer actually said rather than inventing a reason.
 */
export function explainUnopenableCloudDocument(params: {
  storagePath: string;
  viewerUserId: string;
  workspaceId: string | null | undefined;
  /*
   * The HTTP status Storage refused with. Only a 4xx is a refusal about this
   * object; a 5xx or a network failure says nothing about the storage scheme,
   * and telling someone to re-upload a file that would open on a retry has
   * them create duplicates.
   */
  refusalStatus: number | undefined;
}): string | null {
  if (typeof params.refusalStatus !== 'number' || params.refusalStatus < 400 || params.refusalStatus >= 500) {
    return null;
  }
  // Compared case-insensitively on both sides: a uuid means the same thing in
  // either case, and treating one spelling as a stranger's namespace would tell
  // someone their own file belongs to a teammate.
  const namespace = (params.storagePath.split('/')[0] ?? '').toLowerCase();
  if (!isWorkspaceStorageKey(namespace)) {
    return null;
  }
  if (namespace === (params.workspaceId ?? '').toLowerCase()) {
    // This workspace's own object. Whatever went wrong, it was not the old
    // storage scheme, so say nothing about it.
    return null;
  }
  if (namespace === params.viewerUserId.toLowerCase()) {
    return 'You added this file before shared ranch storage, so it was stored under your account and can no longer be opened from the cloud. Upload it again and it will be available to everyone on the ranch.';
  }
  return 'This file was added before shared ranch storage, so it was stored under the account of the teammate who added it and can no longer be opened from the cloud. Ask them to upload it again and it will be available to everyone on the ranch.';
}

/**
 * Where a horse photo is stored: `<workspace>/horses/<horse>/media-<id>.<ext>`.
 *
 * The server signs a buyer photo only when the path has exactly this canonical
 * shape (api/_lib/buyer-media.js isHorseMediaStoragePath) and lives under the
 * listing's workspace, so the shape is built here, beside the document path,
 * where a test can drive it against the server's own check. Refuses (null)
 * without a real workspace id, for the same reason buildDocumentStoragePath
 * does: there is no correct place to put the file.
 */
export function buildMediaStoragePath(params: {
  workspaceId: string | null | undefined;
  horseId: string;
  objectId: string;
  originalFileName: string;
}): string | null {
  if (!isWorkspaceStorageKey(params.workspaceId)) {
    return null;
  }
  const horseSegment = sanitizeDocumentPathSegment(params.horseId, 'record');
  const objectSegment = sanitizeDocumentPathSegment(params.objectId, 'photo');
  const fileStem = objectSegment.startsWith('media-') ? objectSegment : `media-${objectSegment}`;
  return `${params.workspaceId.toLowerCase()}/horses/${horseSegment}/${fileStem}.${documentFileExtension(params.originalFileName)}`;
}

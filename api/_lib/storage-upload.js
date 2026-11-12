import { randomUUID } from 'node:crypto';
import { isWorkspaceId, isWorkspaceObjectPath, safeDocumentSegment } from './document-storage.js';
import { requireRoleCapability } from './permissions.js';
import { createStorageTransport, UPLOAD_URL_TTL_SECONDS } from './storage-s3.js';

export const UPLOAD_PART_SIZE = 8 * 1024 * 1024;
export const MAX_UPLOAD_PART_BATCH = 32;
const TABLE = 'workspace_upload_reservations';
const capability = {
  document: 'uploadDocuments',
  media: 'uploadMedia',
  receipt: 'manageAssets',
  packet: 'manageSales',
};
export class StorageUploadError extends Error {
  constructor(status, code, message, row) {
    super(message);
    this.status = status;
    this.code = code;
    this.row = row;
  }
}
const fail = (status, code, message, row) => {
  throw new StorageUploadError(status, code, message, row);
};
const pending = (row) =>
  fail(
    409,
    'upload_pending',
    'This upload needs reconciliation. Keep the original and retry its status; do not start another upload.',
    row,
  );
const integer = (value) => (typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : NaN);
// Mirrors the established client media path contract, pinned by behavioral parity tests.
export function mediaHorseSegment(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'record'
  );
}
export function publicUpload(row) {
  return {
    requestId: row.id,
    workspaceId: row.workspace_id,
    storagePath: row.object_path,
    bucket: row.bucket_id,
    sizeBytes: integer(row.expected_bytes),
    contentType: row.content_type,
    kind: row.upload_kind,
    status:
      row.state === 'stored'
        ? 'completed'
        : row.state === 'uploading' && !row.provider_upload_id
          ? 'pending'
          : row.state,
    partSizeBytes: UPLOAD_PART_SIZE,
    partCount: Math.ceil(integer(row.expected_bytes) / UPLOAD_PART_SIZE),
  };
}
export function uploadErrorResult(error, requestId) {
  return {
    ok: false,
    code: error instanceof StorageUploadError ? error.code : 'upload_unavailable',
    message:
      error instanceof StorageUploadError
        ? error.message
        : 'The upload could not be confirmed. Keep the original and check its status before retrying.',
    needsRecovery: Boolean(error.row) || !(error instanceof StorageUploadError) || error.status >= 500,
    requestId,
    ...(error.row ? { upload: publicUpload(error.row), storagePath: error.row.object_path } : {}),
  };
}
function authorize(access, kind) {
  const denied = requireRoleCapability(access.role, capability[kind] || 'unknown');
  if (denied) fail(403, 'capability_required', denied);
}
function buckets() {
  return {
    media: process.env.SUPABASE_MEDIA_BUCKET || process.env.VITE_SUPABASE_MEDIA_BUCKET || 'horse-media',
    document: process.env.SUPABASE_DOCUMENT_BUCKET || process.env.VITE_SUPABASE_DOCUMENT_BUCKET || 'horse-documents',
    packet: process.env.SUPABASE_SALE_PACKET_BUCKET || 'sale-packets',
  };
}
function validRow(row, workspaceId, userId, id) {
  return (
    row &&
    row.id === id &&
    row.workspace_id === workspaceId &&
    row.actor_user_id === userId &&
    isWorkspaceObjectPath({ path: row.object_path, workspaceId }) &&
    Number.isSafeInteger(integer(row.expected_bytes)) &&
    integer(row.expected_bytes) > 0 &&
    integer(row.part_size_bytes) === UPLOAD_PART_SIZE &&
    capability[row.upload_kind]
  );
}

export function createUploadService(access, transport = null) {
  const { supabase, workspaceId, user } = access;
  // Lazy so status/list still work during a credential outage.
  const s3 = () => (transport ||= createStorageTransport());
  async function read(id) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .eq('actor_user_id', user.id)
      .maybeSingle();
    if (error) fail(503, 'upload_unavailable', 'Upload state could not be read. Keep the original.');
    if (!data) return null;
    if (!validRow(data, workspaceId, user.id, id))
      fail(503, 'upload_unavailable', 'Upload state could not be verified.');
    authorize(access, data.upload_kind);
    return data;
  }
  async function rpc(name, row, args = {}) {
    let response;
    try {
      response = await supabase.rpc(name, { p_reservation_id: row.id, ...args });
    } catch {
      pending(row);
    }
    if (response?.error) {
      if (response.error.code === '55000')
        fail(409, 'upload_state_conflict', 'The upload state changed. Check its status before retrying.', row);
      if (/storage limit/i.test(response.error.message || ''))
        fail(403, 'storage_limit_reached', 'The workspace storage limit would be exceeded.', row);
      fail(503, 'upload_unavailable', 'Upload state could not be saved. Keep the original and check its status.', row);
    }
    const data = response?.data;
    if (!validRow(data, workspaceId, user.id, row.id)) pending(row);
    return data;
  }
  async function reconcile(row, reason) {
    // A lost reconciliation write never releases capacity or hides the original ID.
    try {
      return await rpc('xbar_mark_upload_reconcile', row, { p_claim_token: row.claim_token, p_reason: reason });
    } catch {
      return row;
    }
  }
  function checkCreate(body) {
    const { requestId, kind, sizeBytes, contentType, fileName } = body;
    if (
      !isWorkspaceId(requestId) ||
      !capability[kind] ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes < 1 ||
      sizeBytes > UPLOAD_PART_SIZE * 10000 ||
      typeof fileName !== 'string' ||
      !fileName ||
      fileName.length > 255 ||
      typeof contentType !== 'string' ||
      contentType.length > 127 ||
      !/^[\w.+-]+\/[\w.+-]+$/.test(contentType)
    )
      fail(
        400,
        'invalid_upload',
        'A valid request ID, file name, content type, kind and exact positive byte size are required.',
      );
    authorize(access, kind);
    const bucket = buckets()[kind === 'receipt' ? 'document' : kind];
    if (body.bucket !== bucket) fail(400, 'invalid_bucket', 'The requested storage bucket is not supported.');
    if (kind === 'media' && (typeof body.horseId !== 'string' || !body.horseId || body.horseId.length > 160))
      fail(400, 'invalid_upload', 'A horse ID is required for media.');
  }
  async function create(body, internalPath) {
    checkCreate(body);
    let row = await read(body.requestId);
    if (row) {
      if (
        row.bucket_id !== body.bucket ||
        integer(row.expected_bytes) !== body.sizeBytes ||
        row.content_type !== body.contentType ||
        row.upload_kind !== body.kind ||
        (internalPath && row.object_path !== internalPath) ||
        (body.kind === 'media' && row.object_path.split('/')[2] !== mediaHorseSegment(body.horseId))
      )
        fail(409, 'upload_request_conflict', 'This request ID belongs to a different upload.', row);
      return row.state === 'reserved' ? begin(row) : row;
    }
    // Validate credentials before reserving; configuration failures must not consume capacity.
    s3();
    const name = safeDocumentSegment(body.fileName, 'upload.bin');
    const extension = name.includes('.') ? name.split('.').pop() : 'bin';
    const path =
      internalPath ||
      (body.kind === 'media'
        ? `${workspaceId}/horses/${mediaHorseSegment(body.horseId)}/media-${body.requestId}-${randomUUID()}.${extension}`
        : `${workspaceId}/documents/${body.requestId}/${randomUUID()}-${name}`);
    if (!isWorkspaceObjectPath({ path, workspaceId }) || !path.includes(body.requestId))
      fail(400, 'invalid_upload', 'Invalid generated storage path.');
    row = { id: body.requestId };
    row = await rpc('xbar_reserve_upload', row, {
      p_workspace_id: workspaceId,
      p_actor_user_id: user.id,
      p_bucket_id: body.bucket,
      p_object_path: path,
      p_expected_bytes: body.sizeBytes,
      p_content_type: body.contentType,
      p_upload_kind: body.kind,
    });
    return begin(row);
  }
  async function begin(row) {
    const token = randomUUID();
    row = await rpc('xbar_begin_upload', row, { p_claim_token: token });
    try {
      const providerId = await s3().create(row);
      row = await rpc('xbar_bind_upload', row, { p_claim_token: token, p_provider_upload_id: providerId });
      if (row.state !== 'uploading' || row.provider_upload_id !== providerId || row.claim_token) pending(row);
      return row;
    } catch {
      row = await reconcile(row, 'create_unconfirmed');
      pending(row);
    }
  }
  async function parts(row, numbers) {
    if (row.state !== 'uploading' || !row.provider_upload_id || row.claim_token) pending(row);
    const count = Math.ceil(integer(row.expected_bytes) / UPLOAD_PART_SIZE);
    if (
      !Array.isArray(numbers) ||
      !numbers.length ||
      numbers.length > MAX_UPLOAD_PART_BATCH ||
      new Set(numbers).size !== numbers.length ||
      numbers.some((n) => !Number.isSafeInteger(n) || n < 1 || n > count)
    )
      fail(400, 'invalid_parts', 'Request only the fixed part numbers for this upload.', row);
    return Promise.all(
      numbers.map(async (partNumber) => {
        const sizeBytes = Math.min(UPLOAD_PART_SIZE, integer(row.expected_bytes) - (partNumber - 1) * UPLOAD_PART_SIZE);
        return { partNumber, sizeBytes, url: await s3().signPart(row, partNumber, sizeBytes) };
      }),
    );
  }
  async function settleCompleted(row) {
    const object = await s3().head(row);
    if (!object || object.sizeBytes !== integer(row.expected_bytes)) pending(row);
    return rpc('xbar_settle_upload_stored', row, { p_claim_token: row.claim_token });
  }
  async function complete(row) {
    if (row.state === 'stored') return row;
    if (row.state !== 'uploading' || !row.provider_upload_id || row.claim_token) pending(row);
    row = await rpc('xbar_claim_upload_completion', row, { p_claim_token: randomUUID() });
    let inventory;
    try {
      inventory = await s3().listParts(row);
      const expected = Math.ceil(integer(row.expected_bytes) / UPLOAD_PART_SIZE);
      if (
        inventory.length !== expected ||
        inventory.some(
          (part, i) =>
            part.PartNumber !== i + 1 ||
            part.Size !== Math.min(UPLOAD_PART_SIZE, integer(row.expected_bytes) - i * UPLOAD_PART_SIZE) ||
            typeof part.ETag !== 'string' ||
            !part.ETag,
        )
      ) {
        row = await rpc('xbar_release_upload_completion', row, { p_claim_token: row.claim_token });
        fail(
          409,
          'upload_incomplete',
          'The uploaded parts do not match the reserved file. Resume the same upload or cancel it.',
          row,
        );
      }
    } catch (error) {
      if (error instanceof StorageUploadError) throw error;
      row = await reconcile(row, 'part_inventory_unconfirmed');
      pending(row);
    }
    // Fences concurrent abort and records the point after which completion may have happened.
    row = await rpc('xbar_start_upload_completion', row, { p_claim_token: row.claim_token });
    try {
      await s3().complete(row, inventory);
      return await settleCompleted(row);
    } catch {
      row = await reconcile(row, 'completion_unconfirmed');
      // A lost Complete response can still be proved successful by HEAD + the DB object inventory.
      try {
        return await settleCompleted(row);
      } catch {
        pending(row);
      }
    }
  }
  async function abort(row) {
    if (row.state === 'aborted') return row;
    if (row.completion_started_at || row.claim_action === 'complete' || row.state === 'stored')
      fail(
        409,
        'upload_not_abortable',
        'A completed or possibly completed file cannot be cancelled. The original is retained.',
        row,
      );
    if (!(row.claim_action === 'abort' && ['aborting', 'reconcile'].includes(row.state)))
      row = await rpc('xbar_claim_upload_abort', row, { p_claim_token: randomUUID() });
    try {
      if (await s3().head(row)) pending(row);
      if (row.provider_upload_id && !(await s3().abort(row))) pending(row);
      if (await s3().head(row)) pending(row);
      return await rpc('xbar_settle_upload_aborted', row, {
        p_claim_token: row.claim_token,
        p_provider_confirmed: true,
      });
    } catch {
      row = await reconcile(row, 'abort_unconfirmed');
      pending(row);
    }
  }
  async function status(row) {
    if (row.claim_action === 'complete' && ['completing', 'reconcile'].includes(row.state)) {
      try {
        return await settleCompleted(row);
      } catch {
        return row;
      }
    }
    if (row.claim_action === 'verify' && ['completing', 'reconcile'].includes(row.state)) {
      // Revoking the verification claim fences a worker before it can start Complete.
      return rpc('xbar_release_upload_completion', row, { p_claim_token: row.claim_token });
    }
    if (row.claim_action === 'create' && ['uploading', 'reconcile'].includes(row.state) && !row.provider_upload_id) {
      try {
        const id = await s3().findCreated(row);
        if (id) return await rpc('xbar_bind_upload', row, { p_claim_token: row.claim_token, p_provider_upload_id: id });
      } catch {
        return row;
      }
    }
    if (row.claim_action === 'abort' && ['aborting', 'reconcile'].includes(row.state)) {
      try {
        return await abort(row);
      } catch {
        return row;
      }
    }
    return row;
  }
  async function list() {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('actor_user_id', user.id)
      .neq('state', 'aborted')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error || !Array.isArray(data)) fail(503, 'upload_unavailable', 'Upload recovery records could not be read.');
    return data
      .filter(
        (row) =>
          validRow(row, workspaceId, user.id, row.id) &&
          !requireRoleCapability(access.role, capability[row.upload_kind]),
      )
      .map(publicUpload);
  }
  return { create, read, parts, complete, abort, status, list, transport: s3 };
}

// All generated Buffer writers use exactly the same reserve/list/verify/complete path.
// Existing caller-generated random paths are retained, never overwritten or deleted.
export async function uploadReservedBuffer({
  access,
  requestId,
  bucket,
  storagePath,
  bytes,
  contentType,
  kind = 'document',
  transport,
}) {
  const service = createUploadService(access, transport);
  let row;
  try {
    row = await service.create(
      { requestId, bucket, kind, fileName: storagePath.split('/').pop(), sizeBytes: bytes.byteLength, contentType },
      storagePath,
    );
    if (row.state === 'stored') return { data: { path: row.object_path }, error: null };
    if (row.state !== 'uploading' || !row.provider_upload_id || row.claim_token) pending(row);
    for (let start = 0, number = 1; start < bytes.byteLength; start += UPLOAD_PART_SIZE, number++)
      await service.transport().putPart(row, number, bytes.subarray(start, start + UPLOAD_PART_SIZE));
    row = await service.complete(row);
    return { data: { path: row.object_path }, error: null };
  } catch (error) {
    return {
      data: null,
      error: {
        ...uploadErrorResult(error, requestId),
        message: error instanceof StorageUploadError ? error.message : 'Upload result could not be confirmed.',
      },
    };
  }
}
export { UPLOAD_URL_TTL_SECONDS };

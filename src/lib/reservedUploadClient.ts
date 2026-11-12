import { isWorkspaceStorageKey, sanitizeDocumentPathSegment } from './documentStoragePath.js';

/** The API signs exact sizes. No browser upload may bypass this reservation flow. */
export const UPLOAD_PART_BYTES = 8 * 1024 ** 2;
const MAX_PARTS = 10_000;
const PART_BATCH = 32;
const PART_URL_MAX_TTL_MS = 300_000;
const PART_URL_SAFETY_MARGIN_MS = 30_000;
export type UploadIdentity = { userId: string; workspaceId: string };
export type UploadKind = 'document' | 'receipt' | 'media';
export type UploadRecovery = {
  requestId: string;
  target: UploadIdentity;
  bucket: string;
  kind: UploadKind;
  horseId?: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storagePath?: string;
  state: 'prepared' | 'uploading' | 'completing' | 'completed' | 'aborted' | 'pending' | 'not_started';
  originalRetention: 'device' | 'reselect';
  completionStarted?: boolean;
  serverStatus?: string;
  requiresReview?: boolean;
  /** Optional in-memory or retained copy, never serialized into metadata. */
  original?: Blob;
  localFileKey?: string;
};
export type UploadJournal = {
  put(record: UploadRecovery): Promise<void>;
  get(requestId: string): Promise<UploadRecovery | null>;
  retainOriginal?(record: UploadRecovery, original: Blob): Promise<boolean>;
};
export type ReservedUploadDependencies = {
  projectUrl: string;
  apiUrl: string;
  identity(): Promise<(UploadIdentity & { accessToken: string }) | null>;
  journal: UploadJournal;
  fetch: typeof fetch;
  createRequestId(): string;
  /** Local elapsed time only, never compared with a server wall clock. */
  now?(): number;
};
type UploadInfo = {
  requestId: string;
  storagePath: string;
  bucket: string;
  sizeBytes: number;
  status: string;
  workspaceId?: string;
  kind?: UploadKind;
  contentType?: string;
  partSizeBytes: number;
  partCount: number;
};
type UploadPart = { partNumber: number; sizeBytes: number; url: string };
type ApiPayload = {
  ok?: boolean;
  upload?: UploadInfo;
  parts?: UploadPart[];
  code?: string;
  message?: string;
  expiresIn?: number;
  /** Assigned by request(), not trusted from server JSON or persisted. */
  receivedAtMs?: number;
  requestDurationMs?: number;
};
function elapsedNow(deps: ReservedUploadDependencies): number {
  const value = deps.now ? deps.now() : performance.now();
  if (!Number.isFinite(value)) throw Error('Upload URL age could not be verified.');
  return value;
}
function partDeadline(payload: ApiPayload): number {
  if (
    typeof payload.expiresIn !== 'number' ||
    !Number.isFinite(payload.expiresIn) ||
    payload.expiresIn <= 0 ||
    payload.receivedAtMs === undefined ||
    payload.requestDurationMs === undefined
  ) {
    throw Error('The signed upload part expiry could not be verified.');
  }
  const ttl = Math.min(payload.expiresIn * 1000, PART_URL_MAX_TTL_MS);
  // Conservatively subtract the whole control-request transit time: signing
  // happened after that request began, not necessarily when its response arrived.
  return payload.receivedAtMs + ttl - payload.requestDurationMs - Math.min(PART_URL_SAFETY_MARGIN_MS, ttl / 5);
}

export class ReservedUploadError extends Error {
  readonly recovery: UploadRecovery;
  readonly code?: string;
  constructor(message: string, recovery: UploadRecovery, code?: string) {
    super(
      `${message} Recovery ID: ${recovery.requestId}.${recovery.storagePath ? ` Storage path: ${recovery.storagePath}.` : ''} ${recovery.originalRetention === 'device' ? 'The original is retained on this device.' : 'Keep the original file; recovery after a reload may require selecting it again.'} Open Settings, Unfinished uploads to check status.`,
    );
    this.name = 'ReservedUploadError';
    const { original: _original, ...metadata } = recovery;
    this.recovery = metadata;
    this.code = code;
  }
}

function sameIdentity(left: UploadIdentity, right: UploadIdentity | null) {
  return right?.userId === left.userId && right.workspaceId === left.workspaceId;
}
async function assertIdentity(record: UploadRecovery, deps: ReservedUploadDependencies) {
  const identity = await deps.identity();
  if (!sameIdentity(record.target, identity) || !identity?.accessToken) {
    throw new ReservedUploadError(
      'The account, workspace, or upload access changed. No upload result was attached.',
      record,
    );
  }
  return identity;
}
function safePath(path: unknown, record: UploadRecovery): path is string {
  if (typeof path !== 'string' || !/^[a-zA-Z0-9._/-]+$/.test(path)) return false;
  if (path.split('/').length !== 4 || path.split('/').some((segment) => !segment || segment.startsWith('.')))
    return false;
  const prefix =
    record.kind === 'media'
      ? `${record.target.workspaceId.toLowerCase()}/horses/${sanitizeDocumentPathSegment(record.horseId ?? '', 'record')}/media-`
      : `${record.target.workspaceId.toLowerCase()}/documents/`;
  return path.startsWith(prefix) && (!record.storagePath || path === record.storagePath);
}
function validatedInfo(payload: ApiPayload, record: UploadRecovery): UploadInfo {
  const info = payload.upload;
  if (
    !info ||
    info.requestId !== record.requestId ||
    info.bucket !== record.bucket ||
    info.sizeBytes !== record.sizeBytes ||
    (info.workspaceId !== undefined && info.workspaceId !== record.target.workspaceId) ||
    (info.kind !== undefined && info.kind !== record.kind) ||
    (info.contentType !== undefined && info.contentType !== record.contentType) ||
    !safePath(info.storagePath, record) ||
    info.partSizeBytes !== UPLOAD_PART_BYTES ||
    info.partCount !== Math.ceil(record.sizeBytes / UPLOAD_PART_BYTES)
  ) {
    throw new ReservedUploadError('The upload service returned a mismatched destination or size.', record);
  }
  return info;
}

/** Only the original project's hosted S3 origins, or its configured custom origin. */
function storageOrigins(projectUrl: string): string[] {
  const project = new URL(projectUrl);
  if (
    project.protocol !== 'https:' ||
    project.username ||
    project.password ||
    project.port ||
    project.search ||
    project.hash ||
    project.pathname !== '/'
  )
    throw Error('The Storage project destination is invalid.');
  const origins = [project.origin];
  if (/^[a-z0-9-]+\.supabase\.co$/.test(project.hostname)) {
    origins.push(`https://${project.hostname.replace('.supabase.co', '.storage.supabase.co')}`);
  }
  return origins;
}

/** Check the entire destination before sending any user bytes, not just a hostname suffix. */
export function validateUploadPart(part: UploadPart, info: UploadInfo, projectUrl: string): UploadPart {
  if (
    !Number.isSafeInteger(part?.partNumber) ||
    part.partNumber < 1 ||
    part.partNumber > info.partCount ||
    part.sizeBytes !== Math.min(UPLOAD_PART_BYTES, info.sizeBytes - (part.partNumber - 1) * UPLOAD_PART_BYTES)
  ) {
    throw Error('The signed upload part has an invalid number or size.');
  }
  const url = new URL(part.url);
  const one = (key: string) => (url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : null);
  const signedHeaders = one('X-Amz-SignedHeaders')?.split(';');
  const expectedPath = `/storage/v1/s3/${encodeURIComponent(info.bucket)}/${info.storagePath.split('/').map(encodeURIComponent).join('/')}`;
  if (
    !storageOrigins(projectUrl).includes(url.origin) ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== expectedPath ||
    one('partNumber') !== String(part.partNumber) ||
    !one('uploadId') ||
    one('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256' ||
    !one('X-Amz-Signature') ||
    !signedHeaders?.includes('content-length') ||
    !signedHeaders.includes('host')
  ) {
    throw Error('The signed upload part destination could not be verified.');
  }
  return part;
}

async function request(
  record: UploadRecovery,
  deps: ReservedUploadDependencies,
  action: string,
  extra = {},
): Promise<ApiPayload> {
  const identity = await assertIdentity(record, deps);
  const requestedAtMs = elapsedNow(deps);
  const response = await deps.fetch(deps.apiUrl, {
    method: 'POST',
    redirect: 'error',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.accessToken}` },
    body: JSON.stringify({ action, workspaceId: record.target.workspaceId, requestId: record.requestId, ...extra }),
  });
  const payload = (await response.json()) as ApiPayload;
  const receivedAtMs = elapsedNow(deps);
  const requestDurationMs = receivedAtMs >= requestedAtMs ? receivedAtMs - requestedAtMs : PART_URL_MAX_TTL_MS;
  await assertIdentity(record, deps);
  if (!response.ok || payload.ok !== true) {
    throw new ReservedUploadError(
      payload.message || `The upload service returned ${response.status}.`,
      record,
      payload.code,
    );
  }
  return { ...payload, receivedAtMs, requestDurationMs };
}
async function remember(record: UploadRecovery, deps: ReservedUploadDependencies, info: UploadInfo) {
  record.storagePath = info.storagePath;
  record.serverStatus = info.status;
  await deps.journal.put(record);
}
async function confirmed(record: UploadRecovery, deps: ReservedUploadDependencies, info: UploadInfo) {
  if (info.status !== 'completed')
    throw new ReservedUploadError('The upload is pending server recovery. Its storage remains reserved.', record);
  record.state = 'completed';
  await remember(record, deps, info);
  await assertIdentity(record, deps);
  return { storagePath: info.storagePath };
}
async function transfer(record: UploadRecovery, original: Blob, deps: ReservedUploadDependencies, payload: ApiPayload) {
  let info = validatedInfo(payload, record);
  await remember(record, deps, info);
  if (info.status === 'completed') return confirmed(record, deps, info);
  if (info.status !== 'uploading')
    throw new ReservedUploadError('The upload is pending server recovery. Its storage remains reserved.', record);
  record.state = 'uploading';
  await deps.journal.put(record);
  let supplied = payload.parts;
  let multipartId: string | undefined;
  for (let first = 1; first <= info.partCount; first += PART_BATCH) {
    const numbers = Array.from({ length: Math.min(PART_BATCH, info.partCount - first + 1) }, (_, i) => first + i);
    if (!supplied) {
      payload = await request(record, deps, 'parts', { partNumbers: numbers });
      info = validatedInfo(payload, record);
      if (info.status !== 'uploading') throw new ReservedUploadError('The upload is pending server recovery.', record);
      supplied = payload.parts;
    }
    if (
      !Array.isArray(supplied) ||
      supplied.length !== numbers.length ||
      supplied.some((part, i) => part.partNumber !== numbers[i])
    )
      throw Error('The upload service returned an incomplete part batch.');
    // Validate the whole batch before disclosing any file bytes. Each part
    // keeps this batch's original age even when a sibling URL is refreshed.
    const parts = supplied.map((part) => validateUploadPart(part, info, deps.projectUrl));
    const batchDeadline = partDeadline(payload);
    const checkMultipart = (part: UploadPart) => {
      const partUploadId = new URL(part.url).searchParams.get('uploadId')!;
      if (multipartId && multipartId !== partUploadId)
        throw Error('The signed parts refer to different multipart uploads.');
      multipartId = partUploadId;
    };
    const refreshPart = async (partNumber: number) => {
      // The server rechecks membership and upload state; it cannot mint a URL
      // for a completed/aborting upload or create a replacement reservation.
      const refreshed = await request(record, deps, 'parts', { partNumbers: [partNumber] });
      const refreshedInfo = validatedInfo(refreshed, record);
      if (refreshedInfo.status !== 'uploading')
        throw new ReservedUploadError('The upload is pending server recovery.', record);
      if (refreshed.parts?.length !== 1 || refreshed.parts[0].partNumber !== partNumber)
        throw Error('The upload service returned an unexpected refreshed part.');
      const part = validateUploadPart(refreshed.parts[0], refreshedInfo, deps.projectUrl);
      checkMultipart(part);
      return { part, deadline: partDeadline(refreshed) };
    };
    for (const initialPart of parts) {
      let part = initialPart;
      let deadline = batchDeadline;
      checkMultipart(part);
      const start = (part.partNumber - 1) * UPLOAD_PART_BYTES;
      const body = original.slice(start, start + part.sizeBytes);
      if (body.size !== part.sizeBytes) throw Error('The original file no longer has the expected size.');
      await assertIdentity(record, deps);
      if (elapsedNow(deps) >= deadline) {
        ({ part, deadline } = await refreshPart(part.partNumber));
        await assertIdentity(record, deps);
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (elapsedNow(deps) >= deadline)
          throw Error(
            'A fresh upload URL did not arrive in time. Keep the original and retry recovery when connected.',
          );
        const response = await deps.fetch(part.url, {
          method: 'PUT',
          body,
          mode: 'cors',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          // Content-Length is forbidden in browser JS. Fetch supplies the exact
          // Blob length itself; never substitute a stream, string or FormData.
        });
        await assertIdentity(record, deps);
        if (response.ok) break;
        // An unexpected expiry (for example, suspended mobile timers) gets one
        // reauthorized same-part retry with the SAME Blob. Never retry a whole
        // upload, an uncertain completion, or a persistent provider refusal.
        if (response.status !== 403 || attempt !== 0)
          throw Error(`Storage refused upload part ${part.partNumber} (${response.status}).`);
        ({ part, deadline } = await refreshPart(part.partNumber));
        await assertIdentity(record, deps);
      }
    }
    supplied = undefined;
  }
  record.state = 'completing';
  record.completionStarted = true;
  await deps.journal.put(record);
  payload = await request(record, deps, 'complete');
  return confirmed(record, deps, validatedInfo(payload, record));
}
async function recoverable<T>(
  record: UploadRecovery,
  deps: ReservedUploadDependencies,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (record.state !== 'completed' && record.state !== 'aborted' && record.state !== 'not_started')
      record.state = 'pending';
    // The initial durable ID is never erased, even if a later journal update
    // fails. Status can recover the server-owned path from that ID.
    try {
      await deps.journal.put(record);
    } catch {
      /* Surface the original failure, retaining the initial journal. */
    }
    if (error instanceof ReservedUploadError) throw error;
    throw new ReservedUploadError(
      error instanceof Error ? error.message : 'The upload outcome could not be confirmed.',
      record,
    );
  }
}

export async function startReservedUpload(
  input: {
    file: File;
    target: UploadIdentity;
    bucket: string;
    kind: UploadKind;
    horseId?: string;
    localFileKey?: string;
  },
  deps: ReservedUploadDependencies,
): Promise<{ storagePath: string }> {
  if (
    !(input.file instanceof Blob) ||
    !Number.isSafeInteger(input.file.size) ||
    input.file.size <= 0 ||
    input.file.size > UPLOAD_PART_BYTES * MAX_PARTS ||
    !isWorkspaceStorageKey(input.target.workspaceId) ||
    !input.target.userId ||
    !/^[a-z0-9-]+$/.test(input.bucket)
  )
    throw Error('The upload identity, bucket or original file size is invalid.');
  storageOrigins(deps.projectUrl);
  const record: UploadRecovery = {
    requestId: deps.createRequestId(),
    target: { ...input.target },
    bucket: input.bucket,
    kind: input.kind,
    horseId: input.horseId,
    fileName: input.file.name,
    contentType: input.file.type || 'application/octet-stream',
    sizeBytes: input.file.size,
    state: 'prepared',
    originalRetention: 'reselect',
    original: input.file,
    localFileKey: input.localFileKey,
  };
  if (!isWorkspaceStorageKey(record.requestId)) throw Error('A secure upload recovery ID could not be created.');
  await assertIdentity(record, deps);
  // Do not create a reservation whose identity cannot survive reload.
  try {
    await deps.journal.put(record);
  } catch {
    throw new ReservedUploadError('Device recovery metadata could not be saved. No cloud upload was started.', record);
  }
  return recoverable(record, deps, async () => {
    try {
      if (await deps.journal.retainOriginal?.(record, input.file)) record.originalRetention = 'device';
    } catch {
      /* A second full-byte copy is best effort, never a prerequisite for a large upload. */
    }
    await deps.journal.put(record);
    const payload = await request(record, deps, 'create', {
      bucket: record.bucket,
      kind: record.kind,
      horseId: record.horseId,
      fileName: record.fileName,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
    });
    return transfer(record, input.file, deps, payload);
  });
}

async function recoveryRecord(requestId: string, target: UploadIdentity, deps: ReservedUploadDependencies) {
  const record = await deps.journal.get(requestId);
  if (!record || !sameIdentity(target, record.target))
    throw Error('No upload recovery record belongs to this account and workspace.');
  await assertIdentity(record, deps);
  return record;
}

/** Explicit retry checks server status first. It never blindly replays completion. */
export async function resumeReservedUpload(
  requestId: string,
  target: UploadIdentity,
  deps: ReservedUploadDependencies,
) {
  const record = await recoveryRecord(requestId, target, deps);
  return recoverable(record, deps, async () => {
    const payload = await request(record, deps, 'status');
    const info = validatedInfo(payload, record);
    await remember(record, deps, info);
    if (info.status === 'completed') return confirmed(record, deps, info);
    if (!record.original || record.original.size !== record.sizeBytes) {
      throw new ReservedUploadError(
        'The original is not retained here. Check status and confirm cancellation before starting a new upload with the reselected file.',
        record,
      );
    }
    return transfer(record, record.original, deps, payload);
  });
}

/** Abort only through the server, which owns the completion/abort race. Never delete an object. */
export async function cancelReservedUpload(
  requestId: string,
  target: UploadIdentity,
  deps: ReservedUploadDependencies,
) {
  const record = await recoveryRecord(requestId, target, deps);
  return recoverable(record, deps, async () => {
    if (record.completionStarted)
      throw new ReservedUploadError(
        'Completion has started. Check status; uncertain completion needs support, not cancellation.',
        record,
      );
    const status = validatedInfo(await request(record, deps, 'status'), record);
    await remember(record, deps, status);
    if (status.status !== 'uploading' && status.status !== 'reserved')
      throw new ReservedUploadError('This upload cannot be cancelled safely. Check status or contact support.', record);
    const payload = await request(record, deps, 'abort');
    const info = validatedInfo(payload, record);
    if (info.status !== 'aborted')
      throw new ReservedUploadError('Cancellation is not confirmed. The upload remains reserved for recovery.', record);
    record.state = 'aborted';
    await remember(record, deps, info);
    await assertIdentity(record, deps);
  });
}

/** Read/reconcile an existing reservation, without uploading, completing or linking any record. */
export async function checkReservedUpload(requestId: string, target: UploadIdentity, deps: ReservedUploadDependencies) {
  const record = await recoveryRecord(requestId, target, deps);
  return recoverable(record, deps, async () => {
    let payload: ApiPayload;
    try {
      payload = await request(record, deps, 'status');
    } catch (error) {
      if (error instanceof ReservedUploadError && error.code === 'upload_not_found' && !record.storagePath) {
        record.state = 'not_started';
        record.serverStatus = 'not_found';
        await deps.journal.put(record);
        await assertIdentity(record, deps);
        const { original: _original, ...metadata } = record;
        return metadata;
      }
      throw error;
    }
    const info = validatedInfo(payload, record);
    if (info.status === 'completed' && record.state !== 'completed') record.requiresReview = true;
    record.state =
      info.status === 'completed' || info.status === 'aborted' || info.status === 'uploading'
        ? info.status
        : info.status === 'reserved'
          ? 'prepared'
          : 'pending';
    await remember(record, deps, info);
    await assertIdentity(record, deps);
    const { original: _original, ...metadata } = record;
    return metadata;
  });
}

export function recoveryCanCancel(record: UploadRecovery): boolean {
  return (
    !record.completionStarted &&
    ((record.state === 'uploading' && record.serverStatus === 'uploading') ||
      (record.state === 'prepared' && record.serverStatus === 'reserved'))
  );
}

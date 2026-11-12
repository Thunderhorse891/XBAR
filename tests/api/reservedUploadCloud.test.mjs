import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    if (/\/(supabaseClient|platformConfig)(?:\.ts|\.js)?$/.test(specifier)) {
      const original = next(specifier, context).url;
      const overrides = specifier.includes('supabaseClient')
        ? 'export const getSupabaseClient = () => globalThis.__uploadClient;'
        : `export const supabaseConfig = {url:'https://original.supabase.co',mediaBucket:'horse-media',documentBucket:'horse-documents'};
           export const isRelationalCloudEnabled = () => true;`;
      return {
        url: `data:text/javascript;base64,${Buffer.from(`export * from ${JSON.stringify(`${original}?upload-original`)}; ${overrides}`).toString('base64')}`,
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});
const { uploadMediaAssetToCloud, uploadDocumentAssetToCloud } = await import('../../src/lib/cloudWorkspace.ts');
const { useCloudStore } = await import('../../src/store/useCloudStore.ts');
const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const target = { userId, workspaceId };
let requests;
let oldFetch;
let oldWindow;
let beforeResponse;
let failApi;
beforeEach(() => {
  oldFetch = globalThis.fetch;
  oldWindow = globalThis.window;
  requests = [];
  failApi = false;
  beforeResponse = () => {};
  const saved = new Map();
  globalThis.window = {
    location: { origin: 'https://app.example' },
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
  };
  const session = { access_token: 'bearer', user: { id: userId } };
  useCloudStore.setState({ session, workspaceId, workspaceRole: 'Admin' });
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    async maybeSingle() {
      return { data: { id: workspaceId }, error: null };
    },
  };
  globalThis.__uploadClient = {
    auth: {
      async getSession() {
        return { data: { session }, error: null };
      },
    },
    from() {
      return query;
    },
    storage: {
      from() {
        assert.fail('ordinary Storage client must never be used to upload');
      },
    },
  };
  let upload;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'PUT') {
      beforeResponse('part');
      return new Response('');
    }
    const body = JSON.parse(options.body);
    if (failApi) return Response.json({ ok: false, message: 'Storage is not configured.' }, { status: 503 });
    if (body.action === 'create')
      upload = {
        requestId: body.requestId,
        storagePath:
          body.kind === 'media'
            ? `${workspaceId}/horses/horse-a/media-${body.requestId}.txt`
            : `${workspaceId}/documents/${body.requestId}/original.txt`,
        bucket: body.bucket,
        sizeBytes: body.sizeBytes,
        status: 'uploading',
        partSizeBytes: 8388608,
        partCount: 1,
      };
    if (body.action === 'complete') upload.status = 'completed';
    const urlPart = new URL(
      `https://original.storage.supabase.co/storage/v1/s3/${upload.bucket}/${upload.storagePath}`,
    );
    for (const [key, value] of Object.entries({
      uploadId: 'provider',
      partNumber: '1',
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Signature': 'signature',
      'X-Amz-SignedHeaders': 'content-length;host',
    }))
      urlPart.searchParams.set(key, value);
    beforeResponse(body.action);
    return Response.json({
      ok: true,
      expiresIn: 300,
      upload,
      ...(body.action === 'create'
        ? { parts: [{ partNumber: 1, sizeBytes: upload.sizeBytes, url: urlPart.href }] }
        : {}),
    });
  };
});
afterEach(() => {
  globalThis.fetch = oldFetch;
  globalThis.window = oldWindow;
});
const file = () => new File(['xx'], 'original.txt', { type: 'text/plain' });
for (const [kind, run] of [
  ['media', () => uploadMediaAssetToCloud({ file: file(), horseId: 'horse-a', target })],
  ['document', () => uploadDocumentAssetToCloud({ file: file(), expectedIdentity: target })],
  ['receipt', () => uploadDocumentAssetToCloud({ file: file(), expectedIdentity: target, kind: 'receipt' })],
]) {
  test(`${kind} uses reserved JSON and direct signed Blob parts, returning only confirmed storagePath`, async () => {
    const result = await run();
    assert.deepEqual(Object.keys(result), ['storagePath']);
    assert(result.storagePath.startsWith(`${workspaceId}/`));
    assert.equal(requests.length, 3);
    assert.equal(JSON.parse(requests[0].options.body).kind, kind);
    assert.equal(requests[1].options.body.size, 2);
    assert.equal(JSON.parse(requests[2].options.body).action, 'complete');
  });
  test(`${kind} API unavailability never bypasses quota through ordinary Storage`, async () => {
    failApi = true;
    await assert.rejects(run, /not configured/);
    assert.equal(requests.length, 1);
  });
}
test('workspace switch while create is in flight prevents first part transfer', async () => {
  beforeResponse = () => useCloudStore.setState({ workspaceId: 'other' });
  await assert.rejects(
    () => uploadMediaAssetToCloud({ file: file(), horseId: 'horse-a', target }),
    /account|workspace/,
  );
  assert.equal(requests.length, 1);
});
test('live role loss after part transfer prevents server completion', async () => {
  beforeResponse = (action) => {
    if (action === 'part') useCloudStore.setState({ workspaceRole: 'Medical Lead' });
  };
  await assert.rejects(
    () => uploadMediaAssetToCloud({ file: file(), horseId: 'horse-a', target }),
    /account|workspace/,
  );
  assert.equal(requests.length, 2);
});
test('receipt uses manageAssets rather than document-only Medical Lead permission', async () => {
  useCloudStore.setState({ workspaceRole: 'Medical Lead' });
  await assert.rejects(() => uploadDocumentAssetToCloud({ file: file(), expectedIdentity: target, kind: 'receipt' }));
  assert.equal(requests.length, 0);
});

test('the real server S3 signer produces URLs accepted by the client without any provider request', async () => {
  const { S3Client } = await import('@aws-sdk/client-s3');
  const { storageTransportForClient } = await import('../../api/_lib/storage-s3.js');
  const { validateUploadPart } = await import('../../src/lib/reservedUploadClient.ts');
  const client = new S3Client({
    region: 'synthetic',
    endpoint: 'https://original.storage.supabase.co/storage/v1/s3',
    forcePathStyle: true,
    credentials: { accessKeyId: 'synthetic-key', secretAccessKey: 'synthetic-secret' },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    maxAttempts: 1,
    requestHandler: {
      handle() {
        assert.fail('URL signing must not send any real provider request');
      },
    },
  });
  const row = {
    bucket_id: 'horse-documents',
    object_path: `${workspaceId}/documents/reservation/file.txt`,
    provider_upload_id: 'provider-upload',
  };
  const url = await storageTransportForClient(client).signPart(row, 1, 2);
  const part = { partNumber: 1, sizeBytes: 2, url };
  assert.deepEqual(
    validateUploadPart(
      part,
      {
        requestId: 'test',
        storagePath: row.object_path,
        bucket: row.bucket_id,
        sizeBytes: 2,
        status: 'uploading',
        partSizeBytes: 8388608,
        partCount: 1,
      },
      'https://original.supabase.co',
    ),
    part,
  );
  client.destroy();
});

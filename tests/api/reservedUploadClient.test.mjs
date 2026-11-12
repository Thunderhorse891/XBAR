import assert from 'node:assert/strict';
import test from 'node:test';
import {
  startReservedUpload,
  resumeReservedUpload,
  cancelReservedUpload,
  ReservedUploadError,
  validateUploadPart,
} from '../../src/lib/reservedUploadClient.ts';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const target = { userId, workspaceId };
const partSizeBytes = 8 * 1024 ** 2;
const storagePath = `${workspaceId}/documents/unassigned/document-${requestId}.txt`;
const projectUrl = 'https://original.supabase.co';
function partUrl(partNumber, overrides = {}) {
  const url = new URL(`https://original.storage.supabase.co/storage/v1/s3/horse-documents/${storagePath}`);
  for (const [key, value] of Object.entries({
    uploadId: 'provider-upload',
    partNumber,
    'X-Amz-SignedHeaders': 'content-length;host',
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Signature': 'synthetic-signature',
    ...overrides,
  }))
    url.searchParams.set(key, String(value));
  return url.toString();
}
function fixture(sizeBytes = 2) {
  const calls = [];
  const saved = new Map();
  const file = new File([new Uint8Array(sizeBytes)], 'original.txt', { type: 'text/plain' });
  let status = 'uploading';
  let identity = target;
  const upload = () => ({
    requestId,
    storagePath,
    bucket: 'horse-documents',
    sizeBytes,
    status,
    partSizeBytes,
    partCount: Math.ceil(sizeBytes / partSizeBytes),
  });
  const parts = (numbers) =>
    numbers.map((partNumber) => ({
      partNumber,
      sizeBytes: Math.min(partSizeBytes, sizeBytes - (partNumber - 1) * partSizeBytes),
      url: partUrl(partNumber),
    }));
  const journal = {
    async put(record) {
      saved.set(record.requestId, { ...record });
    },
    async get(id) {
      return saved.get(id) ?? null;
    },
  };
  const deps = {
    projectUrl,
    apiUrl: 'https://app.example/api/storage/uploads',
    createRequestId: () => requestId,
    journal,
    async identity() {
      return { ...identity, accessToken: 'test-token' };
    },
    async fetch(url, options) {
      calls.push({ url, options });
      if (options.method === 'PUT') return new Response('', { status: 200 });
      const body = JSON.parse(options.body);
      assert.equal(body.workspaceId, workspaceId);
      assert.equal(body.requestId, requestId);
      if (body.action === 'complete') status = 'completed';
      if (body.action === 'abort') status = 'aborted';
      return Response.json({
        ok: true,
        expiresIn: 300,
        upload: upload(),
        ...(body.action === 'create'
          ? { parts: parts(Array.from({ length: Math.min(32, upload().partCount) }, (_, i) => i + 1)) }
          : {}),
        ...(body.action === 'parts' ? { parts: parts(body.partNumbers) } : {}),
      });
    },
  };
  const run = () => startReservedUpload({ file, target, kind: 'document', bucket: 'horse-documents' }, deps);
  return {
    file,
    deps,
    journal,
    saved,
    calls,
    run,
    upload,
    parts,
    changeIdentity: (value) => {
      identity = value;
    },
    setStatus: (value) => {
      status = value;
    },
  };
}
const actions = (f) => f.calls.filter((c) => c.options.method === 'POST').map((c) => JSON.parse(c.options.body).action);

test('the original and recovery ID are durable before any network operation', async () => {
  const g = fixture(2);
  const originalFetch = g.deps.fetch;
  g.deps.fetch = async (...args) => {
    assert.equal(g.saved.get(requestId).original, g.file);
    assert.equal(g.saved.get(requestId).requestId, requestId);
    return originalFetch(...args);
  };
  assert.deepEqual(await g.run(), { storagePath });
  assert.equal(g.saved.get(requestId).state, 'completed');
  assert.equal(g.file.size, 2);
});

test('uploads exact Blob slices, never Content-Length or auth to Storage, and completes only afterward', async () => {
  const f = fixture(partSizeBytes * 2 + 3);
  assert.deepEqual(await f.run(), { storagePath });
  assert.deepEqual(actions(f), ['create', 'complete']);
  const puts = f.calls.filter((c) => c.options.method === 'PUT');
  assert.deepEqual(
    puts.map((c) => c.options.body.size),
    [partSizeBytes, partSizeBytes, 3],
  );
  for (const { options } of puts) {
    assert(options.body instanceof Blob);
    assert.equal(options.headers, undefined);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
  }
  assert.equal(JSON.parse(f.calls[0].options.body).sizeBytes, f.file.size);
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer test-token');
});

test('a journal failure prevents reservation and all uploaded bytes', async () => {
  const f = fixture();
  f.journal.put = async () => {
    throw Error('device quota');
  };
  await assert.rejects(f.run, /device|recovery|original/i);
  assert.equal(f.calls.length, 0);
});

for (const at of ['create', 'part', 'complete'])
  test(`identity change during ${at} never installs a result or uploads the next part`, async () => {
    const f = fixture(partSizeBytes + 1);
    const fetch = f.deps.fetch;
    f.deps.fetch = async (url, options) => {
      const response = await fetch(url, options);
      const action = options.method === 'PUT' ? 'part' : JSON.parse(options.body).action;
      if (action === at) f.changeIdentity({ ...target, workspaceId: 'other-workspace' });
      return response;
    };
    await assert.rejects(f.run, /account|workspace/i);
    assert.equal(f.saved.get(requestId).original, f.file);
    if (at === 'create') assert.equal(f.calls.filter((c) => c.options.method === 'PUT').length, 0);
    if (at === 'part') assert.equal(f.calls.filter((c) => c.options.method === 'PUT').length, 1);
    assert(!actions(f).includes('abort'));
  });

for (const [label, mutate] of [
  [
    'foreign origin',
    (url) => {
      url.hostname = 'attacker.example';
    },
  ],
  [
    'other Supabase project',
    (url) => {
      url.hostname = 'other.storage.supabase.co';
    },
  ],
  [
    'credentials',
    (url) => {
      url.username = 'user';
    },
  ],
  [
    'unexpected port',
    (url) => {
      url.port = '444';
    },
  ],
  [
    'wrong bucket',
    (url) => {
      url.pathname = url.pathname.replace('horse-documents', 'sale-packets');
    },
  ],
  [
    'wrong object',
    (url) => {
      url.pathname += '-different';
    },
  ],
  [
    'wrong part',
    (url) => {
      url.searchParams.set('partNumber', '2');
    },
  ],
  [
    'duplicate part',
    (url) => {
      url.searchParams.append('partNumber', '1');
    },
  ],
  [
    'missing signed length',
    (url) => {
      url.searchParams.set('X-Amz-SignedHeaders', 'host');
    },
  ],
  [
    'unsigned upload',
    (url) => {
      url.searchParams.delete('X-Amz-Signature');
    },
  ],
  [
    'redirect fragment',
    (url) => {
      url.hash = 'fragment';
    },
  ],
])
  test(`rejects ${label} before sending any original bytes`, async () => {
    const f = fixture();
    const fetch = f.deps.fetch;
    f.deps.fetch = async (...args) => {
      const response = await fetch(...args);
      const payload = await response.json();
      const url = new URL(payload.parts[0].url);
      mutate(url);
      payload.parts[0].url = url.href;
      return Response.json(payload);
    };
    await assert.rejects(f.run, /destination|signed|part/i);
    assert.equal(f.calls.length, 1);
    assert.equal(f.saved.get(requestId).original, f.file);
  });

test('lost create response preserves the request ID and original for status-led retry', async () => {
  const f = fixture();
  const fetch = f.deps.fetch;
  f.deps.fetch = async (...args) => {
    await fetch(...args);
    throw Error('response lost');
  };
  await assert.rejects(
    f.run,
    (error) => error instanceof ReservedUploadError && error.recovery.requestId === requestId,
  );
  assert.equal(f.saved.get(requestId).state, 'pending');
  f.deps.fetch = fetch;
  assert.deepEqual(await resumeReservedUpload(requestId, target, f.deps), { storagePath });
  assert.deepEqual(actions(f), ['create', 'status', 'parts', 'complete']);
});

test('lost completion response is recovered with status without repeating complete or deleting bytes', async () => {
  const f = fixture();
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) => {
    const result = await fetch(url, options);
    if (options.method === 'POST' && JSON.parse(options.body).action === 'complete') throw Error('response lost');
    return result;
  };
  await assert.rejects(f.run, /recovery|confirm|response lost/i);
  f.deps.fetch = fetch;
  assert.deepEqual(await resumeReservedUpload(requestId, target, f.deps), { storagePath });
  assert.deepEqual(actions(f), ['create', 'complete', 'status']);
  assert.equal(f.saved.get(requestId).original, f.file);
});

test('uncertain provider state does not retry complete or create a second reservation', async () => {
  const f = fixture();
  await f.run();
  f.setStatus('reconcile');
  await assert.rejects(() => resumeReservedUpload(requestId, target, f.deps), /recovery|pending|confirm/i);
  assert.deepEqual(actions(f), ['create', 'complete', 'status']);
});

test('persistent part refusal allows one same-reservation refresh, no fallback or completion, and retains original', async () => {
  const f = fixture();
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) =>
    options.method === 'PUT' ? new Response('', { status: 403 }) : fetch(url, options);
  await assert.rejects(f.run, /403|part/i);
  assert.deepEqual(actions(f), ['create', 'parts']);
  assert.equal(f.saved.get(requestId).original, f.file);
});

test('cancellation uses only the server endpoint and keeps the original after confirmed abort', async () => {
  const f = fixture();
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) =>
    options.method === 'PUT' ? Promise.reject(Error('offline')) : fetch(url, options);
  await assert.rejects(f.run);
  f.deps.fetch = fetch;
  await cancelReservedUpload(requestId, target, f.deps);
  assert.deepEqual(actions(f), ['create', 'status', 'abort']);
  assert.equal(f.saved.get(requestId).state, 'aborted');
  assert.equal(f.saved.get(requestId).original, f.file);
});

test('cannot resume or cancel another account or workspace recovery entry', async () => {
  const f = fixture();
  await f.run();
  const other = { ...target, userId: 'other' };
  await assert.rejects(() => resumeReservedUpload(requestId, other, f.deps), /account|workspace/i);
  await assert.rejects(() => cancelReservedUpload(requestId, other, f.deps), /account|workspace/i);
  assert.deepEqual(actions(f), ['create', 'complete']);
});

test('validates exact expected part length rather than accepting a server supplied approximation', () => {
  const f = fixture(2);
  assert.throws(() => validateUploadPart({ ...f.parts([1])[0], sizeBytes: 3 }, f.upload(), projectUrl), /size|part/i);
});

test('more than 32 parts requests another bounded signed URL batch and never proxies file bodies', async () => {
  const f = fixture(partSizeBytes * 32 + 1);
  await f.run();
  assert.deepEqual(actions(f), ['create', 'parts', 'complete']);
  const more = f.calls.find((c) => c.options.method === 'POST' && JSON.parse(c.options.body).action === 'parts');
  assert.deepEqual(JSON.parse(more.options.body).partNumbers, [33]);
  assert(f.calls.filter((c) => c.options.method === 'POST').every((c) => c.options.body.length < 2048));
  assert.equal(f.calls.filter((c) => c.options.method === 'PUT').at(-1).options.body.size, 1);
});
test('optional original quota failure does not block a cloud upload with durable metadata', async () => {
  const f = fixture();
  f.journal.retainOriginal = async () => {
    throw Error('device full');
  };
  assert.deepEqual(await f.run(), { storagePath });
  assert.equal(f.saved.get(requestId).originalRetention, 'reselect');
});
test('after reload without original bytes, recovery only checks status and refuses same-size replacement guesses', async () => {
  const f = fixture();
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) =>
    options.method === 'PUT' ? Promise.reject(Error('offline')) : fetch(url, options);
  await assert.rejects(f.run);
  f.saved.get(requestId).original = undefined;
  f.deps.fetch = fetch;
  await assert.rejects(() => resumeReservedUpload(requestId, target, f.deps), /not retained|cancellation/);
  assert.deepEqual(actions(f), ['create', 'status']);
});
test('an uncertain completion cannot be cancelled, even if a stale state says uploading', async () => {
  const f = fixture();
  await f.run();
  f.saved.get(requestId).state = 'pending';
  f.setStatus('uploading');
  await assert.rejects(() => cancelReservedUpload(requestId, target, f.deps), /Completion has started/);
  assert.deepEqual(actions(f), ['create', 'complete']);
});
test('explicit cancellation safely handles a reserved upload whose provider session never started', async () => {
  const f = fixture();
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) =>
    options.method === 'PUT' ? Promise.reject(Error('offline')) : fetch(url, options);
  await assert.rejects(f.run);
  f.deps.fetch = fetch;
  f.setStatus('reserved');
  await cancelReservedUpload(requestId, target, f.deps);
  assert.equal(f.saved.get(requestId).state, 'aborted');
  assert.deepEqual(actions(f), ['create', 'status', 'abort']);
});

test('slow sequential upload refreshes only each needed stale part within the same reservation', async () => {
  const f = fixture(partSizeBytes * 2 + 1);
  let elapsed = 0;
  f.deps.now = () => elapsed;
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) => {
    const result = await fetch(url, options);
    if (options.method === 'PUT') elapsed += 301_000;
    return result;
  };
  assert.deepEqual(await f.run(), { storagePath });
  assert.deepEqual(actions(f), ['create', 'parts', 'parts', 'complete']);
  assert.deepEqual(
    f.calls
      .filter((c) => c.options.method === 'POST' && JSON.parse(c.options.body).action === 'parts')
      .map((c) => JSON.parse(c.options.body).partNumbers),
    [[2], [3]],
  );
  assert.deepEqual(
    f.calls.filter((c) => c.options.method === 'PUT').map((c) => new URL(c.url).searchParams.get('partNumber')),
    ['1', '2', '3'],
  );
  assert.equal(f.saved.size, 1);
});
test('an unexpectedly expired part gets one fresh signed URL and retries only the same Blob slice', async () => {
  const f = fixture();
  let attempts = 0;
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) => {
    const result = await fetch(url, options);
    if (options.method === 'PUT' && ++attempts === 1) return new Response('expired', { status: 403 });
    return result;
  };
  assert.deepEqual(await f.run(), { storagePath });
  assert.deepEqual(actions(f), ['create', 'parts', 'complete']);
  const puts = f.calls.filter((c) => c.options.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(puts[0].options.body, puts[1].options.body);
  assert.equal(f.saved.size, 1);
});
test('an account change during a stale-part refresh refuses further original bytes and completion', async () => {
  const f = fixture(partSizeBytes + 1);
  let elapsed = 0;
  f.deps.now = () => elapsed;
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) => {
    const result = await fetch(url, options);
    if (options.method === 'PUT') elapsed += 301_000;
    if (options.method === 'POST' && JSON.parse(options.body).action === 'parts')
      f.changeIdentity({ ...target, userId: 'other' });
    return result;
  };
  await assert.rejects(f.run, /account|workspace/);
  assert.deepEqual(actions(f), ['create', 'parts']);
  assert.equal(f.calls.filter((c) => c.options.method === 'PUT').length, 1);
});

test('local safety margin refreshes a nearly expired part before it is sent', async () => {
  const f = fixture(partSizeBytes + 1);
  let elapsed = 0;
  f.deps.now = () => elapsed;
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) => {
    const result = await fetch(url, options);
    if (options.method === 'PUT') elapsed += 275_000;
    return result;
  };
  await f.run();
  assert.deepEqual(actions(f), ['create', 'parts', 'complete']);
});
test('completion or reconciliation reported during refresh stops without retrying original bytes', async () => {
  for (const status of ['completing', 'completed', 'reconcile']) {
    const f = fixture(partSizeBytes + 1);
    let elapsed = 0;
    f.deps.now = () => elapsed;
    const fetch = f.deps.fetch;
    f.deps.fetch = async (url, options) => {
      if (options.method === 'POST' && JSON.parse(options.body).action === 'parts') f.setStatus(status);
      const result = await fetch(url, options);
      if (options.method === 'PUT') elapsed += 301_000;
      return result;
    };
    await assert.rejects(f.run, /pending server recovery/);
    assert.deepEqual(actions(f), ['create', 'parts']);
    assert.equal(f.calls.filter((c) => c.options.method === 'PUT').length, 1);
  }
});
test('a refreshed URL for a different multipart session is refused without replacing completed parts', async () => {
  const f = fixture(partSizeBytes + 1);
  let elapsed = 0;
  f.deps.now = () => elapsed;
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) => {
    const result = await fetch(url, options);
    if (options.method === 'PUT') elapsed += 301_000;
    if (options.method === 'POST' && JSON.parse(options.body).action === 'parts') {
      const payload = await result.json();
      payload.parts[0].url = partUrl(2, { uploadId: 'replacement-session' });
      return Response.json(payload);
    }
    return result;
  };
  await assert.rejects(f.run, /different multipart uploads/);
  assert.deepEqual(actions(f), ['create', 'parts']);
  assert.equal(f.calls.filter((c) => c.options.method === 'PUT').length, 1);
});
test('control responses consuming the entire TTL stop after one refresh instead of looping forever', async () => {
  const f = fixture();
  let elapsed = 0;
  f.deps.now = () => elapsed;
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) => {
    const result = await fetch(url, options);
    if (options.method === 'POST') elapsed += 301_000;
    return result;
  };
  await assert.rejects(f.run, /fresh upload URL did not arrive in time/);
  assert.deepEqual(actions(f), ['create', 'parts']);
  assert.equal(f.calls.filter((c) => c.options.method === 'PUT').length, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { includeCloudOriginals, BACKUP_CONTEXT_CHANGED } from '../../src/lib/portableCloudOriginals.ts';
import { importLocalFiles, listLocalFiles, readLocalFile } from '../../src/lib/localFileVault.ts';
import { installFakeIndexedDb } from '../helpers/fakeIndexedDb.ts';

const owner = '11111111-1111-4111-8111-111111111111';
const bytes = new Uint8Array([0, 128, 255, 8, 44]);
const digest = createHash('sha256').update(bytes).digest('hex');
const doc = (id = 'original', patch = {}) => ({
  id,
  title: 'Original',
  fileName: 'original.pdf',
  state: 'Needs Review',
  storagePath: `${owner}/documents/unassigned/${id}.pdf`,
  ...patch,
});
function fixture() {
  const f = { current: true, reads: [], now: 0, nextKey: 0 };
  f.context = { workspaceId: owner, isCurrent: () => f.current };
  f.deps = {
    now: () => f.now,
    newKey: () => `vault-copy-${++f.nextKey}`,
    readStoredFile: async (...args) => {
      f.reads.push(args);
      return { ok: true, name: 'original.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) };
    },
  };
  return f;
}

test('receipt originals and local packets retain the same archive contract', async () => {
  const f = fixture();
  const local = { key: 'packet-local', size: 5, data: Buffer.from(bytes).toString('base64') };
  const out = await includeCloudOriginals(
    {
      expenseReceipts: [doc()],
      salePacketBuilds: [
        { id: 'local-packet', localFileKey: local.key, downloadUrl: 'blob:expired' },
        { id: 'cloud-packet', downloadUrl: 'https://external.test/packet' },
      ],
    },
    [local],
    [],
    f.context,
    f.deps,
  );
  assert.equal(f.reads.length, 1);
  assert.equal(out.files.length, 2);
  assert.equal(out.workspace.salePacketBuilds[0].localFileKey, local.key);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].location, 'link');
});

test('cloud originals survive export, JSON and restore into an empty device byte-for-byte', async () => {
  const restore = installFakeIndexedDb();
  try {
    const f = fixture();
    const input = {
      documents: [doc('original', { contentSha256: digest }), doc('copy', { storagePath: doc().storagePath })],
      horses: [{ id: 'horse', history: ['original history'] }],
    };
    const before = structuredClone(input);
    const out = await includeCloudOriginals(input, [], [], f.context, f.deps);
    assert.deepEqual(input, before, 'export must not mutate live records or histories');
    assert.deepEqual(await listLocalFiles(), [], 'export must not write the vault');
    assert.equal(f.reads.length, 1, 'one cloud object is downloaded once');
    assert.equal(out.files.length, 1);
    assert.deepEqual(out.skipped, []);
    assert.equal(out.workspace.documents[0].localFileKey, out.files[0].key);
    assert.equal(out.workspace.documents[1].localFileKey, out.files[0].key);
    assert.equal(out.workspace.documents[0].state, 'Needs Review');
    const archive = JSON.parse(JSON.stringify(out));
    const result = await importLocalFiles(archive.files, { workspaceId: 'different-device-owner', freshKeys: true });
    assert.equal(result.restored, 1);
    assert.deepEqual(result.failed, []);
    const entry = await readLocalFile(result.remapped[archive.workspace.documents[0].localFileKey]);
    assert.equal(entry.workspaceId, 'different-device-owner');
    assert.deepEqual(new Uint8Array(await entry.blob.arrayBuffer()), bytes);
  } finally {
    restore();
  }
});

test('conflicting fingerprints never attach the plausible bytes to the wrong record', async () => {
  const f = fixture();
  const input = {
    documents: [
      doc('valid', { storagePath: doc().storagePath, contentSha256: digest }),
      doc('conflict', { storagePath: doc().storagePath, contentSha256: 'f'.repeat(64) }),
    ],
  };
  const out = await includeCloudOriginals(input, [], [], f.context, f.deps);
  assert.equal(out.files.length, 1);
  assert.equal(out.workspace.documents[1].localFileKey, undefined);
  assert.equal(out.skipped[0].location, 'cloud');
  assert.match(out.skipped[0].reason, /fingerprint/);
  assert.equal(f.reads.length, 1);
});

test('failed cloud reads remain explicit omissions without altering their references', async () => {
  const f = fixture();
  f.deps.readStoredFile = async () => ({ ok: false, message: 'Original unavailable' });
  const input = { documents: [doc()] };
  const out = await includeCloudOriginals(input, [], [], f.context, f.deps);
  assert.deepEqual(out.workspace, input);
  assert.deepEqual(out.files, []);
  assert.deepEqual(out.skipped, [
    { key: 'cloud:documents:original', name: 'original.pdf', reason: 'Original unavailable', location: 'cloud' },
  ]);
});

for (const path of [
  'other/documents/source.pdf',
  `${owner}/../other/source.pdf`,
  `${owner}/documents/%2fother.pdf`,
  `${owner}/documents/a?token=x`,
]) {
  test(`unverified storage namespace is refused before signing: ${path}`, async () => {
    const f = fixture();
    const out = await includeCloudOriginals(
      { documents: [doc('foreign', { storagePath: path })] },
      [],
      [],
      f.context,
      f.deps,
    );
    assert.equal(f.reads.length, 0);
    assert.equal(out.files.length, 0);
    assert.equal(out.skipped.length, 1);
  });
}

test('available local originals do not trigger cloud requests', async () => {
  const f = fixture();
  const local = { key: 'vault-local', size: 5, data: Buffer.from(bytes).toString('base64') };
  const out = await includeCloudOriginals(
    { documents: [doc('original', { localFileKey: local.key })] },
    [local],
    [],
    f.context,
    f.deps,
  );
  assert.equal(f.reads.length, 0);
  assert.deepEqual(out.files, [local]);
});

test('a missing local copy can be recovered from the same ranch cloud original', async () => {
  const f = fixture();
  const out = await includeCloudOriginals(
    { documents: [doc('original', { localFileKey: 'missing' })] },
    [],
    [{ key: 'missing', name: 'original.pdf', reason: 'not on this device' }],
    f.context,
    f.deps,
  );
  assert.equal(out.files.length, 1);
  assert.deepEqual(out.skipped, []);
  assert.equal(out.workspace.documents[0].localFileKey, out.files[0].key);
});

test('external links are named as omissions without contacting an arbitrary host', async () => {
  const f = fixture();
  const out = await includeCloudOriginals(
    { documents: [doc('linked', { fileUrl: 'https://external.test/private' })] },
    [],
    [],
    f.context,
    f.deps,
  );
  assert.equal(f.reads.length, 0);
  assert.equal(out.skipped[0].location, 'link');
  assert.equal(out.workspace.documents[0].fileUrl, 'https://external.test/private');
});

test('a context change while downloading prevents any archive from being returned', async () => {
  const f = fixture();
  const read = f.deps.readStoredFile;
  f.deps.readStoredFile = async (...args) => {
    const result = await read(...args);
    f.current = false;
    return result;
  };
  await assert.rejects(includeCloudOriginals({ documents: [doc()] }, [], [], f.context, f.deps), {
    message: BACKUP_CONTEXT_CHANGED,
  });
});

test('total byte limits include already exported local originals', async () => {
  const f = fixture();
  const out = await includeCloudOriginals({ documents: [doc()] }, [{ key: 'local', size: 5 }], [], f.context, f.deps, {
    maxBytes: 5,
    timeoutMs: 100,
    totalMs: 100,
  });
  assert.equal(f.reads.length, 0);
  assert.match(out.skipped[0].reason, /size limit/);
});

test('a batch time limit produces omissions instead of continuing unbounded requests', async () => {
  const f = fixture();
  const read = f.deps.readStoredFile;
  f.deps.readStoredFile = async (...args) => {
    const result = await read(...args);
    f.now = 101;
    return result;
  };
  const out = await includeCloudOriginals({ documents: [doc('one'), doc('two')] }, [], [], f.context, f.deps, {
    maxBytes: 100,
    timeoutMs: 50,
    totalMs: 100,
  });
  assert.equal(f.reads.length, 1);
  assert.equal(out.files.length, 1);
  assert.match(out.skipped[0].reason, /time or size limit/);
});

test('new archive keys cannot collide with a missing original reference', async () => {
  const f = fixture();
  f.deps.newKey = () => 'missing';
  await assert.rejects(
    includeCloudOriginals(
      { documents: [doc('one'), { id: 'two', localFileKey: 'missing' }] },
      [],
      [],
      f.context,
      f.deps,
    ),
    /duplicate backup file identity/,
  );
});

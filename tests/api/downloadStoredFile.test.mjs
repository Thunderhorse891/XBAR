import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadStoredFile } from '../../src/lib/downloadStoredFile.ts';
function fixture() {
  const f = { releases: 0, saves: [], fetches: [], current: true };
  f.deps = {
    getDocumentAccessUrl: async () => ({
      ok: true,
      url: 'https://example.test/original',
      fileName: 'original.pdf',
      release: () => f.releases++,
    }),
    fetch: async (url, options) => {
      f.fetches.push({ url, options });
      return new Response(new Uint8Array([0, 255, 1, 254]), { headers: { 'content-type': 'application/pdf' } });
    },
    saveBlobAsFile: async (name, blob) => {
      f.saves.push({ name, blob });
      return { ok: true, via: 'browser' };
    },
  };
  return f;
}
test('download saves the actual original binary bytes through the existing save helper', async () => {
  const f = fixture();
  assert.equal((await downloadStoredFile({ localFileKey: 'original' }, () => f.current, f.deps)).ok, true);
  assert.deepEqual([...new Uint8Array(await f.saves[0].blob.arrayBuffer())], [0, 255, 1, 254]);
  assert.equal(f.saves[0].name, 'original.pdf');
  assert.equal(f.fetches[0].options.credentials, 'omit');
  assert.equal(f.releases, 1);
});
for (const mode of ['resolve', 'fetch', 'empty', 'oversize', 'save'])
  test(`download ${mode} failure is truthful and releases temporary handles`, async () => {
    const f = fixture();
    if (mode === 'resolve') f.deps.getDocumentAccessUrl = async () => ({ ok: false, message: 'Original missing' });
    if (mode === 'fetch') f.deps.fetch = async () => new Response('blocked', { status: 403 });
    if (mode === 'empty') f.deps.fetch = async () => new Response('');
    if (mode === 'oversize')
      f.deps.fetch = async () => new Response('x', { headers: { 'content-length': String(65 * 1024 * 1024) } });
    if (mode === 'save') f.deps.saveBlobAsFile = async () => ({ ok: false, reason: 'Share cancelled' });
    const r = await downloadStoredFile({}, () => f.current, f.deps);
    assert.equal(r.ok, false);
    assert.equal(f.releases, mode === 'resolve' ? 0 : 1);
    assert.equal(f.saves.length, 0);
  });
test('workspace/document change after resolving the original prevents download', async () => {
  const f = fixture();
  const resolve = f.deps.getDocumentAccessUrl;
  f.deps.getDocumentAccessUrl = async () => {
    const r = await resolve();
    f.current = false;
    return r;
  };
  const r = await downloadStoredFile({}, () => f.current, f.deps);
  assert.equal(r.ok, false);
  assert.equal(f.fetches.length, 0);
  assert.equal(f.saves.length, 0);
  assert.equal(f.releases, 1);
});
test('workspace/document change while reading bytes prevents saving', async () => {
  const f = fixture();
  f.deps.fetch = async () => {
    f.current = false;
    return new Response('original');
  };
  assert.equal((await downloadStoredFile({}, () => f.current, f.deps)).ok, false);
  assert.equal(f.saves.length, 0);
  assert.equal(f.releases, 1);
});

test('a hung original lookup times out and releases a handle arriving after timeout', async () => {
  const f = fixture();
  let resolve;
  f.deps.getDocumentAccessUrl = () =>
    new Promise((done) => {
      resolve = done;
    });
  const result = await downloadStoredFile({}, () => true, f.deps, 5);
  assert.equal(result.ok, false);
  assert.match(result.message, /too long/);
  assert.equal(f.saves.length, 0);
  resolve({ ok: true, url: 'https://example.test/late', release: () => f.releases++ });
  await new Promise((done) => setImmediate(done));
  assert.equal(f.releases, 1);
  assert.equal(f.saves.length, 0);
});

for (const failure of ['context', 'lookup rejection'])
  test(`preview handles ${failure} without leaving a blank or stale tab`, async () => {
    const { build } = await import('esbuild');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    let releaseAccess;
    let rejectAccess;
    let current = true;
    let closed = false;
    let released = 0;
    const preview = {
      opener: {},
      location: { href: '' },
      focus() {},
      close() {
        closed = true;
      },
    };
    globalThis.__filePreviewAccess = () =>
      new Promise((done, reject) => {
        releaseAccess = done;
        rejectAccess = reject;
      });
    const bundle = await build({
      entryPoints: ['src/lib/openStoredFile.ts'],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      packages: 'external',
      plugins: [
        {
          name: 'preview-boundary',
          setup(b) {
            b.onResolve({ filter: /cloudWorkspace/ }, () => ({ path: 'cloud', namespace: 'fixture' }));
            b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: 'export const getDocumentAccessUrl=(...args)=>globalThis.__filePreviewAccess(...args);',
            }));
          },
        },
      ],
    });
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, mod, mod.exports);
    const prior = globalThis.window;
    globalThis.window = { open: () => preview, setTimeout: () => 0 };
    try {
      const pending = mod.exports.openStoredFileInTab({}, () => current);
      if (failure === 'context') {
        releaseAccess({ ok: true, url: 'https://example.test/original', release: () => released++ });
        queueMicrotask(() => {
          current = false;
        });
      } else rejectAccess(new Error('Storage failed'));

      assert.equal((await pending).ok, false);
      assert.equal(closed, true);
      assert.equal(preview.location.href, '');
      assert.equal(released, failure === 'context' ? 1 : 0);
    } finally {
      globalThis.window = prior;
      delete globalThis.__filePreviewAccess;
    }
  });

test('original-file fetch preserves the browser global receiver', async () => {
  const f = fixture();
  f.deps.fetch = async function () {
    assert.equal(this, globalThis, 'browser fetch requires its Window receiver');
    return new Response('original bytes');
  };
  assert.equal((await downloadStoredFile({}, () => true, f.deps)).ok, true);
  assert.equal(f.saves.length, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: ['api/_lib/buyer-inquiries.js'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'controlled-external-boundaries',
      setup(b) {
        b.onResolve({ filter: /\/(supabase-admin|rate-limit|cors)\.js$/ }, ({ path }) => ({
          path,
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: path.endsWith('supabase-admin.js')
            ? 'export const getSupabaseAdmin=()=>globalThis.__buyerInquiryFixture.client;'
            : path.endsWith('rate-limit.js')
              ? 'export const enforceRateLimit=async()=>true;'
              : 'export const applyCors=()=>true;',
        }));
      },
    },
  ],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, module, module.exports);
const handler = module.exports.default;
const workspace = '11111111-1111-4111-8111-111111111111';
const envelope = () => ({
  horse: { id: 'horse-a' },
  sharedListing: {
    id: 'listing-a',
    horseId: 'horse-a',
    workspaceId: workspace,
    sharePath: '/profiles/horse-a',
    state: 'Live',
    accessMode: 'Private Token',
  },
});
async function invoke(listing, changes = {}, errors = {}) {
  const calls = [],
    writes = [];
  globalThis.__buyerInquiryFixture = {
    client: {
      rpc: async (...args) => {
        calls.push(args);
        return { data: listing, error: errors.resolve };
      },
      from: (table) => ({
        insert: async (row) => {
          writes.push({ table, row });
          return { error: errors.insert };
        },
      }),
    },
  };
  const payload = {
    sharePath: '/profiles/horse-a',
    shareToken: 'synthetic-token',
    kind: 'question',
    buyerName: 'Synthetic buyer',
    message: 'Synthetic question',
    ...changes,
  };
  const req = Readable.from([JSON.stringify(payload)]);
  req.method = 'POST';
  const res = {
    setHeader() {},
    end(body) {
      this.body = JSON.parse(body);
    },
  };
  await handler(req, res);
  return { res, writes, calls };
}
test('canonical nested resolver envelope writes its exact target', async () => {
  const r = await invoke(envelope());
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.writes.length, 1);
  assert.deepEqual(r.calls[0], [
    'xbar_resolve_public_listing',
    { p_share_path: '/profiles/horse-a', p_share_token: 'synthetic-token' },
  ]);
  assert.equal(r.writes[0].row.workspace_id, workspace);
  assert.equal(r.writes[0].row.horse_id, 'horse-a');
  assert.equal(r.writes[0].row.listing_id, 'listing-a');
});
test('valid legacy single row remains compatible', async () => {
  const r = await invoke([{ workspace_id: workspace, horse_id: 'horse-a', listing_id: 'listing-a' }]);
  assert.equal(r.res.statusCode, 200);
});
test('mixed envelope cannot redirect the workspace', async () => {
  const r = await invoke({ ...envelope(), workspace_id: '22222222-2222-4222-8222-222222222222' });
  assert.equal(r.res.statusCode, 404);
  assert.equal(r.writes.length, 0);
});
for (const [name, mutate] of [
  [
    'missing workspace',
    (e) => {
      delete e.sharedListing.workspaceId;
    },
  ],
  [
    'invalid workspace',
    (e) => {
      e.sharedListing.workspaceId = 'invalid';
    },
  ],
  [
    'conflicting horse',
    (e) => {
      e.horse.id = 'horse-b';
    },
  ],
  [
    'missing listing',
    (e) => {
      delete e.sharedListing.id;
    },
  ],
  [
    'wrong path',
    (e) => {
      e.sharedListing.sharePath = '/profiles/another';
    },
  ],
  [
    'retired state',
    (e) => {
      e.sharedListing.state = 'Archived';
    },
  ],
  [
    'malformed target',
    (e) => {
      e.sharedListing.horseId = { id: 'horse-a' };
    },
  ],
])
  test(`${name} refuses before event insert`, async () => {
    const e = envelope();
    mutate(e);
    const r = await invoke(e);
    assert.equal(r.res.statusCode, 404);
    assert.equal(r.writes.length, 0);
  });
test('ambiguous rows refuse before insert', async () => {
  const r = await invoke([envelope(), envelope()]);
  assert.equal(r.res.statusCode, 404);
  assert.equal(r.writes.length, 0);
});
test('RPC refusal and error preserve authorization boundary', async () => {
  for (const [data, error] of [
    [null, null],
    [envelope(), { message: 'refused' }],
  ]) {
    const r = await invoke(data, {}, { resolve: error });
    assert.equal(r.res.statusCode, 404);
    assert.equal(r.writes.length, 0);
  }
});
test('private envelope without token is refused and public metadata follows resolved mode', async () => {
  const privateResult = await invoke(envelope(), { shareToken: '' });
  assert.equal(privateResult.res.statusCode, 404);
  const e = envelope();
  e.sharedListing.accessMode = 'Public Link';
  const r = await invoke(e);
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.writes[0].row.access_mode, 'Public Link');
});
test('insert failure remains truthful', async () => {
  const r = await invoke(envelope(), {}, { insert: { message: 'failed' } });
  assert.equal(r.res.statusCode, 502);
  assert.equal(r.res.body.ok, false);
});
test('opaque horse and listing identifiers remain exact', async () => {
  const e = envelope();
  e.horse.id = e.sharedListing.horseId = ' horse-a ';
  e.sharedListing.id = ' listing-a ';
  const r = await invoke(e);
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.writes[0].row.horse_id, ' horse-a ');
  assert.equal(r.writes[0].row.listing_id, ' listing-a ');
});

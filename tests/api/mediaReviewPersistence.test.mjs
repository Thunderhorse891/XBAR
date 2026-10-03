import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { Readable } from 'node:stream';

const base = pathToFileURL(path.resolve('api/_lib/account-media-review.js'));
const source = readFileSync(base, 'utf8').replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_m, _q, relative) => {
  const url = new URL(relative, base);
  if (url.pathname.endsWith('/supabase-admin.js'))
    return 'from "data:text/javascript,export const requireWorkspaceAccess=async()=>globalThis.__mediaReviewAccess"';
  return `from '${url.href}'`;
});
const handler = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
const body = {
  workspaceId: 'ranch',
  horseId: 'horse',
  assetId: 'photo',
  approved: true,
  expectedStoragePath: 'stored/photo',
  expectedUrl: '',
};
const freshHorse = () => ({
  horse_id: 'horse',
  payload: {
    name: 'Preserved horse',
    privateNotes: 'preserved',
    gallery: [
      { id: 'photo', storagePath: 'stored/photo', url: '', status: 'Pending' },
      { id: 'other', storagePath: 'stored/other', url: '', status: 'Pending' },
    ],
  },
});
let row, reads, writes, conflict, failure, noAck;
function reset(role = 'Sales Lead') {
  row = freshHorse();
  reads = 0;
  writes = 0;
  conflict = false;
  failure = false;
  noAck = false;
  globalThis.__mediaReviewAccess = {
    ok: true,
    role,
    user: { id: 'invited-sales-lead-not-owner' },
    supabase: {
      from(table) {
        assert.equal(table, 'horses');
        const filters = {};
        let update;
        return {
          select() {
            return this;
          },
          update(value) {
            update = value;
            return this;
          },
          eq(key, value) {
            filters[key] = value;
            return this;
          },
          async maybeSingle() {
            assert.equal(filters.workspace_id, 'ranch');
            assert.equal(filters.horse_id, 'horse');
            if (!update) {
              reads++;
              return { data: structuredClone(row) };
            }
            writes++;
            assert.deepEqual(Object.keys(update).sort(), ['payload', 'updated_at']);
            assert.equal(filters.payload, JSON.stringify(row.payload));
            if (failure) return { error: { message: 'write failed' } };
            if (conflict || noAck) return { data: null };
            row = { ...row, ...update };
            return { data: { horse_id: row.horse_id } };
          },
        };
      },
    },
  };
}
async function invoke(value = body, method = 'POST', authorization = 'Bearer fixture') {
  const req = Readable.from([JSON.stringify(value)]);
  Object.assign(req, { method, headers: { authorization }, url: '/api/account/media-review' });
  const res = {
    setHeader() {},
    end(value) {
      this.body = JSON.parse(value);
    },
  };
  await handler(req, res);
  return res;
}
test('non-owner Sales Lead persists only the selected review; reread retains the acknowledged status', async () => {
  process.env.NODE_ENV = 'test';
  process.env.RATE_LIMIT_MODE = 'memory';
  delete process.env.VERCEL;
  reset();
  assert.equal((await invoke()).statusCode, 200);
  assert.equal(row.payload.gallery[0].status, 'Approved');
  assert.equal(row.payload.gallery[1].status, 'Pending');
  assert.equal(row.payload.privateNotes, 'preserved');
  assert.equal(row.payload.name, 'Preserved horse');
  assert.equal(reads, 1);
  assert.equal(writes, 1);
  const reread = await globalThis.__mediaReviewAccess.supabase
    .from('horses')
    .select()
    .eq('workspace_id', 'ranch')
    .eq('horse_id', 'horse')
    .maybeSingle();
  assert.equal(reread.data.payload.gallery[0].status, 'Approved');
  assert.equal((await invoke({ ...body, approved: false })).statusCode, 200);
  assert.equal(row.payload.gallery[0].status, 'Pending');
});
test('unauthorized roles, wrong method, missing auth and changed image cannot write review', async () => {
  for (const role of ['Owner', 'Ranch Manager', 'Medical Lead', 'unknown']) {
    reset(role);
    assert.equal((await invoke()).statusCode, 403);
    assert.equal(reads + writes, 0);
  }
  reset();
  assert.equal((await invoke(body, 'GET')).statusCode, 405);
  assert.equal((await invoke(body, 'POST', '')).statusCode, 401);
  assert.equal((await invoke({ ...body, approved: 'true' })).statusCode, 400);
  assert.equal((await invoke({ ...body, expectedStoragePath: 'other/photo' })).statusCode, 409);
  assert.equal(writes, 0);
  globalThis.__mediaReviewAccess = { ok: false, status: 403, message: 'Not a ranch member' };
  assert.equal((await invoke()).statusCode, 403);
});
test('concurrent changes, write errors and absent acknowledgments refuse success', async () => {
  for (const mode of ['conflict', 'failure', 'noAck']) {
    reset();
    conflict = mode === 'conflict';
    failure = mode === 'failure';
    noAck = mode === 'noAck';
    const result = await invoke();
    assert.equal(result.statusCode, failure ? 503 : 409);
    assert.equal(result.body.ok, false);
    assert.equal(row.payload.gallery[0].status, 'Pending');
  }
});

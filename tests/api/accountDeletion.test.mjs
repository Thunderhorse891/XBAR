import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';

import {
  confirmationSatisfied,
  documentPrefixesToPurge,
  mediaPrefixesToPurge,
  pickSuccessorOwner,
  planAccountDeletion,
  loadAccountDeletionPlan,
} from '../../api/_lib/account-deletion.js';

test('confirmation requires the exact account email (trimmed, case-insensitive)', () => {
  assert.equal(confirmationSatisfied('rancher@example.com', 'rancher@example.com'), true);
  assert.equal(confirmationSatisfied('  Rancher@Example.com  ', 'rancher@example.com'), true);
  assert.equal(confirmationSatisfied('someone@else.com', 'rancher@example.com'), false);
});

test('empty or missing confirmation never matches', () => {
  assert.equal(confirmationSatisfied('', 'rancher@example.com'), false);
  assert.equal(confirmationSatisfied('   ', 'rancher@example.com'), false);
  assert.equal(confirmationSatisfied(undefined, 'rancher@example.com'), false);
  assert.equal(confirmationSatisfied('rancher@example.com', ''), false); // no account email known
  assert.equal(confirmationSatisfied(null, null), false);
});

test('a privately-owned workspace (no other active members) is purged', () => {
  const plan = planAccountDeletion('user-1', [{ id: 'ws-solo', otherActiveMembers: [] }]);
  assert.deepEqual(plan.workspacesToPurge, ['ws-solo']);
  assert.deepEqual(plan.workspacesToTransfer, []);
});

test('a shared workspace is transferred, never purged, protecting its members', () => {
  const plan = planAccountDeletion('user-1', [
    {
      id: 'ws-shared',
      otherActiveMembers: [
        { userId: 'u-sales', role: 'Sales Lead' },
        { userId: 'u-admin', role: 'Admin' },
      ],
    },
  ]);
  assert.deepEqual(plan.workspacesToPurge, []);
  assert.equal(plan.workspacesToTransfer.length, 1);
  // Ownership goes to the most capable member (Admin over Sales Lead).
  assert.deepEqual(plan.workspacesToTransfer[0], { workspaceId: 'ws-shared', newOwnerUserId: 'u-admin' });
});

test('mixed ownership splits correctly', () => {
  const plan = planAccountDeletion('user-1', [
    { id: 'ws-solo', otherActiveMembers: [] },
    { id: 'ws-team', otherActiveMembers: [{ userId: 'u2', role: 'Ranch Manager' }] },
  ]);
  assert.deepEqual(plan.workspacesToPurge, ['ws-solo']);
  assert.deepEqual(plan.workspacesToTransfer, [{ workspaceId: 'ws-team', newOwnerUserId: 'u2' }]);
});

test('successor selection prefers higher-capability roles and tolerates unknown roles', () => {
  assert.equal(
    pickSuccessorOwner([
      { userId: 'a', role: 'Owner' },
      { userId: 'b', role: 'Ranch Manager' },
      { userId: 'c', role: 'Medical Lead' },
    ]),
    'b', // Ranch Manager outranks Medical Lead and Owner
  );
  assert.equal(pickSuccessorOwner([{ userId: 'x', role: 'Mystery' }]), 'x'); // unknown role still eligible
  assert.equal(pickSuccessorOwner([]), null);
  assert.equal(pickSuccessorOwner(undefined), null);
});

test('plan tolerates empty/undefined input and skips rows without ids', () => {
  assert.deepEqual(planAccountDeletion('u', undefined), {
    userId: 'u',
    workspacesToPurge: [],
    workspacesToTransfer: [],
  });
  const plan = planAccountDeletion('u', [{ otherActiveMembers: [] }, { id: 'ws-ok', otherActiveMembers: [] }]);
  assert.deepEqual(plan.workspacesToPurge, ['ws-ok']);
});

function deletionReader(ownership, memberships) {
  return {
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        neq() {
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve(table === 'workspaces' ? ownership : memberships).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

for (const result of [
  { data: null, error: { message: 'Database unavailable' } },
  { data: null, error: null },
]) {
  test(`unreadable ownership blocks deletion (${result.error ? 'error' : 'missing data'})`, async () => {
    await assert.rejects(
      loadAccountDeletionPlan(deletionReader(result, { data: [], error: null }), 'u1'),
      /Unable to verify owned workspaces/,
    );
  });
  test(`unreadable members cannot turn a shared workspace into a purge (${result.error ? 'error' : 'missing data'})`, async () => {
    await assert.rejects(
      loadAccountDeletionPlan(deletionReader({ data: [{ id: 'shared' }], error: null }, result), 'u1'),
      /Unable to verify shared workspace members/,
    );
  });
}

test('verified private and shared workspaces produce distinct deletion plans', async () => {
  const ownership = { data: [{ id: 'workspace' }], error: null };
  const privatePlan = await loadAccountDeletionPlan(deletionReader(ownership, { data: [], error: null }), 'u1');
  assert.deepEqual(privatePlan.workspacesToPurge, ['workspace']);
  const sharedPlan = await loadAccountDeletionPlan(
    deletionReader(ownership, { data: [{ user_id: 'u2', role: 'Admin' }], error: null }),
    'u1',
  );
  assert.deepEqual(sharedPlan.workspacesToPurge, []);
  assert.deepEqual(sharedPlan.workspacesToTransfer, [{ workspaceId: 'workspace', newOwnerUserId: 'u2' }]);
});

test('the real handler refuses failed prerequisites and shared-workspace deletion before destructive calls', async (t) => {
  const envKeys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });
  process.env.SUPABASE_URL = 'https://deletion-fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-key';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  let scenario;
  let writes = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, 'deletion-fixture.invalid', 'test must not contact a real service');
    const method = init.method ?? 'GET';
    if (method !== 'GET') writes.push(`${method} ${url.pathname}`);
    const reply = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    const failure = () => reply({ message: 'Fixture database failure', code: 'XX000' }, 400);
    if (url.pathname === '/auth/v1/user') return reply({ id: 'u1', email: 'owner@example.invalid' });
    if (url.pathname === '/rest/v1/workspaces' && method === 'GET')
      return scenario === 'owned' ? failure() : reply([{ id: 'ws1' }]);
    if (url.pathname === '/rest/v1/workspace_memberships' && method === 'GET')
      return scenario === 'members'
        ? failure()
        : reply(scenario === 'transfer' ? [{ user_id: 'u2', role: 'Admin' }] : []);
    if (url.pathname === '/rest/v1/workspaces' && method === 'PATCH') return reply(null);
    if (url.pathname === '/rest/v1/workspace_memberships' && method === 'DELETE') return failure();
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });
  const { default: handler } = await import('../../api/account/delete.js');
  for (scenario of ['owned', 'members', 'transfer', 'removal']) {
    writes = [];
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-token', 'x-real-ip': `fixture-${scenario}` },
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({ confirmation: 'owner@example.invalid' });
      },
    };
    const res = {
      statusCode: 0,
      body: '',
      setHeader() {},
      end(body) {
        this.body = body;
      },
    };
    await handler(req, res);
    assert.ok(
      scenario === 'transfer' ? res.statusCode === 409 : res.statusCode >= 500,
      `${scenario} must refuse deletion`,
    );
    assert.equal(JSON.parse(res.body).ok, false);
    assert.ok(
      !writes.some((request) => request.includes('/auth/') || request.includes('/storage/')),
      `${scenario} reached irreversible deletion`,
    );
    if (scenario !== 'removal') assert.deepEqual(writes, []);
    if (scenario === 'transfer') assert.equal(JSON.parse(res.body).code, 'shared_workspace_handoff_required');
  }
});

test('a purged private workspace has its documents erased, not orphaned', () => {
  // Documents are keyed to the workspace now, so sweeping only the departing
  // account's own prefix would leave every file of a purged private workspace
  // in the bucket while Settings promises it was "permanently erased".
  const plan = planAccountDeletion('user-1', [{ id: 'ws-solo', otherActiveMembers: [] }]);
  assert.deepEqual(documentPrefixesToPurge(plan), ['user-1', 'ws-solo']);
});

test('a transferred workspace is never swept, in either bucket', () => {
  // The people who stayed keep their records. This is the one assertion that
  // stands between a departing owner and the rest of the ranch's files.
  const plan = planAccountDeletion('user-1', [
    { id: 'ws-shared', otherActiveMembers: [{ userId: 'u-admin', role: 'Admin' }] },
    { id: 'ws-solo', otherActiveMembers: [] },
  ]);
  assert.deepEqual(plan.workspacesToTransfer, [{ workspaceId: 'ws-shared', newOwnerUserId: 'u-admin' }]);
  assert.ok(!documentPrefixesToPurge(plan).includes('ws-shared'));
  assert.ok(!mediaPrefixesToPurge(plan).includes('ws-shared'));
  assert.deepEqual(documentPrefixesToPurge(plan), ['user-1', 'ws-solo']);
});

test('media is swept by uploader only, because that is how media is keyed', () => {
  // horse-media is a public bucket and never had the shared-read problem that
  // moved documents onto workspace paths, so a workspace prefix here would
  // erase nothing today and be a loaded gun if that ever changed.
  const plan = planAccountDeletion('user-1', [{ id: 'ws-solo', otherActiveMembers: [] }]);
  assert.deepEqual(mediaPrefixesToPurge(plan), ['user-1']);
});

test('an account owning nothing still has its own uploads erased', () => {
  const plan = planAccountDeletion('user-1', []);
  assert.deepEqual(documentPrefixesToPurge(plan), ['user-1']);
  assert.deepEqual(mediaPrefixesToPurge(plan), ['user-1']);
});

test('a malformed plan sweeps nothing rather than the whole bucket', () => {
  // An empty prefix lists every object in the bucket. Erasing a customer's
  // files is the one operation where "best effort" has to mean "nothing".
  assert.deepEqual(documentPrefixesToPurge({ userId: '', workspacesToPurge: ['', null] }), []);
  assert.deepEqual(documentPrefixesToPurge({}), []);
  assert.deepEqual(documentPrefixesToPurge(undefined), []);
  assert.deepEqual(mediaPrefixesToPurge({ userId: undefined }), []);
});

test('the deletion endpoint actually uses those prefix lists', () => {
  // A rule nothing calls is not a fix. This pins the wiring, since the sweep
  // itself needs a live Supabase project to exercise end to end.
  const source = readFileSync(new URL('../../api/account/delete.js', import.meta.url), 'utf8');
  assert.ok(source.includes('documentPrefixesToPurge(plan)'), 'document prefixes are not used by the endpoint');
  assert.ok(source.includes('mediaPrefixesToPurge(plan)'), 'media prefixes are not used by the endpoint');
  assert.ok(!source.includes('removeUserStorage'), 'the uploader-only sweep is still present');
});

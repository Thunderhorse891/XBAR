import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';

import {
  confirmationSatisfied,
  documentPrefixesToPurge,
  mediaPrefixesToPurge,
  packetPrefixesToPurge,
  pickSuccessorOwner,
  planAccountDeletion,
  loadAccountDeletionPlan,
  heldWorkspaceIds,
  pathsStillReferenced,
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

/*
 * The real handler, against a scripted Supabase (REST, RPC, auth admin and
 * storage all go through fetch). Each scenario asserts what reached the
 * irreversible calls -- the auth delete and storage -- and what did not.
 */
const FIXTURE_USER = '11111111-1111-4111-8111-111111111111';

function deletionFixture(t) {
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

  const state = { scenario: '', calls: [], receiptUpdates: [] };
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, 'deletion-fixture.invalid', 'test must not contact a real service');
    const method = init.method ?? 'GET';
    const scenario = state.scenario;
    state.calls.push(`${method} ${url.pathname}`);
    const reply = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    const failure = () => reply({ message: 'Fixture database failure', code: 'XX000' }, 400);

    if (url.pathname === '/auth/v1/user') return reply({ id: FIXTURE_USER, email: 'owner@example.invalid' });
    if (url.pathname === '/rest/v1/workspaces' && method === 'GET')
      return scenario === 'owned' ? failure() : reply([{ id: 'ws1' }]);
    if (url.pathname === '/rest/v1/workspace_memberships' && method === 'GET')
      return scenario === 'members'
        ? failure()
        : reply(scenario === 'transfer' ? [{ user_id: '22222222-2222-4222-8222-222222222222', role: 'Admin' }] : []);
    if (url.pathname === '/rest/v1/rpc/xbar_hold_owned_workspaces_for_deletion') {
      if (scenario === 'hold') return failure();
      if (scenario === 'joined') return reply({ ok: false, shared: ['ws1'], held: [] });
      return reply({ ok: true, shared: [], held: ['ws1'] });
    }
    if (url.pathname === '/rest/v1/rpc/xbar_release_account_deletion_holds') return reply(1);
    if (url.pathname === '/rest/v1/account_deletion_receipts' && method === 'POST')
      return scenario === 'receipt' ? failure() : reply({ id: 'receipt-1' }, 201);
    if (url.pathname === '/rest/v1/account_deletion_receipts' && method === 'PATCH') {
      state.receiptUpdates.push(JSON.parse(init.body));
      return reply(null, 204);
    }
    if (url.pathname === '/rest/v1/documents' && method === 'GET')
      return scenario === 'refs'
        ? failure()
        : reply([
            { workspace_id: 'ws-other', storage_path: `${FIXTURE_USER}/documents/shared.pdf` },
            { workspace_id: 'ws1', storage_path: `${FIXTURE_USER}/documents/mine.pdf` },
          ]);
    if (url.pathname === `/auth/v1/admin/users/${FIXTURE_USER}` && method === 'DELETE')
      return scenario === 'auth' ? reply({ message: 'Fixture auth failure' }, 500) : reply({});
    if (url.pathname === '/rest/v1/workspaces' && method === 'DELETE') return reply(null, 204);
    if (url.pathname.startsWith('/storage/v1/object/list/')) {
      const { prefix } = JSON.parse(init.body);
      // Only the documents bucket holds the legacy files in this scenario.
      if (url.pathname !== '/storage/v1/object/list/horse-documents') return reply([]);
      if (prefix === `${FIXTURE_USER}/documents`)
        return reply([
          { name: 'shared.pdf', id: 'o1' },
          { name: 'mine.pdf', id: 'o2' },
        ]);
      if (prefix === FIXTURE_USER) return reply([{ name: 'documents', id: null }]);
      return reply([]);
    }
    if (url.pathname.startsWith('/storage/v1/object/') && method === 'DELETE') {
      state.removed = [...(state.removed ?? []), ...JSON.parse(init.body).prefixes];
      return reply([]);
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });
  return state;
}

async function deleteAccount(handler, ip) {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer fixture-token', 'x-real-ip': ip },
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
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

test('every refusal before the auth delete changes nothing irreversible', async (t) => {
  const state = deletionFixture(t);
  const { default: handler } = await import('../../api/_lib/account-delete.js');
  const expectations = {
    owned: '5xx', // ownership unreadable
    members: '5xx', // shared-member check unreadable
    transfer: 409, // shared at plan time
    hold: 502, // the database hold could not be placed
    joined: 409, // someone joined before the hold -- the race, refused at the database
    receipt: 502, // no durable receipt, so no deletion
    refs: 502, // shared file references unreadable
  };
  for (const [scenario, status] of Object.entries(expectations)) {
    state.scenario = scenario;
    state.calls = [];
    const response = await deleteAccount(handler, `fixture-${scenario}`);
    if (status === '5xx') assert.ok(response.status >= 500, `${scenario} must refuse with a 5xx`);
    else assert.equal(response.status, status, `${scenario} must refuse with ${status}`);
    assert.equal(response.body.ok, false);
    assert.ok(
      !state.calls.some((call) => call.includes('/auth/v1/admin/') || call.includes('/storage/')),
      `${scenario} reached an irreversible call: ${state.calls.join(', ')}`,
    );
    assert.ok(
      !state.calls.some((call) => call.startsWith('DELETE ')),
      `${scenario} deleted something: ${state.calls.join(', ')}`,
    );
    if (scenario === 'transfer' || scenario === 'joined') {
      assert.equal(response.body.code, 'shared_workspace_handoff_required');
    }
    // A hold that was placed is always lifted again on the way out.
    const held = state.calls.includes('POST /rest/v1/rpc/xbar_hold_owned_workspaces_for_deletion');
    const placed = held && !['hold', 'joined'].includes(scenario);
    assert.equal(
      state.calls.includes('POST /rest/v1/rpc/xbar_release_account_deletion_holds'),
      placed,
      `${scenario}: holds released exactly when they were placed`,
    );
  }
});

test('a failed auth delete removes nothing, releases the holds and records the failure', async (t) => {
  const state = deletionFixture(t);
  const { default: handler } = await import('../../api/_lib/account-delete.js');
  state.scenario = 'auth';
  state.calls = [];
  state.receiptUpdates = [];
  const response = await deleteAccount(handler, 'fixture-auth');
  assert.equal(response.status, 502);
  assert.match(response.body.message, /Nothing was removed/);
  // The old handler deleted every membership first, so this left the person
  // signed up but locked out of every other owner's ranch.
  assert.ok(!state.calls.some((call) => call.includes('workspace_memberships') && call.startsWith('DELETE')));
  assert.ok(
    !state.calls.some((call) => call.includes('/storage/')),
    'no file was swept for an account that still exists',
  );
  assert.ok(state.calls.includes('POST /rest/v1/rpc/xbar_release_account_deletion_holds'));
  assert.equal(state.receiptUpdates.at(-1)?.status, 'failed');
  assert.doesNotMatch(JSON.stringify(response.body), /Fixture auth failure/, 'provider text stays in the log');
});

test('a completed deletion keeps files another ranch still uses and records the outcome', async (t) => {
  const state = deletionFixture(t);
  const { default: handler } = await import('../../api/_lib/account-delete.js');
  state.scenario = 'success';
  state.calls = [];
  state.receiptUpdates = [];
  state.removed = [];
  const response = await deleteAccount(handler, 'fixture-success');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.storageCleanupComplete, true);
  assert.deepEqual(state.removed, [`${FIXTURE_USER}/documents/mine.pdf`], 'only the file no surviving ranch points at');
  assert.equal(state.receiptUpdates.at(-1)?.status, 'complete');
  const holdAt = state.calls.indexOf('POST /rest/v1/rpc/xbar_hold_owned_workspaces_for_deletion');
  const deleteAt = state.calls.indexOf(`DELETE /auth/v1/admin/users/${FIXTURE_USER}`);
  assert.ok(holdAt > -1 && deleteAt > holdAt, 'the database hold comes before the auth delete');
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

test('media is swept under the purged workspace too, because photos are keyed to it', () => {
  // Photos are written under `<workspace-id>/horses/...` (audit F02). Sweeping
  // only the departing user's prefix left a purged ranch's photos in the
  // bucket after the endpoint reported the account erased.
  const plan = planAccountDeletion('user-1', [
    { id: 'ws-solo', otherActiveMembers: [] },
    { id: 'ws-shared', otherActiveMembers: [{ userId: 'user-2', role: 'Admin' }] },
  ]);
  assert.deepEqual(mediaPrefixesToPurge(plan), ['user-1', 'ws-solo']);
  // A workspace someone else stays in is never swept.
  assert.ok(!mediaPrefixesToPurge(plan).includes('ws-shared'));
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

test('sale packets of a purged workspace are swept, and never by user id or for a transferred one', () => {
  // Every packet embeds full copies of the horse's documents. Leaving them in
  // the bucket kept the papers the deletion promised to erase.
  const plan = planAccountDeletion('user-1', [
    { id: 'ws-solo', otherActiveMembers: [] },
    { id: 'ws-shared', otherActiveMembers: [{ userId: 'user-2', role: 'Admin' }] },
  ]);
  assert.deepEqual(packetPrefixesToPurge(plan), ['ws-solo']);
  assert.deepEqual(packetPrefixesToPurge({ userId: 'user-1', workspacesToPurge: ['', null] }), []);
  assert.deepEqual(packetPrefixesToPurge(undefined), []);
});

test('the deletion endpoint actually uses those prefix lists', () => {
  // A rule nothing calls is not a fix. This pins the wiring, since the sweep
  // itself needs a live Supabase project to exercise end to end.
  const source = readFileSync(new URL('../../api/_lib/account-delete.js', import.meta.url), 'utf8');
  assert.ok(source.includes('documentPrefixesToPurge('), 'document prefixes are not used by the endpoint');
  assert.ok(source.includes('mediaPrefixesToPurge('), 'media prefixes are not used by the endpoint');
  assert.match(
    source,
    /\[PACKET_BUCKET, packetPrefixesToPurge\(purge\)\]/,
    'sale-packet PDFs of a purged workspace are not swept',
  );
  assert.match(source, /const purge = \{ \.\.\.plan, workspacesToPurge: purgeable \};/);
  assert.ok(!source.includes('removeUserStorage'), 'the uploader-only sweep is still present');

  /*
   * And they are built from the HELD set, not the stale plan. Sweeping
   * `plan.workspacesToPurge` would erase the files of a workspace someone
   * joined after the plan was read -- the worse half of the race.
   */
  assert.ok(
    !source.includes('documentPrefixesToPurge(plan)') &&
      !source.includes('mediaPrefixesToPurge(plan)') &&
      !source.includes('packetPrefixesToPurge(plan)'),
    'the storage sweep must follow the database hold, not the plan read before it',
  );
  assert.ok(source.includes('const purgeable = heldWorkspaceIds(hold);'), 'the purge set is what the database held');

  /*
   * The re-check is the database hold, and it must run BEFORE the auth user is
   * deleted. `workspaces.owner_user_id` cascades, so a check asked afterwards
   * reads an emptied table and can only widen the purge -- the ordering bug
   * that shipped in the first version.
   */
  const holdAt = source.indexOf("supabase.rpc('xbar_hold_owned_workspaces_for_deletion'");
  const deleteUserAt = source.indexOf('await supabase.auth.admin.deleteUser(');
  assert.ok(holdAt > 0 && deleteUserAt > 0, 'precondition: both calls were found');
  assert.ok(holdAt < deleteUserAt, 'the hold must be placed before deleteUser');

  // Unreadable is never private, and someone joining refuses the whole request.
  assert.match(
    source,
    /if \(holdError \|\| !hold \|\| typeof hold\.ok !== 'boolean'\) \{[\s\S]*?return sendJson\(res, 502,/,
  );
  assert.match(source, /if \(!hold\.ok\) \{\s*return sendJson\(res, 409,/);

  // Nothing is removed ahead of the auth delete: memberships cascade with it.
  assert.doesNotMatch(source, /from\('workspace_memberships'\)\s*\.delete\(\)/);

  /*
   * The hold's sharing test is in SQL now, so the NULL-user_id rule is pinned
   * there: `<>` would silently skip a membership row with no user, and an
   * active membership belonging to nobody identifiable is evidence of sharing.
   */
  const migration = readFileSync(
    new URL('../../supabase/migrations/20261002100000_account_deletion_hold.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /m\.user_id is distinct from p_user_id/);
  assert.match(
    migration,
    /perform pg_advisory_xact_lock\(hashtextextended\('xbar-seats:' \|\| workspace_row\.id::text, 0\)\);/,
  );
  assert.match(
    migration,
    /perform pg_advisory_xact_lock\(hashtextextended\('xbar-seats:' \|\| new\.workspace_id::text, 0\)\);/,
    'the refusal trigger must take the same lock as the hold, or the two can interleave',
  );
});

test('only well-formed held ids reach the purge', () => {
  assert.deepEqual(heldWorkspaceIds({ ok: true, held: ['ws-a', '', null, 42, 'ws-b'] }), ['ws-a', 'ws-b']);
  assert.deepEqual(heldWorkspaceIds({ ok: true }), []);
  assert.deepEqual(heldWorkspaceIds(null), []);
});

test("files a surviving ranch still points at are kept; a purged ranch's are not", () => {
  const keep = pathsStillReferenced(
    [
      { workspace_id: 'ws-other', storage_path: 'u1/documents/shared.pdf' },
      { workspace_id: 'ws-purged', storage_path: 'u1/documents/mine.pdf' },
      { workspace_id: 'ws-other', storage_path: '' },
      { workspace_id: null, storage_path: 'u1/documents/orphan-row.pdf' },
      null,
    ],
    ['ws-purged'],
  );
  assert.deepEqual([...keep].sort(), ['u1/documents/orphan-row.pdf', 'u1/documents/shared.pdf']);
});

test('a storage sweep reports every prefix it could not clear, instead of claiming success', async () => {
  const { removeStoragePrefixes } = await import('../../api/_lib/account-delete.js');
  const removed = [];
  const fake = (behaviour) => ({
    storage: {
      from: () => ({
        list: async (prefix) => {
          if (behaviour.listFails?.includes(prefix)) return { data: null, error: { message: 'timeout' } };
          if (prefix === 'ws-a')
            return {
              data: [
                { name: 'p.pdf', id: '1' },
                { name: 'horse-1', id: null },
              ],
              error: null,
            };
          if (prefix === 'ws-a/horse-1') return { data: [{ name: 'q.pdf', id: '2' }], error: null };
          return { data: [], error: null };
        },
        remove: async (paths) => {
          removed.push(...paths);
          return behaviour.removeFails ? { data: null, error: { message: 'denied' } } : { data: paths, error: null };
        },
      }),
    },
  });

  assert.deepEqual(await removeStoragePrefixes(fake({}), 'b', ['ws-a', 'ws-empty']), []);
  assert.deepEqual(removed, ['ws-a/p.pdf', 'ws-a/horse-1/q.pdf']);
  // A listing that fails part-way is "could not look", not "nothing here".
  assert.deepEqual(await removeStoragePrefixes(fake({ listFails: ['ws-a/horse-1'] }), 'b', ['ws-a']), ['ws-a']);
  assert.deepEqual(await removeStoragePrefixes(fake({ listFails: ['ws-a'] }), 'b', ['ws-a', 'ws-empty']), ['ws-a']);
  assert.deepEqual(await removeStoragePrefixes(fake({ removeFails: true }), 'b', ['ws-a']), ['ws-a']);

  // A kept path is listed but never removed, and does not count as a failure.
  removed.length = 0;
  assert.deepEqual(await removeStoragePrefixes(fake({}), 'b', ['ws-a'], new Set(['ws-a/p.pdf'])), []);
  assert.deepEqual(removed, ['ws-a/horse-1/q.pdf']);
});

test('the deletion response says when stored files were left behind', () => {
  const source = readFileSync(new URL('../../api/_lib/account-delete.js', import.meta.url), 'utf8');
  assert.match(source, /storageCleanupComplete: leftovers\.length === 0/);
  assert.ok(!/removeStoragePrefixes\([^)]*\)\s*\.catch\(\(\) => \{\}\)/.test(source), 'a sweep failure is swallowed');
  const client = readFileSync(new URL('../../src/store/useCloudStore.ts', import.meta.url), 'utf8');
  assert.match(client, /payload\.storageCleanupComplete === false/);
});

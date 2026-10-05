import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { cloudBootstrapFixture } from './fixtures/cloudBootstrapHarness.mjs';
registerHooks({
  resolve(specifier, context, next) {
    if (/\/supabaseClient(?:\.[tj]s)?$/.test(specifier))
      return { url: new URL('./fixtures/cloudSubscriptionClient.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const { setCloudSubscriptionClient } = await import('./fixtures/cloudSubscriptionClient.mjs');
const { supabaseConfig } = await import('../../src/lib/platformConfig.ts');
const { loadWorkspaceBackupFromCloud } = await import('../../src/lib/cloudWorkspace.ts');
const { createEmptyWorkspaceState, restorePersistedState, selectPersistedState } =
  await import('../../src/store/xbarStoreHelpers.ts');
const { decideCloudReconciliation, hasMeaningfulWorkspace } = await import('../../src/lib/cloudSyncPolicy.ts');
const { mergeCloudSubscription, withCloudSubscription } = await import('../../src/lib/cloudSubscription.ts');
const ids = {
  workspace_memberships: 'id',
  workspace_invitations: 'invitation_id',
  horses: 'horse_id',
  documents: 'document_id',
  intake_batches: 'intake_batch_id',
  ownership_records: 'ownership_record_id',
  expense_receipts: 'receipt_id',
  ranch_assets: 'asset_id',
  sales_leads: 'lead_id',
  shared_listings: 'listing_id',
};
const stamp = '2026-10-04T12:00:00.000Z';
let calls;
function fixture(o = {}) {
  calls = [];
  Object.assign(supabaseConfig, {
    url: 'http://127.0.0.1:4179',
    anonKey: 'fixture',
    relationalSyncEnabled: true,
    snapshotFallbackEnabled: true,
  });
  const horses = Array.from({ length: o.count ?? 1 }, (_, i) => ({
    id: `horse-${String(i).padStart(5, '0')}`,
    name: `Horse ${i}`,
    sale: { askPrice: i, inquiryCount: 0 },
    documentFacts: [],
  }));
  const workspace = { ...createEmptyWorkspaceState(), horses };
  if (o.completeProfile)
    workspace.workspaceProfile = {
      ...workspace.workspaceProfile,
      ranchName: 'Completed ranch',
      setupCompleteAt: stamp,
    };
  const tables = Object.fromEntries(Object.keys(ids).map((t) => [t, []]));
  tables.horses = horses.map((payload) => ({ horse_id: payload.id, payload, updated_at: stamp }));
  if (o.legacyMembership || o.missingMemberDate || o.payloadlessMembership)
    tables.workspace_memberships = [
      {
        id: 'db-member-a',
        payload: {
          email: 'owner@example.test',
          role: 'Admin',
          status: 'Active',
          source: 'Owner',
          ...(o.missingMemberDate ? {} : { joinedAt: stamp }),
        },
        updated_at: stamp,
      },
    ];
  if (o.payloadlessMembership) tables.workspace_memberships[0].payload = null;
  if (o.missingInvitationDate)
    tables.workspace_invitations = [
      {
        invitation_id: 'invite-a',
        payload: { id: 'invite-a', email: 'invite@example.test', role: 'Owner' },
        updated_at: stamp,
      },
    ];
  if (o.legacyOwnership) {
    workspace.ownershipRecords = [
      { id: 'ownership-a', horseId: 'horse-00000', legalOwner: 'Owner', transferStatus: 'Pending' },
    ];
    tables.ownership_records = workspace.ownershipRecords.map((payload) => ({
      ownership_record_id: payload.id,
      payload,
      updated_at: stamp,
    }));
  }
  if (o.legacyListing || o.publicTokenless || o.archivedTokenless)
    tables.shared_listings = [
      {
        listing_id: 'listing-a',
        payload: {
          id: 'listing-a',
          horseId: 'horse-00000',
          state: o.archivedTokenless ? 'Archived' : 'Draft',
          accessMode: o.publicTokenless ? 'Public Link' : 'Private Token',
        },
        updated_at: stamp,
      },
    ];
  if (o.sameDayListing)
    tables.shared_listings = [
      {
        listing_id: 'listing-a',
        updated_at: '2026-10-05',
        payload: {
          id: 'listing-a',
          horseId: 'horse-00000',
          accessMode: 'Private Token',
          state: 'Live',
          shareToken: 'before-token',
          tokenIssuedAt: '2026-10-05',
          createdAt: '2026-10-05',
          updatedAt: '2026-10-05',
        },
      },
    ];
  if (o.corruptRow) tables.horses[0].payload = null;
  if (o.mismatchedPayloadId) tables.horses[0].payload.id = 'wrong-horse';
  let accessCalls = 0;
  setCloudSubscriptionClient({
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'user-owner', email: 'owner@example.test' } } },
        error: null,
      }),
    },
    from(table) {
      const filters = [];
      let start = 0,
        end = Infinity,
        order,
        options = {},
        columns = '';
      const result = () => {
        calls.push({ table, start, end, order, options, columns, filters: [...filters] });
        if (table === 'workspaces')
          return o.failFirstAccess && accessCalls++ === 0
            ? { data: null, error: { message: 'Access lookup interrupted' } }
            : { data: { id: 'ws-owner' }, error: null };
        if (table === 'workspace_subscription_profiles')
          return {
            data: o.emptyRelational
              ? null
              : { tier: 'Enterprise', billing_state: 'Manual Billing', monthly_rate: 0, payload: {} },
            error: null,
          };
        if (table === 'workspace_profiles')
          return {
            data:
              o.emptyRelational || o.absentProfile
                ? null
                : { payload: o.malformedProfile ? null : workspace.workspaceProfile, updated_at: stamp },
            error: null,
          };
        if (table === supabaseConfig.workspaceTable)
          return {
            data: {
              payload: {
                app: 'XBAR',
                version: 16,
                ...o.snapshotIdentity,
                workspace: { ...workspace, horses: [{ id: 'stale-horse', name: 'Stale snapshot' }] },
              },
              updated_at: stamp,
            },
            error: null,
          };
        const all = tables[table] ?? [];
        if (table === 'horses' && o.throwPage && start > 0) throw new Error('request interrupted');
        if (table === 'horses' && o.failPage && start > 0)
          return { data: null, error: { message: 'page failed' }, count: all.length };
        const offset = table === 'horses' && o.duplicatePage && start > 0 ? 0 : start;
        const data = structuredClone(all.slice(offset, Math.min(offset + (o.cap ?? 1000), offset + end - start + 1)));
        if (table === 'horses' && o.emptyPage && start > 0) data.length = 0;
        const verification =
          calls.filter((call) => call.table === table && call.start === 0 && call.options.count === 'exact').length > 1;
        if (table === 'horses' && verification && data.length) {
          if (o.revisionDrift) data[0].updated_at = '2026-10-05T01:00:00Z';
          if (o.identityDrift) data[0].horse_id = 'replacement-horse';
        }
        if (table === 'shared_listings' && o.sameDayListing && verification && data.length)
          data[0].payload = { ...data[0].payload, state: 'Archived', shareToken: 'rotated-token' };
        const selected = columns.split(',').map((column) => column.trim());
        return {
          data: data.map((row) =>
            Object.fromEntries(selected.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]])),
          ),
          error: null,
          count: o.noCount ? null : all.length + (table === 'horses' && o.countDrift && start > 0 ? 1 : 0),
        };
      };
      const chain = {
        select(v, opts = {}) {
          columns = v;
          options = opts;
          return chain;
        },
        eq(...v) {
          filters.push(v);
          return chain;
        },
        order(...v) {
          order = v;
          return chain;
        },
        range(a, b) {
          start = a;
          end = b;
          return chain;
        },
        limit(v) {
          end = start + v - 1;
          return chain;
        },
        returns() {
          return chain;
        },
        maybeSingle: async () => result(),
        then(resolve, reject) {
          return Promise.resolve().then(result).then(resolve, reject);
        },
      };
      return chain;
    },
    rpc() {
      throw new Error('Read fixture must not mutate');
    },
  });
  return { workspace };
}
test('actual load -> restore -> export reconnects without a false conflict', async () => {
  fixture();
  const r = await loadWorkspaceBackupFromCloud();
  assert.equal(r.ok, true, r.message);
  const local = { workspace: selectPersistedState(restorePersistedState(r.backup.workspace)) };
  assert.equal(decideCloudReconciliation({ local, remote: r.backup }), 'connected');
  local.workspace.horses[0].sale.askPrice = 500;
  assert.equal(decideCloudReconciliation({ local, remote: r.backup }), 'conflict-lock');
});
test('every collection is counted and ordered below a smaller server cap', async () => {
  fixture({ count: 1203, cap: 137 });
  const r = await loadWorkspaceBackupFromCloud();
  assert.equal(r.ok, true, r.message);
  assert.equal(r.backup.workspace.horses.length, 1203);
  for (const [t, id] of Object.entries(ids)) {
    const pages = calls.filter((c) => c.table === t);
    assert.ok(pages.length, t);
    for (const p of pages) {
      assert.equal(p.options.count, 'exact', t);
      assert.equal(p.order[0], id, t);
      assert.equal(p.order[1].ascending, true, t);
      assert.ok(Number.isFinite(p.end));
    }
  }
});
for (const [name, option] of Object.entries({
  pageFailure: 'failPage',
  missingCount: 'noCount',
  duplicatePage: 'duplicatePage',
  changedCount: 'countDrift',
  corruptPayload: 'corruptRow',
  revisionChanged: 'revisionDrift',
  sameCountReplacement: 'identityDrift',
  prematureEmptyPage: 'emptyPage',
  thrownPageFailure: 'throwPage',
  mismatchedIdentity: 'mismatchedPayloadId',
}))
  test(`${name} fails without a truncated import or stale snapshot`, async () => {
    fixture({ count: 1203, cap: 137, [option]: true });
    const r = await loadWorkspaceBackupFromCloud();
    assert.equal(r.ok, false);
    assert.equal(r.backup, undefined);
  });
test('failed first access lookup cannot prove that only a snapshot exists', async () => {
  fixture({ failFirstAccess: true });
  const r = await loadWorkspaceBackupFromCloud();
  assert.equal(r.ok, false);
  assert.equal(
    calls.some((c) => c.table === supabaseConfig.workspaceTable),
    false,
  );
});
for (const failPage of [false, true])
  test(`actual focus refresh above cap ${failPage ? 'preserves local data after page failure' : 'installs last-page teammate edit'}`, async () => {
    const { workspace } = fixture({ count: 1203, cap: 137, failPage });
    const f = await cloudBootstrapFixture((setup) => {
      setup.cloud.session.user.id = 'user-owner';
      setup.cloud.workspaceId = 'ws-owner';
      setup.backup = { workspace: structuredClone(workspace) };
      setup.load = (options) => loadWorkspaceBackupFromCloud(options);
    });
    await f.tick(1600);
    f.calls[0].resolve({ ok: true, message: 'Saved' });
    await f.tick(0);
    const stop = f.startRefresh();
    workspace.horses[1202].name = 'Teammate last-page change';
    f.listeners.focus();
    await f.tick(0);
    await f.tick(1600);
    assert.equal(f.backup.workspace.horses.length, 1203);
    assert.equal(f.backup.workspace.horses[1202].name, failPage ? 'Horse 1202' : 'Teammate last-page change');
    assert.equal(f.calls.length, 1);
    assert.ok(calls.some((c) => c.table === 'horses' && c.start === 137));
    assert.equal(
      calls.some((c) => c.table === supabaseConfig.workspaceTable),
      false,
    );
    stop();
    f.dispose();
  });
for (const variant of [
  'completeProfile',
  'legacyMembership',
  'legacyOwnership',
  'publicTokenless',
  'archivedTokenless',
])
  test(`${variant} stays stable on repeated load/restore/export`, async () => {
    fixture({ [variant]: true });
    const a = await loadWorkspaceBackupFromCloud(),
      b = await loadWorkspaceBackupFromCloud();
    assert.equal(a.ok, true, a.message);
    assert.equal(b.ok, true, b.message);
    const local = { workspace: selectPersistedState(restorePersistedState(a.backup.workspace)) };
    assert.equal(decideCloudReconciliation({ local, remote: b.backup }), 'connected');
    if (variant.includes('Tokenless')) assert.equal(a.backup.workspace.sharedListings[0].shareToken, '');
  });
for (const variant of [
  'legacyListing',
  'malformedProfile',
  'missingMemberDate',
  'missingInvitationDate',
  'payloadlessMembership',
])
  test(`${variant} fails explicitly instead of inventing authority`, async () => {
    fixture({ [variant]: true });
    const r = await loadWorkspaceBackupFromCloud();
    assert.equal(r.ok, false);
    assert.equal(r.backup, undefined);
  });
for (const variant of ['completeProfile', 'legacyOwnership'])
  test(`${variant} agrees for independently normalized raw local and cloud records`, async () => {
    const { workspace } = fixture({ [variant]: true });
    const local = { workspace: selectPersistedState(restorePersistedState(workspace)) };
    const r = await loadWorkspaceBackupFromCloud();
    assert.equal(r.ok, true, r.message);
    local.workspace.subscription = r.backup.workspace.subscription;
    assert.equal(decideCloudReconciliation({ local, remote: r.backup }), 'connected');
  });

test('same-day listing payload changes fail the actual authoritative load without fallback', async () => {
  fixture({ sameDayListing: true });
  const loaded = await loadWorkspaceBackupFromCloud({
    requireAuthoritative: true,
    expectedContext: { userId: 'user-owner', workspaceId: 'ws-owner' },
  });
  assert.equal(loaded.ok, false);
  assert.equal(loaded.backup, undefined);
  assert.match(loaded.message, /changed during loading/);
  assert.equal(
    calls.some((call) => call.table === supabaseConfig.workspaceTable),
    false,
  );
});

const { loadCompleteCloudRows } = await import('../../src/lib/cloudLoadPagination.ts');
for (const [label, changed] of Object.entries({
  state: { payload: { state: 'Archived', shareToken: 'before', channels: ['A', 'B'], unknown: { x: 1 } } },
  token: { payload: { state: 'Live', shareToken: 'rotated', channels: ['A', 'B'], unknown: { x: 1 } } },
  unknownNested: { payload: { state: 'Live', shareToken: 'before', channels: ['A', 'B'], unknown: { x: 2 } } },
  arrayOrder: { payload: { state: 'Live', shareToken: 'before', channels: ['B', 'A'], unknown: { x: 1 } } },
  canonicalRole: { role: 'Owner' },
  canonicalStatus: { status: 'inactive' },
  canonicalEmail: { email: 'changed@example.test' },
})) {
  test(`verification catches ${label} drift despite an unchanged revision`, async () => {
    const row = {
      id: 'row-a',
      updated_at: '2026-10-05',
      role: 'Admin',
      status: 'active',
      email: 'owner@example.test',
      payload: { state: 'Live', shareToken: 'before', channels: ['A', 'B'], unknown: { x: 1 } },
    };
    const result = await loadCompleteCloudRows({
      table: 'fixture',
      idColumn: 'id',
      readPage: async (_from, _to, verify) => ({
        data: [verify ? { ...row, ...changed } : row],
        count: 1,
        error: null,
      }),
    });
    assert.equal(result.data, null);
    assert.match(result.error.message, /changed during loading/);
  });
}
test('verification tolerates equivalent object-key order but keeps array order meaningful', async () => {
  const first = {
    id: 'row-a',
    updated_at: '2026-10-05',
    payload: { name: 'Blue', nested: { a: 1, b: 2 }, array: ['A', 'B'] },
  };
  const second = {
    payload: { array: ['A', 'B'], nested: { b: 2, a: 1 }, name: 'Blue' },
    updated_at: '2026-10-05',
    id: 'row-a',
  };
  const result = await loadCompleteCloudRows({
    table: 'fixture',
    idColumn: 'id',
    readPage: async (_from, _to, verify) => ({ data: [verify ? second : first], count: 1, error: null }),
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, [first]);
});

for (const identity of [
  { cloudWorkspaceId: 'former-ranch', cloudUserId: 'user-owner' },
  { cloudWorkspaceId: 'ws-owner', cloudUserId: 'former-user' },
  {},
]) {
  test(`empty resolved ranch ignores mismatched or unbound recovery identity ${JSON.stringify(identity)}`, async () => {
    fixture({ count: 0, emptyRelational: true, snapshotIdentity: identity });
    const loaded = await loadWorkspaceBackupFromCloud();
    assert.equal(loaded.ok, true, loaded.message);
    assert.equal(loaded.source, 'relational');
    assert.equal(loaded.authoritativeEmpty, true);
    assert.equal(loaded.backup.workspace.horses.length, 0);
    assert.equal(
      calls.some((call) => call.table === supabaseConfig.workspaceTable),
      false,
    );
    assert.equal(loaded.authoritativeSubscription.tier, 'Starter');
  });
}
test('empty authoritative ranch never resurrects a same-ranch recovery snapshot', async () => {
  fixture({
    count: 0,
    emptyRelational: true,
    snapshotIdentity: { cloudWorkspaceId: 'ws-owner', cloudUserId: 'user-owner' },
  });
  const loaded = await loadWorkspaceBackupFromCloud();
  assert.equal(loaded.ok, true, loaded.message);
  assert.equal(loaded.authoritativeEmpty, true);
  assert.equal(loaded.backup.workspace.horses.length, 0);
  assert.equal(
    calls.some((call) => call.table === supabaseConfig.workspaceTable),
    false,
  );
});

test('empty authoritative refresh retains local records without importing or echo-saving a recovery copy', async () => {
  fixture({
    count: 0,
    emptyRelational: true,
    snapshotIdentity: { cloudWorkspaceId: 'ws-owner', cloudUserId: 'user-owner' },
  });
  const local = {
    workspace: { ...createEmptyWorkspaceState(), horses: [{ id: 'local-horse', name: 'Keep locally' }] },
  };
  const f = await cloudBootstrapFixture((setup) => {
    setup.cloud.session.user.id = 'user-owner';
    setup.cloud.workspaceId = 'ws-owner';
    setup.backup = structuredClone(local);
    setup.load = (options) => loadWorkspaceBackupFromCloud(options);
  });
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  f.listeners.focus();
  await f.tick(0);
  await f.tick(1600);
  assert.deepEqual(f.backup, local);
  assert.equal(f.calls.length, 1);
  assert.equal(
    calls.some((call) => call.table === supabaseConfig.workspaceTable),
    false,
  );
  const loaded = await loadWorkspaceBackupFromCloud();
  assert.equal(
    decideCloudReconciliation({ local, remote: loaded.backup, remoteAuthoritativeEmpty: loaded.authoritativeEmpty }),
    'conflict-lock',
  );
  stop();
  f.dispose();
});

for (const emptyMode of ['no-metadata', 'subscription-only', 'blank-profile'])
  for (const hasLocalWork of [false, true]) {
    test(`actual initial hydration (${emptyMode}) of an authoritative empty ranch ${hasLocalWork ? 'locks old local work without saving' : 'allows the first new horse to autosave'}`, async () => {
      fixture({
        count: 0,
        emptyRelational: emptyMode === 'no-metadata',
        absentProfile: emptyMode === 'subscription-only',
      });
      const local = { workspace: createEmptyWorkspaceState() };
      if (hasLocalWork) local.workspace.horses = [{ id: 'old-horse', name: 'Do not resurrect' }];
      const f = await cloudBootstrapFixture((setup) => {
        setup.hydrateFirst = true;
        Object.assign(setup, {
          decideCloudReconciliation,
          hasMeaningfulWorkspace,
          mergeCloudSubscription,
          withCloudSubscription,
        });
        setup.cloud.session.user.id = 'user-owner';
        setup.cloud.workspaceId = 'ws-owner';
        setup.backup = structuredClone(local);
        setup.load = (options) => loadWorkspaceBackupFromCloud(options);
      });
      f.startHydration();
      await f.tick(0);
      assert.equal(f.cloud.autosaveReady, true);
      assert.equal(f.cloud.autosaveUnlocked, !hasLocalWork);
      assert.equal(f.imports ?? 0, 0);
      assert.equal(f.calls.length, 0);
      assert.deepEqual(f.backup.workspace.horses, local.workspace.horses);
      if (!hasLocalWork) {
        const stopRefresh = f.startRefresh();
        f.listeners.focus();
        await f.tick(0);
        assert.equal(f.toasts?.length ?? 0, 0, 'a genuinely empty ranch refresh is healthy');
        stopRefresh();
      }
      f.dispose = f.startAutosave();
      f.backup.workspace.horses.push({ id: 'first-new-horse', name: 'First new horse' });
      f.change?.();
      await f.tick(1600);
      assert.equal(f.calls.length, hasLocalWork ? 0 : 1);
      if (!hasLocalWork) {
        assert.equal(f.calls[0].backup.workspace.horses[0].id, 'first-new-horse');
        f.calls[0].resolve({ ok: true, message: 'Saved' });
        await f.tick(0);
      }
      f.dispose();
    });
  }

test('manual recovery selection reaches the next actual autosave context', async () => {
  const { useCloudStore } = await import('../../src/store/useCloudStore.ts');
  fixture();
  supabaseConfig.relationalSyncEnabled = false;
  const old = { userId: 'user-owner', workspaceId: 'former-ranch', workspaceRole: 'Admin' };
  const chosen = { userId: 'user-owner', workspaceId: 'chosen-ranch', workspaceRole: 'Owner' };
  useCloudStore.setState({
    session: { user: { id: 'user-owner' } },
    autosaveReady: true,
    autosaveUnlocked: true,
    recoveryContext: old,
  });
  const f = await cloudBootstrapFixture((setup) => {
    setup.relational = false;
    setup.cloud.session.user.id = 'user-owner';
    setup.cloud.workspaceId = '';
    Object.defineProperty(setup.cloud, 'recoveryContext', { get: () => useCloudStore.getState().recoveryContext });
  });
  await f.tick(1600);
  assert.deepEqual(f.calls[0].options.expectedRecoveryContext, old);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  useCloudStore.setState({ autosaveUnlocked: false });
  useCloudStore.getState().unlockAutosaveAfterManualSync(chosen);
  assert.equal(useCloudStore.getState().autosaveUnlocked, true);
  f.edit(2);
  await f.tick(1600);
  assert.deepEqual(f.calls[1].options.expectedRecoveryContext, chosen);
  f.calls[1].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  f.dispose();
});

for (const recordsOwner of ['', 'account:former-user', 'former-ranch']) {
  test(`initial promotion refuses unknown or other-account local records: ${recordsOwner || 'unknown'}`, async () => {
    const f = await cloudBootstrapFixture((setup) => {
      setup.hydrateFirst = true;
      Object.assign(setup, {
        decideCloudReconciliation,
        hasMeaningfulWorkspace,
        mergeCloudSubscription,
        withCloudSubscription,
      });
      setup.recordsOwner = recordsOwner;
      setup.vaultOwner = 'account:new-user';
      setup.cloud.session.user.id = 'new-user';
      setup.cloud.workspaceId = '';
      setup.backup = {
        workspace: { ...createEmptyWorkspaceState(), horses: [{ id: 'old-horse', name: 'Prior account horse' }] },
      };
      setup.load = async () => ({ ok: false, message: 'No cloud workspace has been saved for this account yet.' });
    });
    f.startHydration();
    await f.tick(0);
    assert.equal(f.cloud.autosaveUnlocked, false);
    assert.equal(f.calls.length, 0);
    assert.equal(f.backup.workspace.horses[0].id, 'old-horse');
    f.dispose();
  });
}

for (const scenario of [
  'auditEvents',
  'salePacketBuilds',
  'buyerRoomEvents',
  'all-history',
  'different-records-owner',
  'unknown-records-owner',
  'different-remote-ranch',
  'different-remote-account',
  'remote-history-present',
  'snapshot',
  'operational-change',
  'old-owner-id',
  'old-proof-id',
]) {
  test(`initial relational reconnect preserves local history: ${scenario}`, async () => {
    fixture({ completeProfile: true, legacyOwnership: true });
    const remote = await loadWorkspaceBackupFromCloud();
    assert.equal(remote.ok, true, remote.message);
    const local = { workspace: selectPersistedState(restorePersistedState(structuredClone(remote.backup.workspace))) };
    const histories = ['auditEvents', 'salePacketBuilds', 'buyerRoomEvents'];
    for (const key of histories) {
      if (scenario === key || !histories.includes(scenario))
        local.workspace[key] = [{ id: `local-${key}`, at: stamp, actor: 'Owner', summary: 'Device history' }];
    }
    if (scenario === 'operational-change') local.workspace.horses[0].name = 'Unsaved local horse name';
    if (scenario === 'old-owner-id') local.workspace.workspaceMembers[0].id = 'member-old-arbitrary-id';
    if (scenario === 'old-proof-id')
      local.workspace.ownershipRecords[0].proofRequirements[0].id = 'proof-old-arbitrary-id';
    const before = structuredClone(local);
    const returned = structuredClone(remote);
    if (scenario === 'different-remote-ranch') returned.workspaceId = 'other-ranch';
    if (scenario === 'snapshot') returned.source = 'snapshot';
    if (scenario === 'remote-history-present')
      returned.backup.workspace.auditEvents = [{ id: 'remote-audit', summary: 'Remote event' }];
    const f = await cloudBootstrapFixture((setup) => {
      setup.hydrateFirst = true;
      Object.assign(setup, {
        decideCloudReconciliation,
        hasMeaningfulWorkspace,
        mergeCloudSubscription,
        withCloudSubscription,
      });
      setup.cloud.session.user.id = 'user-owner';
      setup.cloud.workspaceId = 'ws-owner';
      setup.vaultOwner = 'ws-owner';
      setup.recordsOwner =
        scenario === 'different-records-owner' ? 'other-ranch' : scenario === 'unknown-records-owner' ? '' : 'ws-owner';
      setup.backup = structuredClone(local);
      setup.load = async () => {
        if (scenario === 'different-remote-account') setup.cloud.session = { user: { id: 'other-user' } };
        return returned;
      };
    });
    f.startHydration();
    await f.tick(0);
    const shouldConnect = histories.includes(scenario) || scenario === 'all-history';
    assert.equal(f.cloud.autosaveReady, scenario !== 'different-remote-account');
    assert.equal(f.cloud.autosaveUnlocked, shouldConnect);
    assert.equal(f.imports ?? 0, 0);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.backup, before, 'reconnect must retain every local history and operational value');
    for (const key of histories)
      if (scenario !== 'remote-history-present' || key !== 'auditEvents')
        assert.deepEqual(returned.backup.workspace[key], [], 'must not fabricate remote history');
    f.dispose = f.startAutosave();
    await f.tick(1600);
    assert.equal(f.calls.length, 0, 'reconnect must not echo-save history');
    if (shouldConnect) {
      f.backup.workspace.horses[0].name = 'Next intended edit';
      f.change();
      await f.tick(1600);
      assert.equal(f.calls.length, 1);
      for (const key of histories) assert.deepEqual(f.calls[0].backup.workspace[key], before.workspace[key]);
      f.calls[0].resolve({ ok: true, message: 'Saved' });
      await f.tick(0);
    }
    f.dispose();
  });
}

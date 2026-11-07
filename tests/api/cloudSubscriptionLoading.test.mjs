import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.endsWith('/supabaseClient') ||
      specifier.endsWith('/supabaseClient.ts') ||
      specifier.endsWith('/supabaseClient.js')
    ) {
      return { url: new URL('./fixtures/cloudSubscriptionClient.mjs', import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { setCloudSubscriptionClient } = await import('./fixtures/cloudSubscriptionClient.mjs');
const { supabaseConfig } = await import('../../src/lib/platformConfig.ts');
const { loadWorkspaceBackupFromCloud, saveWorkspaceBackupToCloud, loadWorkspaceAccessProfile } =
  await import('../../src/lib/cloudWorkspace.ts');
const { createEmptyWorkspaceState } = await import('../../src/store/xbarStoreHelpers.ts');
const { horseCreationGate, profitIntelligenceGate } = await import('../../src/lib/subscriptionGates.ts');
const { decideCloudReconciliation } = await import('../../src/lib/cloudSyncPolicy.ts');
const { withCloudSubscription } = await import('../../src/lib/cloudSubscription.ts');

const ownerGrant = {
  tier: 'Enterprise',
  billing_state: 'Manual Billing',
  monthly_rate: 0,
  billing_period: null,
  payload: {},
};
const snapshot = () => ({
  cloudUserId: 'user-owner',
  cloudWorkspaceId: 'ws-owner',
  app: 'XBAR',
  version: 16,
  workspace: {
    ...createEmptyWorkspaceState(),
    horses: Array.from({ length: 5 }, (_, i) => ({ id: `horse-${i}`, name: `Horse ${i}` })),
    documents: [{ id: 'doc-preserve', fileName: 'Owner paper.pdf' }],
    workspaceProfile: {
      ...createEmptyWorkspaceState().workspaceProfile,
      ranchName: 'Owner Ranch',
      setupCompleteAt: '2026-10-01T00:00:00Z',
    },
  },
});
let calls;
function fixture({
  row = ownerGrant,
  subscriptionError = false,
  relational = false,
  snapshotFallback = true,
  snapshotError = false,
  pendingInvitation = false,
  ownerId = 'ws-owner',
  accessError = false,
  data = snapshot(),
  sessionAppMetadata = {},
  sessionUserMetadata = {},
  switchUserOnSnapshot = false,
  switchRanchOnSnapshot = false,
} = {}) {
  calls = [];
  let activeUserId = 'user-owner';
  let activeOwnerId = ownerId;
  supabaseConfig.url = 'http://127.0.0.1:4179';
  supabaseConfig.anonKey = 'owner-entitlement-test-key';
  supabaseConfig.relationalSyncEnabled = relational;
  supabaseConfig.snapshotFallbackEnabled = snapshotFallback;
  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: {
              id: activeUserId,
              email: 'owner@example.test',
              app_metadata: sessionAppMetadata,
              user_metadata: sessionUserMetadata,
            },
          },
        },
        error: null,
      }),
    },
    from(table) {
      const filters = [];
      const result = () => {
        calls.push({ table, filters });
        if (table === 'workspaces')
          return {
            data: activeOwnerId ? { id: activeOwnerId } : null,
            error: accessError ? { message: 'identity unavailable' } : null,
          };
        if (table === 'workspace_invitations' && pendingInvitation)
          return { data: { workspace_id: 'unrequested-ranch', invitation_id: 'unexpected-invite' }, error: null };
        if (table === 'workspace_memberships') return { data: relational ? [] : null, error: null, count: 0 };
        if (table === 'workspace_subscription_profiles')
          return { data: row, error: subscriptionError ? { message: 'subscription unavailable' } : null };
        if (table === supabaseConfig.workspaceTable) {
          if (switchUserOnSnapshot) activeUserId = 'replacement-user';
          if (switchRanchOnSnapshot) activeOwnerId = 'replacement-ranch';
          return {
            data: { payload: data, updated_at: '2026-10-02T21:36:00Z' },
            error: snapshotError ? { message: 'snapshot unavailable' } : null,
          };
        }
        // Force a relational read failure while preserving the snapshot fallback.
        return { data: null, error: relational ? { message: 'relational records unavailable' } : null };
      };
      const chain = {
        select() {
          return chain;
        },
        eq(...args) {
          filters.push(args);
          return chain;
        },
        limit() {
          return chain;
        },
        order() {
          return chain;
        },
        range() {
          return chain;
        },
        returns() {
          return chain;
        },
        maybeSingle: async () => result(),
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return chain;
    },
    rpc() {
      throw new Error('An entitlement read must not accept an invitation or mutate anything');
    },
  };
  setCloudSubscriptionClient(client);
  return data;
}
beforeEach(() => fixture());

for (const relational of [false, true]) {
  test(`${relational ? 'failed relational reads fail closed while preserving' : 'snapshot-only mode restores'} the $0 owner grant, six-horse capacity and reports`, async () => {
    const original = fixture({ relational });
    const before = structuredClone(original);
    assert.ok(horseCreationGate(original.workspace.subscription, 5));
    assert.ok(profitIntelligenceGate(original.workspace.subscription));
    const loaded = await loadWorkspaceBackupFromCloud();
    if (relational) {
      assert.equal(loaded.ok, false);
      assert.equal(loaded.backup, undefined);
      assert.equal(loaded.authoritativeSubscription.tier, 'Enterprise');
      assert.equal(loaded.authoritativeSubscription.monthlyRate, 0);
      assert.equal(horseCreationGate(loaded.authoritativeSubscription, 5), null);
      assert.equal(profitIntelligenceGate(loaded.authoritativeSubscription), null);
      assert.equal(
        calls.some((c) => c.table === supabaseConfig.workspaceTable),
        false,
      );
      assert.deepEqual(original, before);
      return;
    }
    assert.equal(loaded.ok, true);
    assert.equal(loaded.backup.workspace.subscription.tier, 'Enterprise');
    assert.equal(loaded.backup.workspace.subscription.monthlyRate, 0);
    assert.equal(loaded.backup.workspace.subscription.billingState, 'Manual Billing');
    assert.equal(horseCreationGate(loaded.backup.workspace.subscription, 5), null);
    assert.equal(profitIntelligenceGate(loaded.backup.workspace.subscription), null);
    assert.deepEqual(loaded.backup.workspace.horses, before.workspace.horses);
    assert.deepEqual(loaded.backup.workspace.documents, before.workspace.documents);
    assert.deepEqual(original, before, 'loading must not edit or write the saved snapshot');
    assert.ok(
      calls.some(
        (c) =>
          c.table === 'workspace_subscription_profiles' &&
          c.filters.some((f) => f[0] === 'workspace_id' && f[1] === 'ws-owner'),
      ),
    );
  });
}

test('canonical cancellation defeats a stale Enterprise snapshot', async () => {
  const stale = snapshot();
  stale.workspace.subscription.tier = 'Enterprise';
  stale.workspace.subscription.billingState = 'Active';
  fixture({ data: stale, row: { tier: 'Enterprise', billing_state: 'Inactive', monthly_rate: 199, payload: {} } });
  const loaded = await loadWorkspaceBackupFromCloud();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.authoritativeSubscription.tier, 'Starter');
  assert.ok(horseCreationGate(loaded.authoritativeSubscription, 5));
  assert.ok(profitIntelligenceGate(loaded.authoritativeSubscription));
});

test('an unreadable canonical subscription does not return an apparently authorized snapshot', async () => {
  fixture({ subscriptionError: true });
  const loaded = await loadWorkspaceBackupFromCloud();
  assert.equal(loaded.ok, false);
  assert.equal(loaded.backup, undefined);
  assert.match(loaded.message, /subscription unavailable/);
});

test('a genuinely missing canonical row cannot inherit privileges from a snapshot', async () => {
  const stale = snapshot();
  stale.workspace.subscription.tier = 'Enterprise';
  fixture({ row: null, data: stale });
  const loaded = await loadWorkspaceBackupFromCloud();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.authoritativeSubscription.tier, 'Starter');
  assert.equal(loaded.authoritativeSubscription.monthlyRate, 0);
});

test('an unresolved workspace refuses rather than guessing another workspace entitlement', async () => {
  fixture({ ownerId: null, accessError: true });
  const loaded = await loadWorkspaceBackupFromCloud();
  assert.equal(loaded.ok, false);
  assert.equal(calls.filter((c) => c.table === 'workspace_subscription_profiles').length, 0);
  assert.equal(calls.filter((c) => c.table === 'workspace_invitations').length, 0);
});

test('an entitlement-only change does not create a record conflict, but real record differences remain locked', async () => {
  const local = fixture();
  const loaded = await loadWorkspaceBackupFromCloud();
  assert.equal(loaded.ok, true);
  const reconciled = withCloudSubscription(local, loaded.authoritativeSubscription);
  assert.equal(decideCloudReconciliation({ local: reconciled, remote: loaded.backup }), 'connected');
  const edited = {
    ...reconciled,
    workspace: { ...reconciled.workspace, horses: [...reconciled.workspace.horses, { id: 'local-unsaved' }] },
  };
  assert.equal(decideCloudReconciliation({ local: edited, remote: loaded.backup }), 'conflict-lock');
  assert.equal(edited.workspace.horses.length, 6);
});

test('a legacy snapshot with no relational workspace still loads its records at baseline', async () => {
  const legacy = snapshot();
  delete legacy.cloudWorkspaceId;
  delete legacy.cloudUserId;
  const original = fixture({ ownerId: null, data: legacy });
  const loaded = await loadWorkspaceBackupFromCloud();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.authoritativeSubscription.tier, 'Starter');
  assert.deepEqual(loaded.backup.workspace.horses, original.workspace.horses);
  assert.deepEqual(loaded.backup.workspace.documents, original.workspace.documents);
  assert.equal(calls.filter((c) => c.table === 'workspace_invitations').length, 0);
});

test('canonical limits replace snapshot caps without zeroing current usage counters', async () => {
  const local = snapshot();
  Object.assign(local.workspace.subscription.usage, {
    horsesUsed: 5,
    documentsProcessed: 23,
    salePacketsGenerated: 9,
    storageUsedGb: 17,
    seatsUsed: 1,
    sharedAccessSeatsUsed: 2,
    horseLimit: 99999,
  });
  fixture({ data: local });
  const loaded = await loadWorkspaceBackupFromCloud();
  assert.equal(loaded.ok, true);
  const usage = loaded.backup.workspace.subscription.usage;
  assert.equal(usage.horseLimit, 2000);
  assert.equal(usage.horsesUsed, 5);
  assert.equal(usage.documentsProcessed, 23);
  assert.equal(usage.salePacketsGenerated, 9);
  assert.equal(usage.storageUsedGb, 17);
  assert.equal(usage.sharedAccessSeatsUsed, 2);
});

for (const config of [
  { relational: true, data: null },
  { relational: true, snapshotFallback: false },
  { snapshotError: true },
]) {
  test(`canonical entitlements survive independently unavailable ranch records: ${JSON.stringify(config)}`, async () => {
    fixture(config);
    const loaded = await loadWorkspaceBackupFromCloud();
    assert.equal(loaded.ok, false, 'record loading must still honestly fail');
    assert.equal(loaded.backup, undefined, 'never substitute invented ranch records');
    assert.equal(loaded.authoritativeSubscription?.tier, 'Enterprise');
    assert.equal(loaded.authoritativeSubscription?.monthlyRate, 0);
    assert.equal(profitIntelligenceGate(loaded.authoritativeSubscription), null);
    assert.equal(
      decideCloudReconciliation({ local: snapshot(), remoteError: loaded.message }),
      'error-lock',
      'unavailable records must not be treated as an empty ranch and automatically overwritten',
    );
  });
}

test('cancellation is authoritative even when no fallback snapshot exists', async () => {
  fixture({ relational: true, data: null, row: { tier: 'Enterprise', billing_state: 'Inactive', monthly_rate: 199 } });
  const loaded = await loadWorkspaceBackupFromCloud();
  assert.equal(loaded.ok, false);
  assert.equal(loaded.authoritativeSubscription?.tier, 'Starter');
  assert.ok(profitIntelligenceGate(loaded.authoritativeSubscription));
});

test('autosave refuses a session resolved for a different account before any cloud write', async () => {
  const data = fixture({ relational: true });
  const result = await saveWorkspaceBackupToCloud(data, {
    expectedContext: { userId: 'previous-account', workspaceId: 'ws-owner' },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /account changed/);
  assert.deepEqual(calls, []);
});

test('autosave refuses a different resolved ranch before bootstrap, profile or fallback writes', async () => {
  const data = fixture({ relational: true, ownerId: 'new-ranch' });
  const result = await saveWorkspaceBackupToCloud(data, {
    expectedContext: { userId: 'user-owner', workspaceId: 'previous-ranch' },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /active ranch changed/);
  assert.deepEqual(
    calls.map((call) => call.table),
    ['workspaces'],
  );
});

test('authoritative live refresh never substitutes a device recovery snapshot for failed relational reads', async () => {
  fixture({ relational: true });
  const result = await loadWorkspaceBackupFromCloud({
    requireAuthoritative: true,
    expectedContext: { userId: 'user-owner', workspaceId: 'ws-owner' },
  });
  assert.equal(result.ok, false);
  assert.equal(
    calls.some((call) => call.table === supabaseConfig.workspaceTable),
    false,
  );
});

test('live refresh rejects an account mismatch without querying any records', async () => {
  fixture({ relational: true });
  const result = await loadWorkspaceBackupFromCloud({
    requireAuthoritative: true,
    expectedContext: { userId: 'previous-account', workspaceId: 'ws-owner' },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, []);
});

test('live refresh rejects a changed primary ranch without returning its records or a snapshot', async () => {
  fixture({ relational: true, ownerId: 'different-ranch' });
  const result = await loadWorkspaceBackupFromCloud({
    requireAuthoritative: true,
    expectedContext: { userId: 'user-owner', workspaceId: 'ws-owner' },
  });
  assert.equal(result.ok, false);
  assert.equal(
    calls.some((call) => call.table === 'horses' || call.table === supabaseConfig.workspaceTable),
    false,
  );
});

test('authoritative record refresh never accepts a pending invitation as a read side effect', async () => {
  fixture({ relational: true, ownerId: null, pendingInvitation: true });
  const loaded = await loadWorkspaceBackupFromCloud({
    requireAuthoritative: true,
    expectedContext: { userId: 'user-owner', workspaceId: 'existing-ranch' },
  });
  assert.equal(loaded.ok, false);
  assert.equal(
    calls.some((call) => call.table === 'workspace_invitations'),
    false,
  );
});

for (const identity of [
  { cloudWorkspaceId: 'former-ranch', cloudUserId: 'user-owner' },
  { cloudWorkspaceId: 'ws-owner', cloudUserId: 'former-user' },
  { cloudWorkspaceId: undefined, cloudUserId: undefined },
]) {
  test(`snapshot-only load refuses wrong or unbound recovery identity ${JSON.stringify(identity)}`, async () => {
    fixture({ data: { ...snapshot(), ...identity } });
    const loaded = await loadWorkspaceBackupFromCloud();
    assert.equal(loaded.ok, false);
    assert.match(loaded.message, /cannot be verified/);
    assert.equal(loaded.authoritativeSubscription.tier, 'Enterprise');
  });
}

for (const change of ['switchUserOnSnapshot', 'switchRanchOnSnapshot']) {
  test(`recovery context is rechecked after snapshot read: ${change}`, async () => {
    fixture({ [change]: true });
    const loaded = await loadWorkspaceBackupFromCloud();
    assert.equal(loaded.ok, false);
    assert.match(loaded.message, /changed while loading/);
    assert.equal(loaded.backup, undefined);
    assert.equal(loaded.authoritativeSubscription, undefined);
    assert.equal(decideCloudReconciliation({ local: snapshot(), remoteError: loaded.message }), 'error-lock');
  });
}
test('a bound former-ranch snapshot cannot become an unbound legacy account recovery', async () => {
  fixture({ ownerId: null });
  const loaded = await loadWorkspaceBackupFromCloud();
  assert.equal(loaded.ok, false);
  assert.match(loaded.message, /cannot be verified/);
});

test('account switch is rejected before a mismatched snapshot can return old entitlements', async () => {
  fixture({ switchUserOnSnapshot: true, data: { ...snapshot(), cloudWorkspaceId: 'former-ranch' } });
  const result = await loadWorkspaceBackupFromCloud();
  assert.equal(result.ok, false);
  assert.equal(result.authoritativeSubscription, undefined);
  assert.match(result.message, /changed while loading/);
});

for (const unavailable of [{ data: null }, { snapshotError: true }]) {
  test(`account switch with unavailable recovery never returns old entitlements ${JSON.stringify(unavailable)}`, async () => {
    fixture({ switchUserOnSnapshot: true, ...unavailable });
    const result = await loadWorkspaceBackupFromCloud();
    assert.equal(result.ok, false);
    assert.equal(result.authoritativeSubscription, undefined);
    assert.match(result.message, /changed while loading/);
  });
}

for (const metadata of [{}, { role: 'Admin', workspace_role: 'Admin' }]) {
  test(`unverified snapshot-only identity has no local capabilities from editable metadata ${JSON.stringify(metadata)}`, async () => {
    fixture({ ownerId: null, sessionUserMetadata: metadata });
    const access = await loadWorkspaceAccessProfile();
    assert.equal(access.workspaceId, null);
    assert.equal(access.workspaceRole, 'Pending access');
  });
}
for (const role of ['Owner', 'Medical Lead', 'Sales Lead']) {
  test(`trusted application role remains compatible without a ranch: ${role}`, async () => {
    fixture({ ownerId: null, sessionAppMetadata: { workspace_role: role }, sessionUserMetadata: { role: 'Admin' } });
    const access = await loadWorkspaceAccessProfile();
    assert.equal(access.workspaceId, null);
    assert.equal(access.workspaceRole, role);
  });
}

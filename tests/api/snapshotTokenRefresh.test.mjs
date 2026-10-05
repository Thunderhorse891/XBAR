import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
registerHooks({
  resolve(specifier, context, next) {
    if (/\/supabaseClient(?:\.[tj]s)?$/.test(specifier))
      return { url: `file://${root}/tests/api/fixtures/cloudSubscriptionClient.mjs`, shortCircuit: true };
    return next(specifier, context);
  },
});
const { setCloudSubscriptionClient } = await import(`${root}/tests/api/fixtures/cloudSubscriptionClient.mjs`);
const { supabaseConfig } = await import(`${root}/src/lib/platformConfig.ts`);
const { loadWorkspaceBackupFromCloud, saveWorkspaceBackupToCloud } = await import(`${root}/src/lib/cloudWorkspace.ts`);
const { createEmptyWorkspaceState } = await import(`${root}/src/store/xbarStoreHelpers.ts`);
const original = { user: { id: 'user-a', email: 'user@example.test' } };
function fixture(o = {}) {
  let role = o.memberRole ?? 'Admin',
    user = 'user-a',
    calls = [];
  Object.assign(supabaseConfig, {
    url: 'https://synthetic.example.test',
    anonKey: 'test',
    relationalSyncEnabled: o.relational ?? false,
    snapshotFallbackEnabled: true,
  });
  const local = {
    app: 'XBAR',
    version: 16,
    workspace: { ...createEmptyWorkspaceState(), horses: [{ id: 'old-horse', name: 'Deleted horse' }] },
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: user, email: 'user@example.test' } } }, error: null }),
    },
    from(table) {
      let method = 'read',
        values;
      const result = () => {
        calls.push({ table, method, values });
        if (method === 'upsert') return { data: values, error: null };
        if (table === 'workspaces' && o.accessError) return { data: null, error: { message: 'access unavailable' } };
        if (table === 'workspaces') return { data: o.member || o.noRanch ? null : { id: 'ranch-a' }, error: null };
        if (table === 'workspace_memberships' && o.noRanch) return { data: null, error: null };
        if (table === 'workspace_memberships' && o.member)
          return { data: { workspace_id: 'ranch-a', role }, error: null };
        if (table === 'workspace_subscription_profiles')
          return {
            data: { tier: 'Enterprise', billing_state: 'Manual Billing', monthly_rate: 0, payload: {} },
            error: null,
          };
        if (table === 'workspace_profiles')
          return { data: o.profile ? { payload: createEmptyWorkspaceState().workspaceProfile } : null, error: null };
        if (table === supabaseConfig.workspaceTable) {
          if (o.changeUser) user = 'replacement-user';
          if (o.changeRole) role = 'Owner';
          return {
            data: {
              payload: { ...local, cloudUserId: 'user-a', cloudWorkspaceId: 'ranch-a', ...o.identity },
              updated_at: '2026-10-05T00:00:00Z',
            },
            error: null,
          };
        }
        return { data: [], error: null, count: 0 };
      };
      const chain = {
        select() {
          return chain;
        },
        eq() {
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
        upsert(v) {
          method = 'upsert';
          values = v;
          return chain;
        },
        maybeSingle: async () => result(),
        then(resolve, reject) {
          return Promise.resolve().then(result).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  setCloudSubscriptionClient(client);
  return { local, calls, client };
}

test('snapshot owner remains authorized after an actual same-account token refresh', async () => {
  const f = fixture();
  let emit;
  const session = { ...original, access_token: 'fixture-access-token' };
  f.client.auth.getSession = async () => ({ data: { session }, error: null });
  f.client.auth.onAuthStateChange = (fn) => {
    emit = fn;
    return { data: { subscription: { unsubscribe() {} } } };
  };
  const { useCloudStore } = await import(`${root}/src/store/useCloudStore.ts`);
  const { authStorageAdapter } = await import(`${root}/src/lib/authStorage.ts`);
  useCloudStore.setState({ initialized: false, session: null, workspaceRole: 'Pending access', workspaceId: '' });
  const cleanup = await useCloudStore.getState().initialize();
  try {
    const loaded = await loadWorkspaceBackupFromCloud();
    assert.equal(loaded.ok, true, loaded.message);
    useCloudStore.getState().setRecoveryContext(loaded.recoveryContext);
    assert.equal(useCloudStore.getState().workspaceRole, 'Admin');
    authStorageAdapter.setItem('synthetic-owner-entitlement-session', JSON.stringify(session));
    const readsBefore = f.calls.length;
    emit('TOKEN_REFRESHED', session);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(useCloudStore.getState().workspaceRole, 'Admin');
    assert.ok(f.calls.length > readsBefore, 'token refresh must actually resolve access');
    assert.equal(useCloudStore.getState().workspaceId, '');
  } finally {
    cleanup?.();
  }
});

for (const mode of ['demotion', 'lost membership', 'lookup failure'])
  test(`snapshot token refresh applies ${mode} and refuses stale autosave context`, async () => {
    const options = { memberRole: 'Medical Lead' };
    const f = fixture(options);
    let emit;
    const session = { ...original, access_token: 'fixture-access-token' };
    f.client.auth.getSession = async () => ({ data: { session }, error: null });
    f.client.auth.onAuthStateChange = (fn) => {
      emit = fn;
      return { data: { subscription: { unsubscribe() {} } } };
    };
    const { useCloudStore } = await import(`${root}/src/store/useCloudStore.ts`);
    const { authStorageAdapter } = await import(`${root}/src/lib/authStorage.ts`);
    useCloudStore.setState({
      initialized: false,
      session: null,
      workspaceRole: 'Pending access',
      workspaceId: '',
      recoveryContext: undefined,
    });
    const cleanup = await useCloudStore.getState().initialize();
    try {
      const loaded = await loadWorkspaceBackupFromCloud();
      assert.equal(loaded.ok, true, loaded.message);
      useCloudStore.getState().setRecoveryContext(loaded.recoveryContext);
      assert.equal(useCloudStore.getState().workspaceRole, 'Admin');
      if (mode === 'demotion') options.member = true;
      else if (mode === 'lost membership') options.noRanch = true;
      else options.accessError = true;
      authStorageAdapter.setItem('synthetic-owner-entitlement-session', JSON.stringify(session));
      emit('TOKEN_REFRESHED', session);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(useCloudStore.getState().workspaceRole, mode === 'demotion' ? 'Medical Lead' : 'Pending access');
      assert.equal(useCloudStore.getState().workspaceId, '');
      const saved = await saveWorkspaceBackupToCloud(f.local, {
        expectedContext: { userId: 'user-a', workspaceId: '' },
        expectedRecoveryContext: loaded.recoveryContext,
      });
      assert.equal(saved.ok, false);
      assert.equal(
        f.calls.some((c) => c.method !== 'read'),
        false,
      );
    } finally {
      cleanup?.();
    }
  });

import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    if (/\/supabaseClient(?:\.ts|\.js)?$/.test(specifier))
      return { url: new URL('./fixtures/cloudSubscriptionClient.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const { setCloudSubscriptionClient } = await import('./fixtures/cloudSubscriptionClient.mjs');
const { supabaseConfig } = await import('../../src/lib/platformConfig.ts');
const { saveWorkspaceBackupToCloud, loadWorkspaceAccessProfile } = await import('../../src/lib/cloudWorkspace.ts');

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const horse = { id: 'horse-a', name: 'Blue', sale: { askPrice: 10000 }, medicalTimeline: [] };
const profile = { ranchName: 'Ranch', businessName: 'Old business' };
const backup = () => ({
  app: 'XBAR',
  version: 16,
  workspace: { horses: [clone(horse)], workspaceProfile: clone(profile) },
});
const ids = {
  horses: 'horse_id',
  documents: 'document_id',
  intake_batches: 'intake_batch_id',
  ownership_records: 'ownership_record_id',
  expense_receipts: 'receipt_id',
  ranch_assets: 'asset_id',
  sales_leads: 'lead_id',
  shared_listings: 'listing_id',
  workspace_profiles: 'workspace_id',
  workspaces: 'id',
};
function fixture(remote = {}, beforeUpdate, controls = {}) {
  const data = new Map(
    Object.entries({
      workspaces: [{ id: 'ranch-a', owner_user_id: 'user-a', workspace_key: 'primary' }],
      horses: [
        {
          workspace_id: 'ranch-a',
          horse_id: 'horse-a',
          payload: clone(horse),
          updated_at: '2026-10-01T00:00:00Z',
        },
      ],
      workspace_profiles: [{ workspace_id: 'ranch-a', payload: clone(profile), updated_at: '2026-10-01T00:00:00Z' }],
      ...remote,
    }),
  );
  const calls = [];
  supabaseConfig.url = 'https://synthetic.example.test';
  supabaseConfig.anonKey = 'synthetic-key';
  supabaseConfig.relationalSyncEnabled = true;
  supabaseConfig.snapshotFallbackEnabled = true;
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'user-a', email: 'user@example.test' } } },
        error: null,
      }),
    },
    from(table) {
      let action = 'read',
        values,
        filters = [],
        single = false,
        columns = '*',
        queryOptions = {},
        first = 0,
        last = Infinity,
        orderColumn;
      const matches = (row) =>
        filters.every(([key, value]) =>
          key === 'payload'
            ? JSON.stringify(row[key]) === value
            : Array.isArray(value)
              ? value.includes(row[key])
              : row[key] === value,
        );
      const execute = () => {
        calls.push({ table, action, values: clone(values), filters });
        const rows = data.get(table) ?? [];
        const injected = controls.beforeWrite?.({ table, action, values, rows, client, first, last, queryOptions });
        if (injected) return injected;
        if (action === 'update') beforeUpdate?.(table, rows);
        let selected = rows.filter(matches);
        if (action === 'upsert' || action === 'insert') {
          selected = [];
          for (const value of Array.isArray(values) ? values : [values]) {
            const key = ids[table] ?? 'email';
            const found = rows.find((row) => row[key] === value[key]);
            if (found && action === 'insert') return { data: null, error: { message: 'duplicate' } };
            if (found) Object.assign(found, value);
            else rows.push({ ...value, id: value.id ?? 'ranch-a' });
            selected.push(found ?? rows.at(-1));
          }
          data.set(table, rows);
        }
        if (action === 'update') for (const row of selected) Object.assign(row, values);
        if (action === 'delete')
          data.set(
            table,
            rows.filter((row) => !matches(row)),
          );
        const count = selected.length;
        if (action === 'read') {
          if (orderColumn)
            selected = [...selected].sort((a, b) => String(a[orderColumn]).localeCompare(String(b[orderColumn])));
          selected = selected.slice(first, Math.min(last + 1, first + (controls.readCap ?? Infinity)));
        }
        if (columns !== '*')
          selected = selected.map((row) =>
            Object.fromEntries(
              columns
                .split(',')
                .map((key) => key.trim())
                .filter((key) => Object.hasOwn(row, key))
                .map((key) => [key, row[key]]),
            ),
          );
        const result = {
          data: single ? (selected[0] ?? null) : selected,
          error: null,
          ...(queryOptions.count === 'exact' ? { count } : {}),
        };
        return controls.afterResult?.({ table, action, values, result, client }) ?? result;
      };
      const chain = {
        select(value = '*', opts = {}) {
          columns = value;
          queryOptions = opts;
          return chain;
        },
        eq(k, v) {
          filters.push([k, v]);
          return chain;
        },
        in(key, values) {
          filters.push([key, values]);
          return chain;
        },
        limit() {
          return chain;
        },
        order(column) {
          orderColumn = column;
          return chain;
        },
        range(from, to) {
          first = from;
          last = to;
          return chain;
        },
        upsert(v) {
          action = 'upsert';
          values = v;
          return chain;
        },
        insert(v) {
          action = 'insert';
          values = v;
          return chain;
        },
        update(v) {
          action = 'update';
          values = v;
          return chain;
        },
        delete() {
          action = 'delete';
          return chain;
        },
        returns() {
          return chain;
        },
        single() {
          single = true;
          return Promise.resolve(execute());
        },
        maybeSingle() {
          single = true;
          return Promise.resolve(execute());
        },
        then(resolve, reject) {
          return Promise.resolve(execute()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  setCloudSubscriptionClient(client);
  return { data, calls, client };
}

test('a stale price-only save preserves a teammate vaccination on the same horse', async () => {
  const vaccination = { id: 'medical-1', type: 'Vaccination', notes: 'Rabies' };
  const f = fixture({
    horses: [
      {
        workspace_id: 'ranch-a',
        horse_id: 'horse-a',
        payload: { ...horse, medicalTimeline: [vaccination] },
        updated_at: '2026-10-02T00:00:00Z',
      },
    ],
  });
  const baseline = backup(),
    current = backup();
  current.workspace.horses[0].sale.askPrice = 15000;
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(f.data.get('horses')[0].payload.medicalTimeline, [vaccination]);
  assert.equal(f.data.get('horses')[0].payload.sale.askPrice, 15000);
});

test('unrelated saves never rewrite an unchanged stale ranch profile', async () => {
  const f = fixture({
    workspace_profiles: [
      {
        workspace_id: 'ranch-a',
        payload: { ...profile, businessName: 'New business' },
        updated_at: '2026-10-02T00:00:00Z',
      },
    ],
  });
  const baseline = backup(),
    current = backup();
  current.workspace.horses[0].sale.askPrice = 15000;
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, true, result.message);
  assert.equal(f.data.get('workspace_profiles')[0].payload.businessName, 'New business');
  assert.equal(f.calls.filter((c) => c.table === 'workspace_profiles' && c.action !== 'read').length, 0);
});

test('competing price changes are explicit conflicts, never overwrite or fallback success', async () => {
  const f = fixture({
    horses: [
      {
        workspace_id: 'ranch-a',
        horse_id: 'horse-a',
        payload: { ...horse, sale: { askPrice: 12000 } },
        updated_at: '2026-10-02T00:00:00Z',
      },
    ],
  });
  const baseline = backup(),
    current = backup();
  current.workspace.horses[0].sale.askPrice = 15000;
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, false);
  assert.match(result.message, /conflict/i);
  assert.equal(f.data.get('horses')[0].payload.sale.askPrice, 12000);
  assert.equal(f.calls.filter((c) => c.table === supabaseConfig.workspaceTable && c.action !== 'read').length, 0);
});

test('a row changed between merge-read and update refuses zero-row success', async () => {
  let changed = false;
  const f = fixture({}, (table, rows) => {
    if (table === 'horses' && !changed) {
      changed = true;
      rows[0].updated_at = '2026-10-03T00:00:00Z';
      rows[0].payload = { ...horse, sale: { askPrice: 13000 } };
    }
  });
  const baseline = backup(),
    current = backup();
  current.workspace.horses[0].sale.askPrice = 15000;
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, false);
  assert.match(result.message, /conflict/i);
  assert.equal(f.data.get('horses')[0].payload.sale.askPrice, 13000);
});

test('nonoverlapping profile edits preserve the teammate business name', async () => {
  const f = fixture({
    workspace_profiles: [
      {
        workspace_id: 'ranch-a',
        payload: { ...profile, businessName: 'New business' },
        updated_at: '2026-10-02T00:00:00Z',
      },
    ],
  });
  const baseline = backup(),
    current = backup();
  current.workspace.workspaceProfile.ranchName = 'New ranch';
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, true, result.message);
  assert.equal(f.data.get('workspace_profiles')[0].payload.businessName, 'New business');
  assert.equal(f.data.get('workspace_profiles')[0].payload.ranchName, 'New ranch');
  assert.equal(f.data.get('workspace_profiles')[0].business_name, 'New business');
});

test('existing row deletion never silently recreates the removed horse', async () => {
  const f = fixture({ horses: [] });
  const baseline = backup(),
    current = backup();
  current.workspace.horses[0].sale.askPrice = 15000;
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, false);
  assert.match(result.message, /removed/);
  assert.deepEqual(f.data.get('horses'), []);
});

test('an unchanged revision cannot conceal a concurrent payload write', async () => {
  let changed = false;
  const f = fixture({}, (table, rows) => {
    if (table === 'horses' && !changed) {
      changed = true;
      rows[0].payload = { ...horse, sale: { askPrice: 13000 } };
    }
  });
  const baseline = backup(),
    current = backup();
  current.workspace.horses[0].sale.askPrice = 15000;
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, false);
  assert.match(result.message, /conflict/i);
  assert.equal(f.data.get('horses')[0].payload.sale.askPrice, 13000);
});

test('a specialist save never writes the administrator profile', async () => {
  const f = fixture({
    workspaces: [],
    workspace_memberships: [{ workspace_id: 'ranch-a', user_id: 'user-a', role: 'Medical Lead', status: 'active' }],
  });
  const baseline = backup(),
    current = backup();
  current.workspace.horses[0].medicalTimeline = [{ id: 'care-1', notes: 'Care administered' }];
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, true, result.message);
  assert.equal(f.calls.filter((c) => c.table === 'workspace_profiles').length, 0);
  assert.equal(f.data.get('horses')[0].payload.medicalTimeline.length, 1);
});

test('an ordinary deletion refuses a horse edited after this device last loaded it', async () => {
  const f = fixture({
    horses: [
      {
        workspace_id: 'ranch-a',
        horse_id: 'horse-a',
        payload: { ...horse, medicalTimeline: [{ id: 'new-care' }] },
        updated_at: '2026-10-02T00:00:00Z',
      },
    ],
  });
  const baseline = backup(),
    current = backup();
  current.workspace.horses = [];
  const result = await saveWorkspaceBackupToCloud(current, {
    baseline,
    deletions: [{ table: 'horses', id: 'horse-a' }],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /conflict/i);
  assert.equal(f.data.get('horses').length, 1);
});

test('an acknowledged unchanged horse deletion removes exactly the requested row', async () => {
  const f = fixture();
  const baseline = backup(),
    current = backup();
  current.workspace.horses = [];
  const result = await saveWorkspaceBackupToCloud(current, {
    baseline,
    deletions: [{ table: 'horses', id: 'horse-a' }],
  });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(f.data.get('horses'), []);
});

test('unrelated edits preserve an explicitly null canonical field', async () => {
  const baseline = backup(),
    current = backup();
  baseline.workspace.expenseReceipts = [{ id: 'receipt-a', horseId: 'horse-a', amount: 20, title: 'Care' }];
  current.workspace.expenseReceipts = [{ ...baseline.workspace.expenseReceipts[0], amount: 25 }];
  const f = fixture({
    expense_receipts: [
      {
        workspace_id: 'ranch-a',
        receipt_id: 'receipt-a',
        horse_id: null,
        payload: baseline.workspace.expenseReceipts[0],
        updated_at: '2026-10-01T00:00:00Z',
      },
    ],
  });
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, true, result.message);
  assert.equal(f.data.get('expense_receipts')[0].horse_id, null);
});

test('the device recovery snapshot preserves merged fields and is bound to its account and ranch', async () => {
  const vaccination = { id: 'medical-1', notes: 'Vaccination' };
  const f = fixture({
    horses: [
      {
        workspace_id: 'ranch-a',
        horse_id: 'horse-a',
        payload: { ...horse, medicalTimeline: [vaccination] },
        updated_at: '2026-10-02T00:00:00Z',
      },
    ],
  });
  const baseline = backup(),
    current = backup();
  current.workspace.horses[0].sale.askPrice = 15000;
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, true, result.message);
  const snapshot = f.data.get(supabaseConfig.workspaceTable)[0].payload;
  assert.deepEqual(snapshot.workspace.horses[0].medicalTimeline, [vaccination]);
  assert.equal(snapshot.cloudWorkspaceId, 'ranch-a');
  assert.equal(snapshot.cloudUserId, 'user-a');
  assert.equal(snapshot.snapshotPurpose, 'device-recovery');
  assert.deepEqual(
    current.workspace.horses[0].medicalTimeline,
    [],
    'cloud merging does not mutate the caller snapshot',
  );
});

test('deleting an unchanged legacy row remains possible after real restore normalization', async () => {
  const { restorePersistedState, selectPersistedState } = await import('../../src/store/xbarStoreHelpers.ts');
  const f = fixture();
  const baseline = { ...backup(), workspace: selectPersistedState(restorePersistedState(backup().workspace)) };
  const current = clone(baseline);
  current.workspace.horses = [];
  const result = await saveWorkspaceBackupToCloud(current, {
    baseline,
    deletions: [{ table: 'horses', id: 'horse-a' }],
  });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(f.data.get('horses'), []);
});

test('deletion cannot normalize away a remote-only field from a newer writer', async () => {
  const f = fixture({
    horses: [
      {
        workspace_id: 'ranch-a',
        horse_id: 'horse-a',
        payload: { ...horse, newImportantField: { value: 'preserve' } },
        updated_at: '2026-10-02T00:00:00Z',
      },
    ],
  });
  const baseline = backup(),
    current = backup();
  current.workspace.horses = [];
  const result = await saveWorkspaceBackupToCloud(current, {
    baseline,
    deletions: [{ table: 'horses', id: 'horse-a' }],
  });
  assert.equal(result.ok, false);
  assert.equal(f.data.get('horses').length, 1);
});

test('deletion cannot sanitize an unrecognized remote document state into the baseline', async () => {
  const f = fixture({
    documents: [
      {
        workspace_id: 'ranch-a',
        document_id: 'doc-a',
        payload: { id: 'doc-a', state: 'New future state' },
        updated_at: '2026-10-02T00:00:00Z',
      },
    ],
  });
  const baseline = backup();
  baseline.workspace.documents = [{ id: 'doc-a', state: 'Needs Review' }];
  const current = clone(baseline);
  current.workspace.documents = [];
  const result = await saveWorkspaceBackupToCloud(current, {
    baseline,
    deletions: [{ table: 'documents', id: 'doc-a' }],
  });
  assert.equal(result.ok, false);
  assert.equal(f.data.get('documents').length, 1);
});

test('an Admin profile edit still pending after demotion is not silently acknowledged as saved', async () => {
  const f = fixture({
    workspaces: [],
    workspace_memberships: [{ workspace_id: 'ranch-a', user_id: 'user-a', role: 'Medical Lead', status: 'active' }],
  });
  const baseline = backup(),
    current = backup();
  current.workspace.workspaceProfile.businessName = 'Pending Admin edit';
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, false);
  assert.match(result.message, /profile|administrator/i);
  assert.equal(f.calls.filter((call) => call.action !== 'read').length, 0);
});

test('relational saves work without structuredClone on supported older Safari/WebViews', async () => {
  const f = fixture();
  const baseline = backup(),
    current = backup();
  current.workspace.horses[0].sale.askPrice = 15000;
  const native = globalThis.structuredClone;
  try {
    globalThis.structuredClone = undefined;
    const result = await saveWorkspaceBackupToCloud(current, { baseline });
    assert.equal(result.ok, true, result.message);
    assert.equal(f.data.get('horses')[0].payload.sale.askPrice, 15000);
  } finally {
    globalThis.structuredClone = native;
  }
});

test('unserializable workspace snapshots fail before any relational or fallback write', async () => {
  const f = fixture();
  const current = backup();
  current.workspace.circular = current.workspace;
  const result = await saveWorkspaceBackupToCloud(current, { baseline: backup() });
  assert.equal(result.ok, false);
  assert.match(result.message, /serializ/i);
  assert.equal(f.calls.filter((call) => call.action !== 'read').length, 0);
});

for (const field of ['inquiryCount', 'operationsEmail']) {
  test(`normalized legacy baseline can edit missing ${field}`, async () => {
    const { restorePersistedState, selectPersistedState } = await import('../../src/store/xbarStoreHelpers.ts');
    const f = fixture();
    const baseline = { ...backup(), workspace: selectPersistedState(restorePersistedState(backup().workspace)) };
    const current = clone(baseline);
    if (field === 'inquiryCount') current.workspace.horses[0].sale.inquiryCount = 3;
    else current.workspace.workspaceProfile.operationsEmail = 'barn@example.test';
    const result = await saveWorkspaceBackupToCloud(current, { baseline });
    assert.equal(result.ok, true, result.message);
    if (field === 'inquiryCount')
      assert.deepEqual(f.data.get('horses')[0].payload, { ...horse, sale: { ...horse.sale, inquiryCount: 3 } });
    else
      assert.deepEqual(f.data.get('workspace_profiles')[0].payload, {
        ...profile,
        operationsEmail: 'barn@example.test',
      });
  });
}
test('normalized comparison preserves unknown raw state and fields without unrelated defaults', async () => {
  const { restorePersistedState, selectPersistedState } = await import('../../src/store/xbarStoreHelpers.ts');
  const remote = { ...horse, status: 'Future status', futureField: { privateNote: 'retain' } };
  const f = fixture({
    horses: [{ workspace_id: 'ranch-a', horse_id: 'horse-a', payload: remote, updated_at: '2026-10-01T00:00:00Z' }],
  });
  const baseline = { ...backup(), workspace: selectPersistedState(restorePersistedState(backup().workspace)) };
  const current = clone(baseline);
  current.workspace.horses[0].medicalNotes = 'New treatment';
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(f.data.get('horses')[0].payload, { ...remote, medicalNotes: 'New treatment' });
});
test('normalized defaults cannot conceal a teammate edit of the same field', async () => {
  const { restorePersistedState, selectPersistedState } = await import('../../src/store/xbarStoreHelpers.ts');
  const f = fixture({
    horses: [
      {
        workspace_id: 'ranch-a',
        horse_id: 'horse-a',
        payload: { ...horse, sale: { ...horse.sale, inquiryCount: 7 } },
        updated_at: '2026-10-01T00:00:00Z',
      },
    ],
  });
  const baseline = { ...backup(), workspace: selectPersistedState(restorePersistedState(backup().workspace)) };
  const current = clone(baseline);
  current.workspace.horses[0].sale.inquiryCount = 3;
  const result = await saveWorkspaceBackupToCloud(current, { baseline });
  assert.equal(result.ok, false);
  assert.match(result.message, /inquiryCount/);
  assert.equal(f.calls.filter((c) => c.action !== 'read').length, 0);
});
for (const teammate of [false, true])
  test(`profile trimming ${teammate ? 'still detects a real conflict' : 'does not invent a conflict'}`, async () => {
    const { restorePersistedState, selectPersistedState } = await import('../../src/store/xbarStoreHelpers.ts');
    const original = {
      ...backup(),
      workspace: { ...backup().workspace, workspaceProfile: { ...profile, businessName: 'Old business ' } },
    };
    const f = fixture({
      workspace_profiles: [
        {
          workspace_id: 'ranch-a',
          payload: { ...profile, businessName: teammate ? 'Teammate business ' : 'Old business ' },
          updated_at: '2026-10-01T00:00:00Z',
        },
      ],
    });
    const baseline = { ...original, workspace: selectPersistedState(restorePersistedState(original.workspace)) };
    const current = clone(baseline);
    current.workspace.workspaceProfile.businessName = 'New business';
    const result = await saveWorkspaceBackupToCloud(current, { baseline });
    assert.equal(result.ok, !teammate, result.message);
    assert.equal(
      f.data.get('workspace_profiles')[0].payload.businessName,
      teammate ? 'Teammate business ' : 'New business',
    );
  });

test('relational fixture enforces unique insert identities and replaces matching upserts', async () => {
  const f = fixture();
  const existing = clone(f.data.get('horses')[0]);
  const duplicate = await f.client.from('horses').insert(existing).select('horse_id').single();
  assert.match(duplicate.error?.message ?? '', /duplicate/);
  assert.equal(f.data.get('horses').length, 1);
  const replaced = await f.client
    .from('horses')
    .upsert({ ...existing, payload: { ...horse, name: 'Updated' } })
    .select('horse_id')
    .single();
  assert.equal(replaced.error, null);
  assert.equal(f.data.get('horses').length, 1);
  assert.equal(f.data.get('horses')[0].payload.name, 'Updated');
});

test('snapshot-only saves bind recovery records to verified account and ranch', async () => {
  const f = fixture();
  supabaseConfig.relationalSyncEnabled = false;
  const access = await loadWorkspaceAccessProfile();
  assert.equal(access.workspaceId, null, 'snapshot-only UI and vault stay account-scoped');
  const resolved = await loadWorkspaceAccessProfile(undefined, { forEntitlements: true });
  const result = await saveWorkspaceBackupToCloud(backup(), {
    expectedContext: { userId: 'user-a', workspaceId: access.workspaceId ?? '' },
    expectedRecoveryContext: {
      userId: 'user-a',
      workspaceId: resolved.workspaceId,
      workspaceRole: resolved.workspaceRole,
    },
  });
  assert.equal(result.ok, true, result.message);
  const saved = f.data.get(supabaseConfig.workspaceTable)[0].payload;
  assert.equal(saved.cloudUserId, 'user-a');
  assert.equal(saved.cloudWorkspaceId, 'ranch-a');
});
test('snapshot-only saves refuse a different expected ranch before mutation', async () => {
  const f = fixture();
  supabaseConfig.relationalSyncEnabled = false;
  const result = await saveWorkspaceBackupToCloud(backup(), {
    expectedContext: { userId: 'user-a', workspaceId: 'former-ranch' },
  });
  assert.equal(result.ok, false);
  assert.equal(
    f.calls.some((call) => call.action !== 'read'),
    false,
  );
});

test('snapshot-only legacy accounts without a ranch can save using the real empty store context', async () => {
  const f = fixture({ workspaces: [] });
  supabaseConfig.relationalSyncEnabled = false;
  const access = await loadWorkspaceAccessProfile();
  assert.equal(access.workspaceId, null);
  const resolved = await loadWorkspaceAccessProfile(undefined, { forEntitlements: true });
  const result = await saveWorkspaceBackupToCloud(backup(), {
    expectedContext: { userId: 'user-a', workspaceId: access.workspaceId ?? '' },
    expectedRecoveryContext: {
      userId: 'user-a',
      workspaceId: resolved.workspaceId,
      workspaceRole: resolved.workspaceRole,
    },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(f.calls.filter((call) => call.action === 'upsert').length, 1);
});

for (const expectedRecoveryContext of [
  { userId: 'user-a', workspaceId: 'former-ranch', workspaceRole: 'Admin' },
  { userId: 'user-a', workspaceId: 'ranch-a', workspaceRole: 'Owner' },
  { userId: 'former-user', workspaceId: 'ranch-a', workspaceRole: 'Admin' },
]) {
  test(`snapshot-only save refuses changed recovery identity ${JSON.stringify(expectedRecoveryContext)}`, async () => {
    const f = fixture();
    supabaseConfig.relationalSyncEnabled = false;
    const result = await saveWorkspaceBackupToCloud(backup(), {
      expectedContext: { userId: 'user-a', workspaceId: '' },
      expectedRecoveryContext,
    });
    assert.equal(result.ok, false);
    assert.equal(
      f.calls.some((call) => call.action !== 'read'),
      false,
    );
  });
}

test('snapshot-only autosave with no verified recovery context refuses before mutation', async () => {
  const f = fixture();
  supabaseConfig.relationalSyncEnabled = false;
  const result = await saveWorkspaceBackupToCloud(backup(), { expectedContext: { userId: 'user-a', workspaceId: '' } });
  assert.equal(result.ok, false);
  assert.equal(
    f.calls.some((call) => call.action !== 'read'),
    false,
  );
});

test('verified new-owner first setup creates only the authenticated owned ranch', async () => {
  const f = fixture({ workspaces: [], horses: [], workspace_profiles: [] });
  const { useXbarStore } = await import('../../src/store/useXbarStore.ts');
  const { createEmptyWorkspaceState } = await import('../../src/store/xbarStoreHelpers.ts');
  await new Promise((resolve) => setImmediate(resolve));
  useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  const access = await loadWorkspaceAccessProfile();
  assert.equal(access.workspaceId, null);
  assert.equal(access.workspaceRole, 'Admin', 'verified absence permits the explicit new-owner setup path');
  useXbarStore.setState({ ...createEmptyWorkspaceState(), currentRole: access.workspaceRole });
  assert.equal(
    useXbarStore.getState().initializeWorkspace({ ranchName: 'New owned ranch', businessName: 'New owned business' })
      .ok,
    true,
  );
  const result = await saveWorkspaceBackupToCloud(useXbarStore.getState().exportWorkspaceBackup());
  assert.equal(result.ok, true, result.message);
  assert.equal(f.data.get('workspaces')[0].owner_user_id, 'user-a');
  assert.equal(f.data.get('workspace_memberships')[0].user_id, 'user-a');
  assert.equal(f.data.get('workspace_memberships')[0].role, 'Admin');
  assert.equal(f.data.get('horses').length, 0, 'no prior account records ride along with creation');
});

for (const count of [5000, 20000]) {
  test(`explicit replacement of ${count} documents uses bounded batch requests`, async () => {
    const f = fixture({ documents: [] });
    const current = backup();
    current.workspace.documents = Array.from({ length: count }, (_, i) => ({
      id: `document-${String(i).padStart(5, '0')}`,
      title: `Document ${i}`,
      horseId: 'horse-a',
      type: 'Other',
      source: 'Uploaded',
      state: 'Ready',
      fileSizeBytes: 1,
    }));
    const result = await saveWorkspaceBackupToCloud(current, { replace: true });
    assert.equal(result.ok, true, result.message);
    const writes = f.calls.filter((call) => call.table === 'documents' && call.action === 'upsert');
    assert.ok(writes.length <= count / 50, `${writes.length} document HTTP writes is not bounded batching`);
    assert.ok(f.calls.length <= count / 10, `${f.calls.length} total database requests regresses to per-record work`);
    assert.equal(f.data.get('documents').length, count);
    assert.equal(f.data.get('documents').at(-1).document_id, `document-${String(count - 1).padStart(5, '0')}`);
  });
}

function replacementDocuments(count, note = '') {
  return Array.from({ length: count }, (_, i) => ({
    id: `document-${String(i).padStart(5, '0')}`,
    title: `Document ${i}`,
    horseId: 'horse-a',
    type: 'Other',
    source: 'Uploaded',
    state: 'Ready',
    notes: note,
  }));
}
for (const failure of [
  'second-batch',
  'missing-row',
  'duplicate-row',
  'wrong-workspace',
  'changed-payload',
  'account-change',
  'ranch-change',
  'role-change',
  'auth-error',
  'auth-throw',
  'network-throw',
]) {
  test(`replacement batches refuse ${failure} without reporting complete or writing a recovery fallback`, async () => {
    let documentWrites = 0;
    const f = fixture({ documents: [] }, undefined, {
      beforeWrite({ table, action }) {
        if (table !== 'documents' || action !== 'upsert') return;
        documentWrites++;
        if (failure === 'network-throw' && documentWrites === 2) throw new Error('Synthetic transport interrupted');
        if (failure === 'second-batch' && documentWrites === 2)
          return { data: null, error: { message: 'synthetic rejected batch' } };
      },
      afterResult({ table, action, result, client }) {
        if (table !== 'documents' || action !== 'upsert' || documentWrites !== 1) return;
        if (failure === 'missing-row') return { ...result, data: result.data.slice(1) };
        if (failure === 'duplicate-row') return { ...result, data: [...result.data.slice(1), result.data[1]] };
        if (failure === 'wrong-workspace')
          return {
            ...result,
            data: result.data.map((row, i) => (i === 0 ? { ...row, workspace_id: 'other-ranch' } : row)),
          };
        if (failure === 'changed-payload')
          return {
            ...result,
            data: result.data.map((row, i) =>
              i === 0 ? { ...row, payload: { ...row.payload, title: 'Unrequested' } } : row,
            ),
          };
        if (failure === 'auth-error')
          client.auth.getSession = async () => ({
            data: { session: null },
            error: { message: 'Synthetic auth failure' },
          });
        if (failure === 'auth-throw')
          client.auth.getSession = async () => {
            throw new Error('Synthetic auth transport failure');
          };
        if (failure === 'account-change')
          client.auth.getSession = async () => ({
            data: { session: { user: { id: 'replacement-user' } } },
            error: null,
          });
        if (failure === 'ranch-change')
          f.data.set('workspaces', [{ id: 'other-ranch', owner_user_id: 'user-a', workspace_key: 'primary' }]);
        if (failure === 'role-change') {
          f.data.set('workspaces', []);
          f.data.set('workspace_memberships', [
            { workspace_id: 'ranch-a', user_id: 'user-a', status: 'active', role: 'Medical Lead' },
          ]);
        }
      },
    });
    const current = backup();
    current.workspace.documents = replacementDocuments(250);
    const result = await saveWorkspaceBackupToCloud(current, { replace: true });
    assert.equal(result.ok, false);
    assert.match(result.message, /replacement|batch|confirmed/i);
    assert.ok(documentWrites <= 2);
    assert.equal(f.data.get('documents').length, 100, 'earlier committed rows remain visible as partial work');
    assert.equal(
      result.relationalRowsPersisted,
      false,
      'partial document batches do not release the whole pending reservation',
    );
    assert.equal(
      f.calls.some((call) => call.table === supabaseConfig.workspaceTable && call.action === 'upsert'),
      false,
    );
  });
}
test('replacement byte budget splits large JSON payloads into bounded requests', async () => {
  const f = fixture({ documents: [] });
  const current = backup();
  current.workspace.documents = replacementDocuments(150, '🐴'.repeat(5000));
  const result = await saveWorkspaceBackupToCloud(current, { replace: true });
  assert.equal(result.ok, true, result.message);
  const writes = f.calls.filter((call) => call.table === 'documents' && call.action === 'upsert');
  assert.ok(writes.length > 2);
  for (const write of writes) assert.ok(Buffer.byteLength(JSON.stringify(write.values)) <= 512 * 1024);
});
for (const failPage of [false, true]) {
  test(`replacement existing-ID scan beyond cap ${failPage ? 'refuses a later-page failure' : 'deletes the last stale record'}`, async () => {
    const docs = replacementDocuments(1203);
    const f = fixture(
      {
        documents: docs.map((payload) => ({
          workspace_id: 'ranch-a',
          document_id: payload.id,
          payload,
          updated_at: '2026-10-01T00:00:00Z',
        })),
      },
      undefined,
      {
        readCap: 137,
        beforeWrite({ table, action, first, queryOptions }) {
          if (failPage && table === 'documents' && action === 'read' && queryOptions.count === 'exact' && first > 0)
            return { data: null, error: { message: 'later page failed' }, count: 1203 };
        },
      },
    );
    const current = backup();
    current.workspace.documents = docs.slice(0, -1);
    const result = await saveWorkspaceBackupToCloud(current, { replace: true });
    assert.equal(result.ok, !failPage, result.message);
    assert.equal(f.data.get('documents').length, failPage ? 1203 : 1202);
    if (failPage)
      assert.equal(
        f.calls.some((call) => call.table === 'documents' && call.action !== 'read'),
        false,
      );
    else
      assert.equal(
        f.data.get('documents').some((row) => row.document_id === docs.at(-1).id),
        false,
      );
  });
}
test('replacement refuses duplicate source IDs across batch boundaries', async () => {
  const f = fixture({ documents: [] });
  const current = backup();
  current.workspace.documents = replacementDocuments(101);
  current.workspace.documents[100].id = current.workspace.documents[0].id;
  const result = await saveWorkspaceBackupToCloud(current, { replace: true });
  assert.equal(result.ok, false);
  assert.equal(
    f.calls.some((call) => call.table === 'documents' && call.action !== 'read'),
    false,
  );
});

test('a later collection failure still reports fully confirmed document persistence', async () => {
  const f = fixture({ documents: [] }, undefined, {
    beforeWrite({ table, action }) {
      if (table === 'intake_batches' && action === 'upsert')
        return { data: null, error: { message: 'Synthetic later collection failure' } };
    },
  });
  const current = backup();
  current.workspace.documents = replacementDocuments(150);
  current.workspace.intakeBatches = [{ id: 'intake-a', label: 'New intake' }];
  const result = await saveWorkspaceBackupToCloud(current, { replace: true });
  assert.equal(result.ok, false);
  assert.equal(result.relationalRowsPersisted, true);
  assert.equal(f.data.get('documents').length, 150);
  assert.equal(
    f.calls.some((call) => call.table === supabaseConfig.workspaceTable && call.action === 'upsert'),
    false,
  );
});

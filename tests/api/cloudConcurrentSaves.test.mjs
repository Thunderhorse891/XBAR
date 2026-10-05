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
const { saveWorkspaceBackupToCloud } = await import('../../src/lib/cloudWorkspace.ts');

const horse = { id: 'horse-a', name: 'Blue', sale: { askPrice: 10000 }, medicalTimeline: [] };
const profile = { ranchName: 'Ranch', businessName: 'Old business' };
const backup = () => ({
  app: 'XBAR',
  version: 16,
  workspace: { horses: [structuredClone(horse)], workspaceProfile: structuredClone(profile) },
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
function fixture(remote = {}, beforeUpdate) {
  const data = new Map(
    Object.entries({
      workspaces: [{ id: 'ranch-a', owner_user_id: 'user-a', workspace_key: 'primary' }],
      horses: [
        {
          workspace_id: 'ranch-a',
          horse_id: 'horse-a',
          payload: structuredClone(horse),
          updated_at: '2026-10-01T00:00:00Z',
        },
      ],
      workspace_profiles: [
        { workspace_id: 'ranch-a', payload: structuredClone(profile), updated_at: '2026-10-01T00:00:00Z' },
      ],
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
        single = false;
      const matches = (row) =>
        filters.every(([key, value]) =>
          key === 'payload'
            ? JSON.stringify(row[key]) === value
            : Array.isArray(value)
              ? value.includes(row[key])
              : row[key] === value,
        );
      const execute = () => {
        calls.push({ table, action, values: structuredClone(values), filters });
        const rows = data.get(table) ?? [];
        if (action === 'update') beforeUpdate?.(table, rows);
        let selected = rows.filter(matches);
        if (action === 'upsert' || action === 'insert') {
          selected = [];
          for (const value of Array.isArray(values) ? values : [values]) {
            const key = ids[table] ?? 'email';
            const found = rows.find(
              (row) => (Array.isArray(value) ? value.includes(row[key]) : row[key] === value)[key],
            );
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
        return { data: single ? (selected[0] ?? null) : selected, error: null };
      };
      const chain = {
        select() {
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
  return { data, calls };
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
  const current = structuredClone(baseline);
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
  const current = structuredClone(baseline);
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

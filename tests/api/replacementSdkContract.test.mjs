import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    if (/\/supabaseClient(?:\.[tj]s)?$/.test(specifier))
      return { url: new URL('./fixtures/cloudSubscriptionClient.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const { createClient } = await import('@supabase/supabase-js');
const { setCloudSubscriptionClient } = await import('./fixtures/cloudSubscriptionClient.mjs');
const { supabaseConfig } = await import('../../src/lib/platformConfig.ts');
const { saveWorkspaceBackupToCloud } = await import('../../src/lib/cloudWorkspace.ts');
const stamp = '2026-10-01T00:00:00Z';
const defaults = {
  horse_id: '',
  document_type: '',
  source: '',
  state: '',
  confidence: 0,
  duplicate_risk: '',
  size_bytes: 0,
};
// Actual installed SDK, fully intercepted transport. Models selected-column
// defaults/updates, not a substitute for PostgreSQL/RLS integration coverage.
function fixture(documents = []) {
  Object.assign(supabaseConfig, {
    url: 'https://synthetic.example.test',
    anonKey: 'synthetic',
    relationalSyncEnabled: true,
    snapshotFallbackEnabled: true,
  });
  const tables = new Map([
    ['workspaces', [{ id: 'ranch-a', owner_user_id: 'user-a', workspace_key: 'primary' }]],
    ['documents', documents],
  ]);
  const requests = [];
  const client = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (raw, init) => {
        const url = new URL(raw),
          table = url.pathname.split('/').at(-1),
          headers = new Headers(init.headers);
        const all = tables.get(table) ?? [],
          json = init.body ? JSON.parse(init.body) : null;
        const columns = url.searchParams
          .get('columns')
          ?.split(',')
          .map((value) => value.replaceAll('"', ''));
        requests.push({ table, method: init.method, columns, body: json, prefer: headers.get('prefer') });
        const respond = (body, status = 200, extra = {}) =>
          new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } });
        if (init.method === 'POST') {
          const saved = [];
          for (const row of Array.isArray(json) ? json : [json]) {
            const selected = columns ?? Object.keys(row);
            const existing =
              table === 'documents'
                ? all.find((item) => item.workspace_id === row.workspace_id && item.document_id === row.document_id)
                : undefined;
            const next = { ...(existing ?? (table === 'documents' ? defaults : {})) };
            for (const key of selected)
              next[key] = Object.hasOwn(row, key)
                ? row[key]
                : headers.get('prefer')?.includes('missing=default')
                  ? (defaults[key] ?? null)
                  : null;
            if (table === 'documents' && ['confidence', 'duplicate_risk'].some((key) => next[key] === null))
              return respond({ code: '23502', message: 'synthetic NOT NULL document column' }, 400);
            if (existing) Object.assign(existing, next);
            else all.push(next);
            saved.push(next);
          }
          tables.set(table, all);
          return respond(headers.get('accept')?.includes('vnd.pgrst.object') ? saved[0] : saved, 201);
        }
        let selected = all.filter((row) =>
          [...url.searchParams].every(
            ([key, value]) => !value.startsWith('eq.') || String(row[key]) === value.slice(3),
          ),
        );
        const count = selected.length,
          offset = Number(url.searchParams.get('offset') ?? 0),
          limit = Number(url.searchParams.get('limit') ?? 500);
        const order = url.searchParams.get('order')?.split('.')[0];
        if (order) selected = [...selected].sort((a, b) => String(a[order]).localeCompare(String(b[order])));
        selected = selected.slice(offset, offset + limit);
        const select = url.searchParams.get('select');
        if (select && select !== '*')
          selected = selected.map((row) =>
            Object.fromEntries(
              select
                .split(',')
                .filter((key) => Object.hasOwn(row, key))
                .map((key) => [key, row[key]]),
            ),
          );
        return respond(headers.get('accept')?.includes('vnd.pgrst.object') ? (selected[0] ?? null) : selected, 200, {
          'Content-Range': count ? `${offset}-${offset + selected.length - 1}/${count}` : '*/0',
        });
      },
    },
  });
  client.auth.getSession = async () => ({
    data: { session: { user: { id: 'user-a', email: 'synthetic@example.test' } } },
    error: null,
  });
  setCloudSubscriptionClient(client);
  return { tables, requests };
}
const document = (id, extra = {}) => ({
  id,
  title: id,
  horseId: 'horse-a',
  type: 'Other',
  source: 'Uploaded',
  state: 'Ready',
  fileSizeBytes: 1,
  ...extra,
});
const backup = (documents) => ({
  app: 'XBAR',
  version: 16,
  workspace: { horses: [], workspaceProfile: { ranchName: 'Ranch' }, documents },
});
for (const existing of [false, true]) {
  test(`actual SDK preserves omitted canonical document columns for ${existing ? 'existing' : 'new'} rows`, async () => {
    const doc = document('document-a');
    const f = fixture(
      existing
        ? [
            {
              workspace_id: 'ranch-a',
              document_id: doc.id,
              payload: doc,
              updated_at: stamp,
              confidence: 87,
              duplicate_risk: 'High',
            },
          ]
        : [],
    );
    const result = await saveWorkspaceBackupToCloud(backup([doc]), { replace: true });
    assert.equal(result.ok, true, result.message);
    const saved = f.tables.get('documents')[0];
    assert.equal(saved.confidence, existing ? 87 : 0);
    assert.equal(saved.duplicate_risk, existing ? 'High' : '');
    for (const request of f.requests.filter((row) => row.table === 'documents' && row.method === 'POST')) {
      assert.equal(request.columns.includes('confidence'), false);
      assert.equal(request.columns.includes('duplicate_risk'), false);
    }
  });
}
test('heterogeneous SDK rows keep omission separate from an explicit canonical update', async () => {
  const omitted = document('document-a'),
    edited = document('document-b', { confidence: 42, duplicateRisk: 'Low' });
  const f = fixture(
    [omitted, edited].map((doc) => ({
      workspace_id: 'ranch-a',
      document_id: doc.id,
      payload: doc,
      updated_at: stamp,
      confidence: 87,
      duplicate_risk: 'High',
    })),
  );
  const result = await saveWorkspaceBackupToCloud(backup([omitted, edited, document('document-c')]), { replace: true });
  assert.equal(result.ok, true, result.message);
  const byId = new Map(f.tables.get('documents').map((row) => [row.document_id, row]));
  assert.equal(byId.get('document-a').confidence, 87);
  assert.equal(byId.get('document-b').confidence, 42);
  assert.equal(byId.get('document-b').duplicate_risk, 'Low');
  assert.equal(byId.get('document-c').confidence, 0);
  for (const request of f.requests.filter((row) => row.table === 'documents' && row.method === 'POST'))
    for (const row of request.body)
      for (const column of request.columns)
        assert.ok(Object.hasOwn(row, column), `SDK column ${column} must exist on every row in its batch`);
});

test('actual SDK keeps an explicit nullable listing publication value', async () => {
  const f = fixture();
  const source = backup([]);
  source.workspace.sharedListings = [
    {
      id: 'listing-a',
      horseId: 'horse-a',
      accessMode: 'Public Link',
      shareToken: '',
      state: 'Draft',
      channels: [],
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  const result = await saveWorkspaceBackupToCloud(source, { replace: true });
  assert.equal(result.ok, true, result.message);
  const request = f.requests.find((row) => row.table === 'shared_listings' && row.method === 'POST');
  assert.ok(request.columns.includes('published_at'));
  assert.equal(request.body[0].published_at, null);
});

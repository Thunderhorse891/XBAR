// Invoked by horsesImportIntegrity.test.mjs in a child Node process with
// --experimental-vm-modules. Execute the actual default HTTP handler without
// changing its source. Only service imports are replaced; planning, CSV
// parsing, authorization and database query construction stay real.
// No network or production credentials are available inside the VM.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const sourceUrl = new URL('../../../api/_lib/horses-import.js', import.meta.url);
const permissionsUrl = new URL('../../../api/_lib/permissions.js', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const permissions = await readFile(permissionsUrl, 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const horse = (id = 'A', reg = '111111', workspace = 'W') => ({
  horse_id: id,
  registration_number: reg,
  workspace_id: workspace,
  name: `HORSE ${id}`,
  color: 'Bay',
  status: 'Sold',
});

function fakeDatabase(options) {
  const table = (options.horses ?? []).map((row) => ({ ...row }));
  const calls = { planning: 0, rechecks: 0, updates: 0, inserts: 0, affected: 0, maxChunk: 0 };
  return {
    table,
    calls,
    from(name) {
      assert.equal(name, 'horses');
      let operation = 'select';
      let payload;
      let projection = '*';
      let countRequested = false;
      let resultPromise;
      const filters = [];
      const matches = (row) =>
        filters.every(([key, value]) => (Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
      const project = (row) =>
        projection === '*'
          ? { ...row }
          : Object.fromEntries(projection.split(',').map((key) => [key.trim(), row[key.trim()]]));
      const execute = async () => {
        if (operation === 'select') {
          const planning = filters.some(([, value]) => Array.isArray(value));
          calls[planning ? 'planning' : 'rechecks'] += 1;
          if (planning) {
            calls.maxChunk = Math.max(
              calls.maxChunk,
              ...filters.filter(([, v]) => Array.isArray(v)).map(([, v]) => v.length),
            );
          }
          const prefix = planning ? 'plan' : 'recheck';
          if (options[`${prefix}Throw`]) throw new Error(`${prefix} transport failure`);
          if (options[`${prefix}Error`]) return { data: null, error: { message: `${prefix} database failure` } };
          let data = Object.hasOwn(options, `${prefix}Data`)
            ? options[`${prefix}Data`]
            : table.filter(matches).map(project);
          const actualCount = Array.isArray(data) ? data.length : null;
          if (planning && options.rowCap !== undefined && Array.isArray(data)) data = data.slice(0, options.rowCap);
          const result = { data, error: null, count: countRequested ? actualCount : null };
          if (planning && Object.hasOwn(options, 'planCount')) result.count = options.planCount;
          if (planning) options.afterPlan?.(table, calls);
          return result;
        }
        if (operation === 'update') {
          calls.updates += 1;
          options.beforeUpdate?.(table, calls);
          if (options.updateThrow) throw new Error('update transport failure');
          if (options.updateError) return { data: null, error: { message: 'update rejected' } };
          const matched = table.filter(matches);
          for (const row of matched) Object.assign(row, payload);
          calls.affected += matched.length;
          return {
            data: Object.hasOwn(options, 'updateReceipt') ? options.updateReceipt : matched.map(project),
            error: null,
          };
        }
        calls.inserts += 1;
        if (options.insertThrow) throw new Error('insert transport failure');
        if (options.insertError) return { data: null, error: { message: 'insert rejected' } };
        table.push({ ...payload });
        calls.affected += 1;
        return {
          data: Object.hasOwn(options, 'insertReceipt') ? options.insertReceipt : [project(payload)],
          error: null,
        };
      };
      const builder = {
        select(columns = '*', config = {}) {
          projection = columns;
          countRequested = config.count === 'exact';
          return builder;
        },
        eq(key, value) {
          filters.push([key, value]);
          return builder;
        },
        in(key, value) {
          filters.push([key, [...value]]);
          return builder;
        },
        update(value) {
          operation = 'update';
          payload = value;
          return builder;
        },
        insert(value) {
          operation = 'insert';
          payload = value;
          return builder;
        },
        then(resolve, reject) {
          resultPromise ??= execute();
          return resultPromise.then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

async function invoke(options = {}) {
  const database = fakeDatabase(options);
  const audits = [];
  let capacityCalls = 0;
  const context = createContext({ console });
  const services = {
    'node:crypto': { randomUUID },
    './http.js': {
      readJsonBody: async (req) => req.body,
      sendJson: (res, status, body) => Object.assign(res, { status, body: clone(body) }),
    },
    './supabase-admin.js': {
      requireWorkspaceAccess: async () => {
        return options.access ?? {
          ok: true,
          role: options.role ?? 'Admin',
          user: { id: 'U', email: 'test@example.invalid' },
          supabase: database,
        };
      },
    },
    './entitlements.js': {
      getWorkspaceEntitlements: async () => options.entitlements ?? { ok: true, limits: { horseLimit: 1000 } },
      checkHorseCapacity: async (_supabase, _workspace, planned) => {
        capacityCalls += 1;
        assert.ok(Number.isSafeInteger(planned));
        return options.capacity ?? { ok: true, used: database.table.length };
      },
    },
    './audit.js': { recordAuditEvent: async (_db, event) => audits.push(clone(event)) },
    './document-extraction.js': { normalizeDate: (value) => value },
    './rate-limit.js': { enforceRateLimit: async () => true },
    './cors.js': { applyCors: () => true },
    './validation.js': { horsesImportSchema: {}, parseBody: (_schema, body) => ({ ok: true, data: body }) },
  };
  const module = new SourceTextModule(source, { context, identifier: sourceUrl.href });
  await module.link(async (specifier) => {
    if (specifier === './permissions.js') return new SourceTextModule(permissions, { context });
    const exports = services[specifier];
    assert.ok(exports, `Unexpected import: ${specifier}`);
    return new SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      },
      { context },
    );
  });
  await module.evaluate();
  const response = {};
  await module.namespace.default(
    {
      method: options.method ?? 'POST',
      headers: { authorization: 'Bearer synthetic-token' },
      body: { workspaceId: 'W', csv: options.csv ?? 'Name,Registration Number\nNEW,111111' },
    },
    response,
  );
  return { ...response, database, audits, capacityCalls };
}

function noHorseWrite(result) {
  assert.equal(result.database.calls.updates + result.database.calls.inserts, 0);
  assert.equal(result.database.calls.affected, 0);
}

function rowFailure(result) {
  assert.equal(result.body.imported, 0);
  assert.equal(result.body.updated, 0);
  assert.equal(result.body.partial, true);
  assert.equal(result.body.errors.length, 1);
}

test('default handler rejects duplicate database identities before any write', async () => {
  const result = await invoke({ horses: [horse('A'), horse('B')], role: 'Owner' });
  assert.equal(result.status, 502);
  assert.match(result.body.message, /ambiguous/i);
  noHorseWrite(result);
});

for (const [label, data] of [
  ['null', null],
  ['object instead of array', {}],
  ['missing horse ID', [{ registration_number: '111111' }]],
  ['blank horse ID', [{ horse_id: ' ', registration_number: '111111' }]],
  ['numeric horse ID', [{ horse_id: 42, registration_number: '111111' }]],
  ['missing registration', [{ horse_id: 'A' }]],
  ['unexpected registration', [{ horse_id: 'A', registration_number: '222222' }]],
  ['null element', [null]],
]) {
  test(`default handler refuses malformed planning data: ${label}`, async () => {
    const result = await invoke({ planData: data });
    assert.equal(result.status, 502);
    noHorseWrite(result);
  });
}

for (const count of [null, -1, 0.5, '0', 1]) {
  test(`default handler refuses invalid or incomplete planning count: ${JSON.stringify(count)}`, async () => {
    const result = await invoke({ planCount: count });
    assert.equal(result.status, 502);
    noHorseWrite(result);
  });
}

test('truncated planning responses never turn an existing horse into an insertion', async () => {
  const result = await invoke({ horses: [horse()], rowCap: 0 });
  assert.equal(result.status, 502);
  noHorseWrite(result);
});

for (const key of ['planError', 'planThrow']) {
  test(`planning ${key} fails closed`, async () => {
    const result = await invoke({ [key]: true });
    assert.equal(result.status, 502);
    noHorseWrite(result);
  });
}

test('newly occupied registration is refused instead of inserting or retargeting', async () => {
  const result = await invoke({ afterPlan: (table) => table.push(horse('B')) });
  noHorseWrite(result);
  rowFailure(result);
  assert.equal(result.database.table.length, 1);
  assert.equal(result.database.table[0].name, 'HORSE B');
});

for (const [label, options] of [
  ['ordinary lookup error', { recheckError: true }],
  ['thrown lookup error', { recheckThrow: true }],
  ['null lookup', { recheckData: null }],
  ['malformed lookup', { recheckData: [{ registration_number: '111111' }] }],
  ['ambiguous lookup', { recheckData: [horse('A'), horse('B')] }],
]) {
  test(`insert recheck refuses ${label}`, async () => {
    const result = await invoke(options);
    noHorseWrite(result);
    rowFailure(result);
  });
}

for (const role of ['Owner', 'Sales Lead', 'Admin']) {
  test(`${role}: planned update never becomes creation when the target vanishes`, async () => {
    const result = await invoke({ role, horses: [horse()], afterPlan: (table) => table.splice(0) });
    rowFailure(result);
    assert.equal(result.database.calls.affected, 0);
    assert.equal(result.database.calls.inserts, 0);
  });
}

test('moved registration cannot redirect an update to another horse', async () => {
  const result = await invoke({ horses: [horse()], afterPlan: (table) => table.splice(0, 1, horse('B')) });
  rowFailure(result);
  assert.equal(result.database.calls.affected, 0);
  assert.equal(result.database.table[0].name, 'HORSE B');
});

test('last-moment disappearance yields zero changed rows, not success', async () => {
  const result = await invoke({ horses: [horse()], beforeUpdate: (table) => table.splice(0) });
  rowFailure(result);
  assert.equal(result.database.calls.affected, 0);
});

for (const role of ['Owner', 'Sales Lead', 'Medical Lead', 'Unknown']) {
  test(`${role}: unauthorized insertion has zero writes`, async () => {
    const result = await invoke({ role });
    assert.equal(result.status, 403);
    noHorseWrite(result);
  });
}

test('Medical Lead cannot update existing horses', async () => {
  const result = await invoke({ horses: [horse()], role: 'Medical Lead' });
  assert.equal(result.status, 403);
  noHorseWrite(result);
});

test('whole-batch authorization denies a mixed insert/update before the first write', async () => {
  const result = await invoke({
    horses: [horse()],
    role: 'Owner',
    csv: 'Name,Registration Number\nEDIT,111111\nNEW,222222',
  });
  assert.equal(result.status, 403);
  noHorseWrite(result);
});

test('ordinary update preserves absent columns and counts the intended horse once', async () => {
  const result = await invoke({ horses: [horse()], role: 'Owner' });
  assert.deepEqual(result.body, { ok: true, partial: false, imported: 0, updated: 1, errors: [] });
  assert.equal(result.database.table[0].name, 'NEW');
  assert.equal(result.database.table[0].color, 'Bay');
  assert.equal(result.database.table[0].status, 'Sold');
});

test('blank status preserves lifecycle while explicit blank owner clears only that field', async () => {
  const result = await invoke({
    horses: [{ ...horse(), owner_name: 'OLD' }],
    csv: 'Name,Registration Number,Status,Owner\nNEW,111111,,',
  });
  assert.equal(result.body.updated, 1);
  assert.equal(result.database.table[0].status, 'Sold');
  assert.equal(result.database.table[0].owner_name, '');
});

test('an authorized new registration inserts exactly once and is counted once', async () => {
  const result = await invoke();
  assert.deepEqual(result.body, { ok: true, partial: false, imported: 1, updated: 0, errors: [] });
  assert.equal(result.database.calls.rechecks, 1);
  assert.equal(result.database.calls.inserts, 1);
});

test('records without registration retain the authorized creation path', async () => {
  const result = await invoke({ csv: 'Name\nUNREGISTERED FOAL' });
  assert.equal(result.body.imported, 1);
  assert.equal(result.database.calls.planning, 0);
  assert.equal(result.database.calls.rechecks, 0);
});

test('capacity denial prevents every horse write', async () => {
  const result = await invoke({ capacity: { ok: false, status: 403, message: 'At capacity' } });
  assert.equal(result.status, 403);
  noHorseWrite(result);
});

test('unknown usage never opens the insertion budget', async () => {
  const result = await invoke({ capacity: { ok: true } });
  assert.equal(result.status, 503);
  noHorseWrite(result);
});

test('update-only Admin imports do not depend on an insertion entitlement', async () => {
  const result = await invoke({ horses: [horse()], entitlements: { ok: false, status: 503, message: 'Unavailable' } });
  assert.equal(result.body.updated, 1);
  assert.equal(result.capacityCalls, 0);
});

for (const key of ['updateError', 'updateThrow', 'insertError', 'insertThrow']) {
  test(`${key} never increments a success counter`, async () => {
    const result = await invoke({ horses: key.startsWith('update') ? [horse()] : [], [key]: true });
    rowFailure(result);
    assert.equal(result.database.calls.affected, 0);
  });
}

for (const [operation, receipt] of [
  ['update', null],
  ['update', []],
  ['update', [{}]],
  ['update', [{ horse_id: 'B' }]],
  ['insert', null],
  ['insert', []],
  ['insert', [{}]],
  ['insert', [{ horse_id: 'B' }]],
]) {
  test(`${operation}: unconfirmed receipt ${JSON.stringify(receipt)} is not reported as success`, async () => {
    const result = await invoke({ horses: operation === 'update' ? [horse()] : [], [`${operation}Receipt`]: receipt });
    rowFailure(result);
    assert.match(result.body.errors[0].message, /review/i);
  });
}

test('duplicate CSV registration rows are rejected before planning', async () => {
  const result = await invoke({ csv: 'Name,Registration Number\nONE,111111\nTWO,111111' });
  assert.equal(result.status, 400);
  assert.equal(result.database.calls.planning, 0);
  noHorseWrite(result);
});

test('workspace filtering prevents cross-workspace edits', async () => {
  const result = await invoke({ horses: [horse('A', '111111', 'OTHER')] });
  assert.equal(result.body.imported, 1);
  assert.equal(result.database.table.find((row) => row.workspace_id === 'OTHER').name, 'HORSE A');
});

test('multiple bounded planning queries cover every registration', async () => {
  const horses = Array.from({ length: 205 }, (_, i) => horse(`H${i}`, String(i)));
  const csv = ['Name,Registration Number', ...horses.map((row) => `EDIT,${row.registration_number}`)].join('\n');
  const result = await invoke({ horses, csv });
  assert.equal(result.body.updated, 205);
  assert.equal(result.database.calls.planning, 3);
  assert.ok(result.database.calls.maxChunk <= 100);
});

test('mixed batch preserves successes and reports only failed rows', async () => {
  const result = await invoke({
    horses: [horse('A'), horse('GONE', '222222')],
    afterPlan: (table) => table.splice(1, 1),
    csv: 'Name,Registration Number\nEDIT,111111\nLOST,222222\nNEW,333333',
  });
  assert.equal(result.body.updated, 1);
  assert.equal(result.body.imported, 1);
  assert.equal(result.body.partial, true);
  assert.deepEqual(result.body.errors.map((error) => error.row), [3]);
  assert.deepEqual(result.audits[0].metadata, { imported: 1, updated: 1, errors: 1 });
});

test('malformed later planning chunk stops earlier valid rows before all writes', async () => {
  const horses = Array.from({ length: 101 }, (_, i) => horse(`H${i}`, String(i)));
  const csv = ['Name,Registration Number', ...horses.map((row) => `EDIT,${row.registration_number}`)].join('\n');
  const result = await invoke({
    horses,
    csv,
    afterPlan: (table, calls) => {
      if (calls.planning === 1) table.push(horse('DUP', '100'));
    },
  });
  assert.equal(result.status, 502);
  noHorseWrite(result);
});

test('auth denial never queries or writes horses', async () => {
  const result = await invoke({ access: { ok: false, status: 401, message: 'Unauthorized' } });
  assert.equal(result.status, 401);
  assert.equal(result.database.calls.planning, 0);
  noHorseWrite(result);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';

import { hasRoleCapability, requireRoleCapability } from '../../api/_lib/permissions.js';

/*
 * The browser and the server must agree about who may do what.
 *
 * api/_lib/permissions.js exists because the CSV import handler holds the
 * Supabase SERVICE ROLE, which bypasses table RLS by design -- so it has to
 * authorize the action itself before any privileged write. That file carries a
 * second copy of the matrix in src/lib/permissions.ts, and its own comment says
 * to keep the two aligned.
 *
 * A comment is not a mechanism. Two copies of a security policy drift silently,
 * and the direction that matters is one-way: if the server copy ever grants a
 * capability the client copy withholds, a role the product presents as unable
 * to create horses can create them through the import endpoint, and nothing in
 * the UI would show it. This reads both files and compares them, so the drift
 * fails the build instead of widening access quietly.
 *
 * Parsed as text rather than imported because the client copy is TypeScript and
 * this suite runs on plain node -- the same reason the entitlement parity test
 * beside it reads SQL from disk.
 */

function parseRoleCapabilityMap(filePath) {
  const source = readFileSync(new URL(filePath, import.meta.url), 'utf8');
  const start = source.indexOf('const roleCapabilityMap');
  assert.notEqual(start, -1, `${filePath} must declare roleCapabilityMap`);

  const end = source.indexOf('};', start);
  assert.notEqual(end, -1, `${filePath} roleCapabilityMap must be a closed object literal`);

  const body = source.slice(start, end);
  const entries = {};
  for (const match of body.matchAll(/(?:'([^']+)'|([A-Za-z_$][\w$]*)):\s*\[([^\]]*)\]/g)) {
    const role = match[1] ?? match[2];
    entries[role] = [...match[3].matchAll(/'([^']+)'/g)].map((capability) => capability[1]).sort();
  }

  assert.ok(Object.keys(entries).length > 0, `${filePath} roleCapabilityMap must not parse empty`);
  return entries;
}

test('the server capability matrix matches the client one exactly', () => {
  const client = parseRoleCapabilityMap('../../src/lib/permissions.ts');
  const server = parseRoleCapabilityMap('../../api/_lib/permissions.js');

  assert.deepEqual(Object.keys(server).sort(), Object.keys(client).sort(), 'both copies must define the same roles');

  for (const role of Object.keys(client).sort()) {
    assert.deepEqual(server[role], client[role], `role ${role} must carry identical capabilities in both copies`);
  }
});

test('the server never grants a capability the client withholds', () => {
  // Stated separately from the equality check above because this is the
  // direction that escalates privilege rather than merely confusing the UI.
  const client = parseRoleCapabilityMap('../../src/lib/permissions.ts');
  const server = parseRoleCapabilityMap('../../api/_lib/permissions.js');

  for (const [role, capabilities] of Object.entries(server)) {
    for (const capability of capabilities) {
      assert.ok(
        client[role]?.includes(capability),
        `server grants ${role} the capability ${capability}, which the client does not`,
      );
    }
  }
});

test('an unknown role is refused every capability', () => {
  // A role the matrix has never heard of must fall closed, not open.
  for (const capability of ['createHorse', 'editHorse', 'manageBilling']) {
    assert.equal(hasRoleCapability('Groom', capability), false);
    assert.equal(hasRoleCapability(undefined, capability), false);
    assert.equal(hasRoleCapability('', capability), false);
    assert.ok(requireRoleCapability('Groom', capability), 'a refusal must carry a message');
  }
});

test('the roles the CSV import path depends on are the ones it claims', () => {
  // The import handler requires createHorse before inserts and editHorse before
  // updates. Pinned so a matrix edit cannot silently open that endpoint.
  assert.equal(hasRoleCapability('Admin', 'createHorse'), true);
  assert.equal(hasRoleCapability('Ranch Manager', 'createHorse'), true);

  assert.equal(hasRoleCapability('Owner', 'createHorse'), false);
  assert.equal(hasRoleCapability('Sales Lead', 'createHorse'), false);
  assert.equal(hasRoleCapability('Medical Lead', 'createHorse'), false);
  assert.equal(hasRoleCapability('Medical Lead', 'editHorse'), false);

  assert.equal(hasRoleCapability('Owner', 'editHorse'), true);
  assert.equal(hasRoleCapability('Sales Lead', 'editHorse'), true);
});

/*
 * The database copy. xbar_has_workspace_capability carries the same matrix as
 * VALUES rows so storage and table policies can ask "may this member do X?"
 * instead of "is this member an Admin?". It is the copy that RLS enforces, so
 * a grant there that the client withholds is reachable straight from the
 * browser with the anon key. The LATEST migration that defines the function is
 * the one in force, so that is the one compared.
 */
function latestCapabilityFunctionSql() {
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  let latest = null;
  for (const name of files) {
    const sql = readFileSync(new URL(name, dir), 'utf8');
    if (/create or replace function public\.xbar_has_workspace_capability\(/.test(sql)) latest = { name, sql };
  }
  assert.ok(latest, 'a migration must define xbar_has_workspace_capability');
  return latest;
}

function parseSqlCapabilityRows(sql) {
  const start = sql.indexOf('create or replace function public.xbar_has_workspace_capability(');
  const end = sql.indexOf('$$;', start);
  const body = sql.slice(start, end);
  const entries = {};
  for (const [, role, capability] of body.matchAll(/\('([^']+)',\s*'([^']+)'\)/g)) {
    (entries[role] ??= []).push(capability);
  }
  for (const role of Object.keys(entries)) entries[role].sort();
  assert.ok(Object.keys(entries).length > 0, 'the SQL capability rows must not parse empty');
  return entries;
}

test('the database capability matrix matches the client one exactly', () => {
  const client = parseRoleCapabilityMap('../../src/lib/permissions.ts');
  const { name, sql } = latestCapabilityFunctionSql();
  const database = parseSqlCapabilityRows(sql);

  // Escalation direction first: a database grant the client withholds.
  for (const [role, capabilities] of Object.entries(database)) {
    for (const capability of capabilities) {
      assert.ok(
        client[role]?.includes(capability),
        `${name} grants ${role} the capability ${capability}, which the client does not`,
      );
    }
  }
  assert.deepEqual(Object.keys(database).sort(), Object.keys(client).sort(), `${name} must define the same roles`);
  for (const role of Object.keys(client)) {
    assert.deepEqual(database[role], client[role], `${name}: role ${role} must carry identical capabilities`);
  }
});

test('the database capability check falls closed and is not callable anonymously', () => {
  const { sql } = latestCapabilityFunctionSql();
  const start = sql.indexOf('create or replace function public.xbar_has_workspace_capability(');
  const body = sql.slice(start, sql.indexOf('$$;', start));
  // Only an active membership counts, and only for the signed-in caller; an
  // unknown role matches no VALUES row and so is refused.
  assert.match(body, /m\.status = 'active'/);
  assert.match(body, /m\.user_id = auth\.uid\(\)/);
  assert.match(body, /join role_grants g on g\.role = m\.role/);
  assert.match(body, /and g\.capability = p_capability/);
  // The workspace owner holds what an Admin holds and nothing more: an unknown
  // or misspelled capability is refused for the owner too.
  assert.match(
    body,
    /exists \(select 1 from role_grants g where g\.role = 'Admin' and g\.capability = p_capability\)\s*and exists \(\s*select 1 from public\.workspaces w\s*where w\.id = p_workspace_id and w\.owner_user_id = auth\.uid\(\)/,
  );
  assert.match(sql, /revoke all on function public\.xbar_has_workspace_capability\(uuid, text\) from public;/);
  assert.match(sql, /revoke all on function public\.xbar_has_workspace_capability\(uuid, text\) from anon;/);
  assert.ok(!/grant execute on function public\.xbar_has_workspace_capability[^;]*\banon\b/.test(sql));
});

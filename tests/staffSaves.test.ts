import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { hasRoleCapability } from '../src/lib/permissions.js';

/*
 * Audit F04: the app let a Medical Lead add a treatment ("Medical event
 * added") while every cloud write required an Admin, so the work stayed on that
 * one device. Staff saves now reach the cloud, scoped by the database
 * (supabase/migrations/20261002120000_staff_write_policies.sql, proven by
 * supabase/checks/staff-writes.sql under real RLS in CI).
 *
 * The save path lives in modules the node runner cannot compile, so its
 * wiring is pinned to source; the matrix facts it relies on are asserted
 * against the real permissions module.
 */

test('the roles the policies are written for hold the capabilities the policies name', () => {
  // Medical Lead is the one staff role that edits horses without editHorse,
  // which is why the horse guard trigger exists at all.
  assert.equal(hasRoleCapability('Medical Lead', 'editHorse'), false);
  assert.equal(hasRoleCapability('Medical Lead', 'manageMedical'), true);
  for (const role of ['Ranch Manager', 'Sales Lead', 'Owner'] as const) {
    assert.equal(hasRoleCapability(role, 'editHorse'), true, `${role} edits horses directly`);
  }
  // Deleting a horse is Admin and Ranch Manager only -- the createHorse holders.
  assert.deepEqual(
    (['Admin', 'Ranch Manager', 'Owner', 'Medical Lead', 'Sales Lead'] as const).filter((role) =>
      hasRoleCapability(role, 'createHorse'),
    ),
    ['Admin', 'Ranch Manager'],
  );
});

test('a staff member is no longer refused at the door; the database decides per table', async () => {
  const cloud = await readFile('src/lib/cloudWorkspace.ts', 'utf8');
  assert.doesNotMatch(cloud, /Your ranch access is read-only\. Ask the ranch administrator/);
  assert.match(cloud, /memberRole = typeof membership\.role === 'string' \? membership\.role : '';/);
  // The ranch profile is skipped, not attempted, for anyone but an Admin --
  // its policy would refuse it and take every other change down with it.
  assert.match(
    cloud,
    /if \(memberRole !== 'Admin'\) \{\s*return \{ workspaceId, role: memberRole \};\s*\}[\s\S]*await writeConcurrentRow\(/,
  );
  // Push cloud deletes what this device lacks: Admin only.
  assert.match(cloud, /if \(options\.replace && role !== 'Admin'\) \{\s*throw new WorkspaceSaveAccessError\(/);
});

test('the store asks for createHorse wherever a horse is created or deleted', async () => {
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  const action = (name: string) =>
    store.slice(store.indexOf(`      ${name}: `), store.indexOf('\n      },', store.indexOf(`      ${name}: `)));
  assert.match(action('deleteHorse'), /requireRoleCapability\(get\(\)\.currentRole, 'createHorse'\)/);
  assert.match(
    action('createDocumentIntake'),
    /createHorseFromBatch \? requireRoleCapability\(get\(\)\.currentRole, 'createHorse'\) : undefined/,
    'creating horse profiles from a batch creates horses',
  );
  const documents = await readFile('src/routes/Documents.tsx', 'utf8');
  assert.match(documents, /disabled=\{!canUploadDocuments \|\| !canCreateHorses \|\| Boolean\(horseId\)\}/);
});

test('the migration scopes each table to the capabilities the store checks', async () => {
  const sql = await readFile('supabase/migrations/20261002120000_staff_write_policies.sql', 'utf8');
  const policy = (name: string) => {
    const start = sql.indexOf(`create policy "${name}"`);
    assert.ok(start > -1, `${name} must exist`);
    return sql.slice(start, sql.indexOf(';', start));
  };
  assert.match(policy('horses staff delete'), /'createHorse'/);
  assert.doesNotMatch(policy('horses staff delete'), /'editHorse'/, 'a Sales Lead must not delete horses');
  assert.match(policy('horses staff insert'), /xbar_record_exists\('horses', workspace_id, horse_id\)/);
  assert.match(policy('ranch assets staff insert'), /'manageAssets'/);
  assert.match(policy('sales leads staff insert'), /'manageSales'/);
  assert.match(policy('shared listings staff insert'), /'manageSharedAccess'/);
  assert.match(policy('workspace profiles managers'), /xbar_can_manage_workspace\(workspace_id\)/);
  assert.doesNotMatch(sql, /\bdrop\b/i, 'additive only');
  // The guard's allow-list: medical and document fields, nothing that names
  // or prices the horse.
  const allowed = sql.slice(sql.indexOf('allowed constant text[]'), sql.indexOf('];', sql.indexOf('allowed constant')));
  for (const key of ['medicalTimeline', 'documents', 'documentFacts']) assert.ok(allowed.includes(`'${key}'`));
  for (const key of ['name', 'gallery', 'ownership', 'insuredValue']) {
    assert.ok(!allowed.includes(`'${key}'`), `${key} must not be editable by a role without editHorse`);
  }
});

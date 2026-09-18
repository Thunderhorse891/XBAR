import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { authorizeImportRow, buildHorseUpdateFields, duplicateRegistrationRows } from '../../api/_lib/horses-import.js';
import { getCapabilityDeniedMessage, hasRoleCapability } from '../../api/_lib/permissions.js';

test('server horse import permissions match the intended create/edit role matrix', () => {
  const expectations = {
    Admin: { create: true, edit: true },
    'Ranch Manager': { create: true, edit: true },
    Owner: { create: false, edit: true },
    'Medical Lead': { create: false, edit: false },
    'Sales Lead': { create: false, edit: true },
  };

  for (const [role, expected] of Object.entries(expectations)) {
    assert.equal(hasRoleCapability(role, 'createHorse'), expected.create, `${role} createHorse`);
    assert.equal(hasRoleCapability(role, 'editHorse'), expected.edit, `${role} editHorse`);
  }

  assert.match(getCapabilityDeniedMessage('createHorse'), /cannot create horse records/i);
  assert.match(getCapabilityDeniedMessage('editHorse'), /cannot edit horse records/i);
});

test('partial CSV updates include only supplied columns and preserve omitted fields', () => {
  const header = { name: 0, registration_number: 1 };
  const fields = buildHorseUpdateFields(['UPDATED NAME', 'AQHA12345'], header);

  assert.deepEqual(fields, {
    name: 'UPDATED NAME',
    registration_number: 'AQHA12345',
  });
  assert.equal('breed' in fields, false);
  assert.equal('color' in fields, false);
  assert.equal('status' in fields, false);
  assert.equal('owner_name' in fields, false);
});

test('an explicitly present blank remains an intentional blank on update, except status', () => {
  const header = { name: 0, registration_number: 1, status: 2, owner_name: 3 };
  const fields = buildHorseUpdateFields(['STAR', '111111', '', ''], header);

  // A supplied blank owner_name is still an intentional clear.
  assert.equal(fields.owner_name, '');
  // status is the exception: a blank cell must not clear the stored lifecycle
  // state (the insert path defaults blank status to 'Active', never ''), so a
  // blank status is preserved by omitting it from the update.
  assert.equal('status' in fields, false);
});

test('a supplied non-empty status is still written on update', () => {
  const header = { name: 0, status: 1 };
  const fields = buildHorseUpdateFields(['STAR', 'Sold'], header);
  assert.equal(fields.status, 'Sold');
});

test('birthdate is normalized only when the birthdate column is supplied', () => {
  const supplied = buildHorseUpdateFields(['STAR', '9/7/2020'], { name: 0, birthdate: 1 });
  assert.equal(supplied.birthdate, '2020-09-07');

  const omitted = buildHorseUpdateFields(['STAR'], { name: 0 });
  assert.equal('birthdate' in omitted, false);
});

test('duplicate registration rows are identified before import writes', () => {
  const headerRow = ['Name', 'Registration Number'];
  const first = ['FIRST', '5551234'];
  const second = ['SECOND', '5551234'];
  const third = ['THIRD', '8889999'];
  const rows = [headerRow, first, second, third];

  const result = duplicateRegistrationRows([first, second, third], { name: 0, registration_number: 1 }, rows);

  assert.deepEqual(result.duplicates, [['5551234', [2, 3]]]);
  assert.deepEqual([...result.registrationRows.keys()], ['5551234', '8889999']);
});

// The per-row authorization guarantee lives in authorizeImportRow, tested
// directly below. This case pins that the handler actually routes every write
// through it before touching the database, and that ordinary Supabase errors
// are handled before the success counters increment.
test('horse import authorizes every row and handles Supabase errors before success counters', async () => {
  const source = await readFile(new URL('../../api/_lib/horses-import.js', import.meta.url), 'utf8');

  const rowGate = source.indexOf('const decision = authorizeImportRow(');
  const firstWrite = Math.min(source.indexOf('.update({ ...fields'), source.indexOf(".from('horses').insert({"));

  assert.ok(rowGate >= 0 && rowGate < firstWrite, 'every row must be authorized before any write');

  const lookupError = source.indexOf('if (lookupError)');
  const updateError = source.indexOf('if (updateError)');
  const insertError = source.indexOf('if (insertError)');
  const updatedIncrement = source.indexOf('updated += 1');
  const importedIncrement = source.indexOf('imported += 1');

  assert.ok(lookupError >= 0, 'lookup errors must be handled explicitly');
  assert.ok(updateError >= 0 && updateError < updatedIncrement, 'update errors must be handled before success count');
  assert.ok(insertError >= 0 && insertError < importedIncrement, 'insert errors must be handled before success count');
  assert.match(source, /existingRowsError/);
  assert.match(source, /partial:\s*errors\.length > 0/);
});

// The bug this closes: the capability/capacity gate was decided from the
// preflight plan, but insert-vs-update is decided per row from a live lookup.
// A planned update that races to an insert (registration deleted/re-registered
// after the preflight) let a role with editHorse but not createHorse create a
// horse, outside the plan's capacity limit. authorizeImportRow is the guard,
// re-run per row against the live `existing` value.
test('a row that races from a planned update to an insert is denied for a role without createHorse', () => {
  // Owner holds editHorse but not createHorse (asserted in the matrix test above).
  const decision = authorizeImportRow({ existing: null, role: 'Owner', insertsSoFar: 0, insertBudget: 100 });
  assert.equal(decision.action, 'insert');
  assert.match(decision.denied, /cannot create horse records/i);
});

test('the same race is denied for Sales Lead, which also lacks createHorse', () => {
  const decision = authorizeImportRow({ existing: null, role: 'Sales Lead', insertsSoFar: 0, insertBudget: 100 });
  assert.match(decision.denied, /cannot create horse records/i);
});

test('a surprise insert past the plan capacity budget is refused even for a creator role', () => {
  const decision = authorizeImportRow({ existing: null, role: 'Ranch Manager', insertsSoFar: 5, insertBudget: 5 });
  assert.equal(decision.capacityExceeded, true);
  assert.equal(decision.denied, null);
});

test('a creator role within budget is allowed to insert', () => {
  const decision = authorizeImportRow({ existing: null, role: 'Admin', insertsSoFar: 0, insertBudget: 3 });
  assert.equal(decision.action, 'insert');
  assert.equal(decision.denied, null);
  assert.ok(!decision.capacityExceeded);
});

test('an existing row is authorized as an update by editHorse, independent of the plan', () => {
  const decision = authorizeImportRow({
    existing: { horse_id: 'h1' },
    role: 'Sales Lead',
    insertsSoFar: 0,
    insertBudget: 0,
  });
  assert.equal(decision.action, 'update');
  assert.equal(decision.denied, null);
});

test('an update is denied for a role without editHorse', () => {
  const decision = authorizeImportRow({
    existing: { horse_id: 'h1' },
    role: 'Medical Lead',
    insertsSoFar: 0,
    insertBudget: 0,
  });
  assert.equal(decision.action, 'update');
  assert.match(decision.denied, /cannot edit horse records/i);
});

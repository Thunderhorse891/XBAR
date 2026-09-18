import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { buildHorseUpdateFields, duplicateRegistrationRows } from '../../api/_lib/horses-import.js';
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

test('an explicitly present blank remains an intentional blank on update', () => {
  const header = { name: 0, registration_number: 1, status: 2, owner_name: 3 };
  const fields = buildHorseUpdateFields(['STAR', '111111', '', ''], header);

  assert.equal(fields.status, '');
  assert.equal(fields.owner_name, '');
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

test('horse import checks authorization and ordinary Supabase errors before success counters', async () => {
  const source = await readFile(new URL('../../api/_lib/horses-import.js', import.meta.url), 'utf8');

  const createGate = source.indexOf("requireRoleCapability(access.role, 'createHorse')");
  const editGate = source.indexOf("requireRoleCapability(access.role, 'editHorse')");
  const firstWrite = Math.min(source.indexOf('.update({ ...fields'), source.indexOf(".from('horses').insert({"));

  assert.ok(createGate >= 0 && createGate < firstWrite, 'create capability must be checked before writes');
  assert.ok(editGate >= 0 && editGate < firstWrite, 'edit capability must be checked before writes');

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

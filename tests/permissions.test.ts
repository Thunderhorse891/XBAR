import assert from 'node:assert/strict';
import test from 'node:test';
import { getCapabilityDeniedMessage, hasRoleCapability } from '../src/lib/permissions.js';

test('admin has access to billing and settings capabilities', () => {
  assert.equal(hasRoleCapability('Admin', 'manageBilling'), true);
  assert.equal(hasRoleCapability('Admin', 'manageSettings'), true);
});

test('owner remains read-only for sensitive workflows', () => {
  assert.equal(hasRoleCapability('Owner', 'manageOwnership'), false);
  assert.equal(hasRoleCapability('Owner', 'manageSales'), false);
  assert.equal(hasRoleCapability('Owner', 'uploadDocuments'), true);
});

test('denied message is stable for ownership controls', () => {
  assert.equal(getCapabilityDeniedMessage('manageOwnership'), 'This role cannot change ownership data.');
});

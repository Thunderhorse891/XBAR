import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('first workspace setup keeps the creator in the billing-capable admin role', () => {
  const source = readFileSync('src/store/useXbarStore.ts', 'utf8');

  assert.match(source, /createdInitialAdmin = seedState\.workspaceMembers\.length === 0/);
  assert.match(source, /currentRole: createdInitialAdmin \? 'Admin' : current\.currentRole/);
});

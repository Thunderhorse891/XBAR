import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWorkspaceProfileDefaults } from '../src/lib/workspaceSetupDefaults.js';

const blank = {
  businessName: 'XBAR LLC',
  ranchName: 'Primary Ranch',
  ranchManagerName: '',
  operationsEmail: '',
  defaultOwnerName: '',
  defaultOwnerEntity: '',
  defaultBarn: '',
  defaultPasture: '',
};

test('an unfilled optional field gets a usable default, not an empty string', () => {
  const profile = applyWorkspaceProfileDefaults(blank);
  assert.equal(profile.ranchManagerName, 'Operations Lead');
  assert.equal(profile.operationsEmail, 'owner@ranch.local');
  assert.equal(profile.defaultBarn, 'Barn 1');
  assert.equal(profile.defaultPasture, 'Pasture 1');
});

test('the owner defaults fall back to the ranch and the business, which is what the horse form needs', () => {
  const profile = applyWorkspaceProfileDefaults(blank);
  assert.equal(profile.defaultOwnerName, 'Primary Ranch');
  assert.equal(profile.defaultOwnerEntity, 'XBAR LLC');
  assert.notEqual(profile.defaultOwnerEntity, '', 'an empty owner entity is what blocked the first horse');
});

test('anything the customer actually typed wins over the fallback', () => {
  const profile = applyWorkspaceProfileDefaults({
    ...blank,
    ranchManagerName: 'Erin Swyrick',
    operationsEmail: 'erin@example.test',
    defaultOwnerName: 'Erin Swyrick',
    defaultOwnerEntity: 'Swyrick Quarter Horses',
    defaultBarn: 'North Barn',
    defaultPasture: 'North 40',
  });
  assert.equal(profile.ranchManagerName, 'Erin Swyrick');
  assert.equal(profile.operationsEmail, 'erin@example.test');
  assert.equal(profile.defaultOwnerName, 'Erin Swyrick');
  assert.equal(profile.defaultOwnerEntity, 'Swyrick Quarter Horses');
  assert.equal(profile.defaultBarn, 'North Barn');
  assert.equal(profile.defaultPasture, 'North 40');
});

test('whitespace is treated as unfilled', () => {
  const profile = applyWorkspaceProfileDefaults({ ...blank, defaultOwnerEntity: '   ', defaultBarn: '\t' });
  assert.equal(profile.defaultOwnerEntity, 'XBAR LLC');
  assert.equal(profile.defaultBarn, 'Barn 1');
});

/*
 * The two required fields are deliberately NOT defaulted. `initializeWorkspace`
 * refuses a workspace without them, and inventing a business name for someone
 * who left it blank would defeat that check -- it would create a ranch called
 * something the customer never typed. Quick-start supplies its own placeholders
 * before calling this, which is why they arrive already decided.
 */
test('business and ranch name are passed through, never invented', () => {
  const profile = applyWorkspaceProfileDefaults({ ...blank, businessName: '', ranchName: '' });
  assert.equal(profile.businessName, '', 'a blank business name must stay blank for initializeWorkspace to refuse it');
  assert.equal(profile.ranchName, '');
});

test('they are trimmed, so a space-only name does not pass the required check', () => {
  const profile = applyWorkspaceProfileDefaults({ ...blank, businessName: '  XBAR LLC  ', ranchName: '   ' });
  assert.equal(profile.businessName, 'XBAR LLC');
  assert.equal(profile.ranchName, '');
});

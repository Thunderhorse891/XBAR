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

/*
 * The first version of this shared the whole quick-start ladder and invented
 * an operations email of `owner@ranch.local`. That address is printed into
 * generated documents as "Operations email" and "Scheduling contact", it is
 * the recipient of the Reminders alert-digest mail link, and
 * `initializeWorkspace` writes it onto the workspace member record -- so the
 * product published contact details for a mailbox that does not exist, as
 * though the customer had supplied them. An absent address must stay absent.
 */
test('an omitted operations email is never invented', () => {
  const profile = applyWorkspaceProfileDefaults(blank);
  assert.equal(profile.operationsEmail, '', 'a manufactured address reaches documents, mailto links and member rows');
});

/*
 * The other three were unnecessary for a different reason: their consumers
 * already degrade honestly on a blank ('Unassigned' for the manager, 'Main
 * Barn' and 'North Pasture' as form placeholders), so filling them here
 * replaced an honest absence with stored data that only looked real.
 */
test('the manager, barn and pasture are left blank for their consumers to handle', () => {
  const profile = applyWorkspaceProfileDefaults(blank);
  assert.equal(profile.ranchManagerName, '');
  assert.equal(profile.defaultBarn, '');
  assert.equal(profile.defaultPasture, '');
});

test('the owner defaults fall back to the ranch and the business, which is what the horse form needs', () => {
  const profile = applyWorkspaceProfileDefaults(blank);
  assert.equal(profile.defaultOwnerName, 'Primary Ranch');
  assert.equal(profile.defaultOwnerEntity, 'XBAR LLC');
  assert.notEqual(profile.defaultOwnerEntity, '', 'an empty owner entity is what blocked the first horse');
});

test('every field the customer typed is preserved, including the ones never defaulted', () => {
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

test('whitespace is treated as unfilled, and trimmed away rather than stored', () => {
  const profile = applyWorkspaceProfileDefaults({
    ...blank,
    defaultOwnerEntity: '   ',
    defaultBarn: '\t',
    operationsEmail: '  ',
  });
  assert.equal(profile.defaultOwnerEntity, 'XBAR LLC', 'a derived value still fills from what was typed');
  assert.equal(profile.defaultBarn, '', 'a field with nothing to derive from stays empty');
  assert.equal(profile.operationsEmail, '');
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

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSubmitHorseCreate,
  horseCreateFieldErrors,
  type HorseCreateFormFields,
} from '../src/lib/horseCreateGate.js';
import { applyWorkspaceProfileDefaults } from '../src/lib/workspaceSetupDefaults.js';

const complete: HorseCreateFormFields = {
  name: 'Zephyr Audit',
  barnName: 'Main Barn',
  owner: 'Erin Swyrick',
  ownerEntity: 'XBAR LLC',
};

// ---------------------------------------------------------------- the gate

test('a complete form submits', () => {
  assert.deepEqual(horseCreateFieldErrors(complete), {});
  assert.equal(canSubmitHorseCreate(complete), true);
});

/*
 * The reported defect, stated as the customer met it: every field they were
 * shown is filled, the button is enabled, and the submit is refused for a
 * field the button never looked at. The gate and the refusal must agree.
 */
test('the button refuses exactly what the handler refuses -- owner entity included', () => {
  const missingEntity = { ...complete, ownerEntity: '' };
  assert.deepEqual(horseCreateFieldErrors(missingEntity), { ownerEntity: 'Owner entity is required.' });
  assert.equal(
    canSubmitHorseCreate(missingEntity),
    false,
    'an empty owner entity blocked the handler, so it must block the button',
  );
});

test('the gate and the handler never disagree, across every combination of the four fields', () => {
  const values: Record<keyof HorseCreateFormFields, string[]> = {
    // Each list crosses this field's own threshold: empty, too short, long enough.
    name: ['', 'Ze', 'Zephyr'],
    barnName: ['', ' ', 'Main Barn'],
    owner: ['', 'E', 'Erin'],
    ownerEntity: ['', 'X', 'XBAR LLC'],
  };
  let checked = 0;
  for (const name of values.name)
    for (const barnName of values.barnName)
      for (const owner of values.owner)
        for (const ownerEntity of values.ownerEntity) {
          const form = { name, barnName, owner, ownerEntity };
          const errors = horseCreateFieldErrors(form);
          assert.equal(
            canSubmitHorseCreate(form),
            Object.keys(errors).length === 0,
            `gate and handler disagreed on ${JSON.stringify(form)}`,
          );
          checked += 1;
        }
  assert.equal(checked, 81);
});

test('the length thresholds are the handler thresholds, not merely non-empty', () => {
  assert.equal(canSubmitHorseCreate({ ...complete, name: 'Ze' }), false, 'a registered name under three characters');
  assert.equal(canSubmitHorseCreate({ ...complete, owner: 'E' }), false, 'a legal owner under two characters');
  assert.equal(canSubmitHorseCreate({ ...complete, ownerEntity: 'X' }), false, 'an owner entity under two characters');
});

test('whitespace is not content', () => {
  assert.equal(canSubmitHorseCreate({ name: '   ', barnName: '  ', owner: '  ', ownerEntity: '  ' }), false);
});

// -------------------------------------------------- the two paths together

/*
 * The end-to-end shape of the reported failure: a customer fills only the two
 * required setup fields, then opens the horse form seeded from that profile.
 * Before the ladder reached `handleSubmit`, the seed was blank and the create
 * was refused. This asserts the outcome -- the first horse can be created --
 * rather than the mechanism that gets there.
 */
test('a minimal setup still yields a workspace a first horse can be created in', () => {
  const profile = applyWorkspaceProfileDefaults({
    businessName: 'XBAR LLC',
    ranchName: 'Primary Ranch',
    ranchManagerName: '',
    operationsEmail: '',
    defaultOwnerName: '',
    defaultOwnerEntity: '',
    defaultBarn: '',
    defaultPasture: '',
  });

  const seeded: HorseCreateFormFields = {
    name: 'Zephyr Audit',
    barnName: 'Main Barn',
    owner: profile.defaultOwnerName,
    ownerEntity: profile.defaultOwnerEntity,
  };
  assert.equal(canSubmitHorseCreate(seeded), true, 'the first horse was refused after a minimal setup');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { interactionHint, sanitizeSurfaceModes, transitionSurfaceMode } from '../src/lib/interactionState.js';

test('surface state transitions are explicit and reversible', () => {
  assert.equal(transitionSurfaceMode('expanded', 'collapse'), 'collapsed');
  assert.equal(transitionSurfaceMode('collapsed', 'toggle'), 'expanded');
  assert.equal(transitionSurfaceMode('expanded', 'detail'), 'detailed');
  assert.equal(transitionSurfaceMode('detailed', 'focus'), 'focus');
  assert.equal(transitionSurfaceMode('focus', 'expand'), 'expanded');
});

test('remembered surface state rejects unknown values', () => {
  assert.deepEqual(sanitizeSurfaceModes({ care: 'expanded', bad: 'open', empty: null }), { care: 'expanded' });
});

test('interaction hints explain keyboard actions', () => {
  assert.match(interactionHint(true), /Shift\+F10/);
  assert.doesNotMatch(interactionHint(false), /Shift\+F10/);
});

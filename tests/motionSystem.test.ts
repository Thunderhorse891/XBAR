import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';

// The motion system is the single source of truth for interaction motion, so it
// carries forward to every new feature automatically. These are contract tests:
// they fail loudly if the tokens, utilities, reduced-motion guard, wiring, or
// import are ever dropped — the things that would silently break "it applies
// everywhere" or the accessibility promise.

const fromRoot = (filePath: string) => path.resolve(process.cwd(), filePath);
const motionSource = await readFile(fromRoot('src/styles/motion.css'), 'utf8');
const mainSource = await readFile(fromRoot('src/main.tsx'), 'utf8');
const indexCssSource = await readFile(fromRoot('src/index.css'), 'utf8');

test('motion tokens are defined in one place', () => {
  for (const token of [
    '--motion-fast',
    '--motion-base',
    '--motion-slow',
    '--ease-standard',
    '--ease-emphasized',
    '--motion-lift',
    '--motion-press',
  ]) {
    assert.match(motionSource, new RegExp(`${token}\\s*:`), `missing motion token ${token}`);
  }
});

test('the reusable motion utilities exist so features can adopt them', () => {
  for (const utility of ['.motion-lift', '.motion-press', '.motion-in', '.motion-stagger', '.motion-glow']) {
    assert.ok(motionSource.includes(utility), `missing motion utility ${utility}`);
  }
  assert.match(motionSource, /@keyframes xbar-motion-in/);
});

test('every utility collapses under prefers-reduced-motion (accessibility)', () => {
  assert.match(motionSource, /@media \(prefers-reduced-motion: reduce\)/);
  const guard = motionSource.slice(motionSource.indexOf('prefers-reduced-motion'));
  for (const utility of ['.motion-lift', '.motion-press', '.motion-in', '.motion-stagger', '.motion-glow']) {
    assert.ok(guard.includes(utility), `${utility} is not neutralized under reduced motion`);
  }
  assert.match(guard, /animation:\s*none\s*!important/);
  assert.match(guard, /transition:\s*none\s*!important/);
});

test('entrance animations do not retain a transform (fixed descendants stay viewport-anchored)', () => {
  // A persisted transform (forwards/both fill) turns the animated element into a
  // containing block for position:fixed children — breaking slide-over drawers.
  // The entrance utilities must use `backwards` fill so the transform clears.
  const entranceRules = motionSource.match(/animation:\s*xbar-motion-in[^;]*/g) ?? [];
  assert.ok(entranceRules.length >= 2, 'expected .motion-in and .motion-stagger entrance animations');
  for (const rule of entranceRules) {
    assert.doesNotMatch(rule, /\b(forwards|both)\b/, `entrance animation must not retain its transform: "${rule}"`);
    assert.match(rule, /\bbackwards\b/, `entrance animation should use backwards fill: "${rule}"`);
  }
});

test('the motion system is imported globally exactly once', () => {
  const matches = mainSource.match(/import '\.\/styles\/motion\.css'/g) ?? [];
  assert.equal(matches.length, 1, 'motion.css must be imported once in main.tsx');
});

test('base controls are wired to the motion tokens (so all buttons inherit it)', () => {
  // The .button base transition references the motion tokens rather than
  // hand-rolled durations, and reduced motion neutralizes the button transform.
  assert.match(indexCssSource, /transition:\s*[^;]*var\(--motion-fast/);
  assert.match(motionSource, /\.button:hover,\s*\n?\s*\.button:active/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const pinnedVersion = readFileSync('.nvmrc', 'utf8').trim();
const ciVersions = [...ci.matchAll(/node-version:\s*['"]?(\d+)(?:['"]?\s|$)/g)].map((match) => match[1]);

// The supported minimum follows the runtime exercised by the complete CI
// suite. In particular, Node 20 cannot run the pinned Capacitor 8 toolchain.
test('local Node selection matches the runtime tested by CI', () => {
  assert.ok(ciVersions.length > 0, 'The CI Node version must remain inspectable');
  for (const version of ciVersions) assert.equal(pinnedVersion, version);
});

test('the declared Node minimum follows the tested CI major', () => {
  assert.ok(ciVersions.length > 0, 'The CI Node version must remain inspectable');
  for (const version of ciVersions) assert.equal(pkg.engines.node, `>=${version}.0.0`);
});

test('the lockfile preserves the declared Node runtime and regression registration', () => {
  assert.deepEqual(lock.packages[''].engines, pkg.engines);
  assert.match(pkg.scripts.test, /(?:^|&&\s*)node --test tests\/nodeRuntime\.test\.mjs(?:\s*&&|$)/);
});

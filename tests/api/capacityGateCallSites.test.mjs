import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/*
 * Every capacity check must be acted on, at every call site.
 *
 * tests/api/capacityGateFailClosed.test.mjs proves the gates themselves refuse
 * when usage cannot be read. That is only half the guarantee: a gate that
 * returns `{ ok: false }` still enforces nothing if its caller ignores the flag
 * and reads `used` anyway.
 *
 * That is not hypothetical. `documents-bulk-upload.js` calls checkHorseCapacity
 * twice. `commitAssignments` checked `.ok`; `processBatch` did not, and computed
 *
 *     horseSlotsLeft = horseLimit - (horseCapacity.used ?? 0)
 *
 * so a failed count handed an auto-creating OCR batch a full fresh allowance —
 * reading "usage unknown" as "usage zero", the exact failure the gates exist to
 * prevent, one layer above where it was fixed.
 *
 * A per-call-site check is what catches the second occurrence. Adding a new
 * capacity call and forgetting the guard fails here rather than in production.
 */

const repoRoot = process.cwd();
const apiDir = path.join(repoRoot, 'api');

const CAPACITY_FUNCTIONS = [
  'checkDocumentCapacity',
  'checkHorseCapacity',
  'checkSalePacketCapacity',
  'checkSeatCapacity',
  'checkStorageCapacity',
];

function jsFilesUnder(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return jsFilesUnder(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

/** Every `const <name> = await check…Capacity(` in api/, with where it appeared. */
function capacityCallSites() {
  const pattern = new RegExp(`const\\s+(\\w+)\\s*=\\s*await\\s+(${CAPACITY_FUNCTIONS.join('|')})\\s*\\(`, 'g');

  return jsFilesUnder(apiDir).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(pattern)].map((match) => ({
      file: path.relative(repoRoot, file),
      variable: match[1],
      fn: match[2],
      line: source.slice(0, match.index).split('\n').length,
      after: source.slice(match.index),
    }));
  });
}

const callSites = capacityCallSites();

test('the capacity call sites are discovered, not assumed', () => {
  // Guards the test itself: a rename or refactor that stops matching would
  // otherwise leave this file passing while checking nothing at all.
  assert.ok(callSites.length >= 9, `expected to find the known capacity call sites, found ${callSites.length}`);

  const covered = new Set(callSites.map((site) => site.fn));
  for (const fn of CAPACITY_FUNCTIONS) {
    assert.ok(covered.has(fn), `${fn} has no call site in api/ — update this list or the callers`);
  }
});

for (const site of callSites) {
  test(`${site.file}:${site.line} acts on the result of ${site.fn}`, () => {
    const guard = site.after.indexOf(`!${site.variable}.ok`);
    assert.notEqual(guard, -1, `${site.variable} is never checked for .ok, so a refused gate is ignored`);

    // Order matters as much as presence: consuming `used` before the guard is
    // how a failed read becomes zero usage.
    const consumesUsed = site.after.indexOf(`${site.variable}.used`);
    if (consumesUsed !== -1) {
      assert.ok(
        guard < consumesUsed,
        `${site.variable}.used is read before the .ok guard, so an unreadable count becomes a full allowance`,
      );
    }
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('CI rejects a thirteenth function, includes nested entries, excludes helper trees', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xbar-functions-'));
  try {
    mkdirSync(path.join(root, '_lib/deep'), { recursive: true });
    writeFileSync(path.join(root, '_lib/deep/helper.js'), '');
    mkdirSync(path.join(root, 'nested'));
    for (let i = 0; i < 12; i++) writeFileSync(path.join(root, `nested/${i}.js`), '');
    const run = () => spawnSync(process.execPath, ['scripts/check-function-budget.mjs', root], { encoding: 'utf8' });
    assert.equal(run().status, 0);
    writeFileSync(path.join(root, 'extra.ts'), '');
    assert.equal(run().status, 1);
    assert.match(run().stdout, /13.*12/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unused horses/documents dispatchers do not consume function slots or have frontend callers', () => {
  assert.equal(existsSync('api/horses/[action].js'), false);
  assert.equal(existsSync('api/documents/[action].js'), false);
  for (const file of readdirSync('src', { recursive: true })) {
    if (/\.(ts|tsx|js)$/.test(file)) {
      assert.doesNotMatch(readFileSync(path.join('src', file), 'utf8'), /\/api\/(horses|documents)(?:\/|[?'"`])/);
    }
  }
});

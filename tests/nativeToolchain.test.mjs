import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const xcode = require('xcode');
// Resolve from xcode itself: a separate top-level UUID would not protect the CLI.
const xcodeRequire = createRequire(require.resolve('xcode'));
const uuid = xcodeRequire('uuid');

test('the UUID used by xcode rejects out-of-bounds name-based UUID writes', () => {
  for (const generate of [uuid.v3, uuid.v5]) {
    for (const [size, offset] of [
      [8, 4],
      [16, -1],
      [16, 1],
    ]) {
      const buffer = new Uint8Array(size).fill(170);
      assert.throws(() => generate('xbar', uuid.v5.DNS, buffer, offset), RangeError);
      assert.ok(
        buffer.every((value) => value === 170),
        'failed writes must preserve the buffer',
      );
    }
    const buffer = new Uint8Array(16);
    assert.equal(generate('xbar', uuid.v5.DNS, buffer, 0), buffer);
    assert.ok(uuid.validate(uuid.stringify(buffer)));
  }
});

test('xcode retains CommonJS UUID generation and project parse/write compatibility', () => {
  const source = new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url);
  const original = readFileSync(source, 'utf8');
  const project = xcode.project(fileURLToPath(source)).parseSync();
  const existingIds = new Set(project.allUuids());
  const generated = new Set();
  for (let index = 0; index < 100; index += 1) {
    const id = project.generateUuid();
    assert.match(id, /^[A-F0-9]{24}$/);
    assert.ok(!existingIds.has(id));
    assert.ok(!generated.has(id));
    generated.add(id);
  }
  const directory = mkdtempSync(join(tmpdir(), 'xbar-xcode-'));
  try {
    const output = join(directory, 'project.pbxproj');
    writeFileSync(output, project.writeSync());
    const reparsed = xcode.project(output).parseSync();
    assert.deepEqual(reparsed.hash, project.hash);
    assert.equal(readFileSync(source, 'utf8'), original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

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

test('xcode retains CommonJS UUID generation and project parse/write compatibility', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xbar xcode '));
  try {
    // Exercise the project shipped in the
    // pinned official CLI, using the CLI's own portable archive dependency.
    const cliPackage = require.resolve('@capacitor/cli/package.json');
    const cliRequire = createRequire(cliPackage);
    const archive = join(dirname(cliPackage), 'assets', 'ios-spm-template.tar.gz');
    const relativeProject = 'App/App.xcodeproj/project.pbxproj';
    await cliRequire('tar').extract({ file: archive, cwd: directory }, [relativeProject]);
    const source = join(directory, relativeProject);
    const original = readFileSync(source, 'utf8');
    const project = xcode.project(source).parseSync();
    const existingIds = new Set(project.allUuids());
    const generated = new Set();
    for (let index = 0; index < 100; index += 1) {
      const id = project.generateUuid();
      assert.match(id, /^[A-F0-9]{24}$/);
      assert.ok(!existingIds.has(id));
      assert.ok(!generated.has(id));
      generated.add(id);
    }
    const output = join(directory, 'roundtrip.pbxproj');
    writeFileSync(output, project.writeSync());
    const reparsed = xcode.project(output).parseSync();
    assert.deepEqual(reparsed.hash, project.hash);
    assert.equal(readFileSync(source, 'utf8'), original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the tracked Xcode project roundtrips and includes its app privacy resource and UI test target', () => {
  const source = 'ios/App/App.xcodeproj/project.pbxproj';
  const directory = mkdtempSync(join(tmpdir(), 'xbar tracked xcode '));
  try {
    const project = xcode.project(source).parseSync();
    const output = join(directory, 'roundtrip.pbxproj');
    writeFileSync(output, project.writeSync());
    assert.deepEqual(xcode.project(output).parseSync().hash, project.hash);
    const resources = project.hash.project.objects.PBXResourcesBuildPhase;
    const appTarget = Object.values(project.hash.project.objects.PBXNativeTarget).find(
      (target) => typeof target === 'object' && target.name === 'App',
    );
    assert.ok(appTarget);
    const appResources = appTarget.buildPhases.map(({ value }) => resources[value]).find(Boolean);
    assert.ok(appResources?.files.some(({ comment }) => comment === 'PrivacyInfo.xcprivacy in Resources'));
    const scheme = readFileSync('ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme', 'utf8');
    assert.match(scheme, /<TestableReference skipped="NO">.*BlueprintName="AppUITests"/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the native app icon and splash reuse current brand bytes', () => {
  assert.deepEqual(
    readFileSync('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'),
    readFileSync('public/brand/xbar-app-icon.png'),
  );
  assert.deepEqual(
    readFileSync('ios/App/App/Assets.xcassets/Splash.imageset/xbar-report-horse.png'),
    readFileSync('public/brand/xbar-report-horse.png'),
  );
});

test('local tools, package metadata, and release CI all select one Node major', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const major = read('../.nvmrc').trim();
  assert.equal(major, '24');
  assert.equal(JSON.parse(read('../package.json')).engines.node, major + '.x');
  assert.equal(JSON.parse(read('../package-lock.json')).packages[''].engines.node, major + '.x');
  for (const workflow of ['ci', 'manual-test', 'recovery-db-verification', 'ios']) {
    assert.match(read('../.github/workflows/' + workflow + '.yml'), /node-version-file: '\.nvmrc'/);
  }
});

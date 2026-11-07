import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  __resetCloudDeletionMemory,
  acknowledgeCloudDeletions,
  clearCloudDeletions,
  idsToRemove,
  pendingCloudDeletions,
  queueCloudDeletions,
} from '../src/lib/cloudDeletionQueue.js';

/*
 * Audit F01: a cloud save deleted every row the saving device did not have.
 *
 * Two phones on one ranch: phone B loaded at 9:00, phone A added a horse at
 * 9:30, phone B saved a note at 9:45 -- and the horse was gone for everyone,
 * because B's copy did not contain it. A CSV import written server-side went
 * the same way on the next save from any open device. Nobody deleted those
 * records; the device simply had not seen them.
 */

function installStorage() {
  const backing = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
      removeItem: (key: string) => void backing.delete(key),
    },
  };
  __resetCloudDeletionMemory();
  return backing;
}

test('a row the device merely lacks is never removed by an ordinary save', () => {
  // The cloud holds A, B and the horse another phone added; this device has A and B.
  const removed = idsToRemove({ mode: 'listed', ids: [] }, new Set(['horse-a', 'horse-b']), [
    'horse-a',
    'horse-b',
    'horse-added-elsewhere',
  ]);
  assert.deepEqual(removed, [], 'absence is not a deletion');
});

test('an ordinary save removes exactly what a person deleted', () => {
  assert.deepEqual(idsToRemove({ mode: 'listed', ids: ['horse-sold'] }, new Set(['horse-a'])), ['horse-sold']);
});

test('a deleted id that is being written again is kept -- the row being saved wins', () => {
  assert.deepEqual(idsToRemove({ mode: 'listed', ids: ['horse-a'] }, new Set(['horse-a'])), []);
});

test('only an explicit Push cloud removes by absence', () => {
  assert.deepEqual(
    idsToRemove({ mode: 'absent' }, new Set(['horse-a']), ['horse-a', 'horse-added-elsewhere']),
    ['horse-added-elsewhere'],
    'the person chose "make the cloud match this device"',
  );
});

test('empty and repeated ids never reach a delete', () => {
  assert.deepEqual(idsToRemove({ mode: 'listed', ids: ['', 'x', 'x'] }, new Set()), ['x']);
});

test('queued deletions survive a reload and are deduplicated', () => {
  const backing = installStorage();
  queueCloudDeletions([
    { table: 'horses', id: 'horse-1' },
    { table: 'horses', id: 'horse-1' },
    { table: 'sales_leads', id: 'lead-1' },
  ]);
  __resetCloudDeletionMemory(); // a reload: memory gone, storage remains
  assert.deepEqual(pendingCloudDeletions(), [
    { table: 'horses', id: 'horse-1' },
    { table: 'sales_leads', id: 'lead-1' },
  ]);
  assert.ok(backing.get('xbar-cloud-deletions'));
});

test('acknowledging removes only what the save carried', () => {
  installStorage();
  queueCloudDeletions([{ table: 'horses', id: 'horse-1' }]);
  const sent = pendingCloudDeletions();
  // Deleted while that save was in flight -- not in it, so it must stay queued.
  queueCloudDeletions([{ table: 'ranch_assets', id: 'asset-1' }]);
  acknowledgeCloudDeletions(sent);
  assert.deepEqual(pendingCloudDeletions(), [{ table: 'ranch_assets', id: 'asset-1' }]);
});

test('malformed or foreign entries in storage are ignored, not sent', () => {
  const backing = installStorage();
  backing.set(
    'xbar-cloud-deletions',
    JSON.stringify([
      { table: 'horses', id: 'ok' },
      { table: 'workspace_memberships', id: 'not-a-record-table' },
      { table: 'horses', id: '' },
      'junk',
    ]),
  );
  assert.deepEqual(pendingCloudDeletions(), [{ table: 'horses', id: 'ok' }]);
  backing.set('xbar-cloud-deletions', '{not json');
  __resetCloudDeletionMemory();
  assert.deepEqual(pendingCloudDeletions(), []);
});

test('clearing forgets every queued deletion', () => {
  installStorage();
  queueCloudDeletions([{ table: 'horses', id: 'horse-1' }]);
  clearCloudDeletions();
  __resetCloudDeletionMemory();
  assert.deepEqual(pendingCloudDeletions(), []);
});

test('blocked storage still holds the queue for the life of the page', () => {
  (globalThis as { window?: unknown }).window = {
    get localStorage(): never {
      throw new Error('SecurityError');
    },
  };
  __resetCloudDeletionMemory();
  queueCloudDeletions([{ table: 'horses', id: 'horse-1' }]);
  assert.deepEqual(pendingCloudDeletions(), [{ table: 'horses', id: 'horse-1' }]);
});

/*
 * The call sites live in modules the node runner cannot compile (Vite's `@/`
 * alias), so their wiring is pinned to source. Each assertion names the
 * behaviour it protects.
 */
test('every relational table save states its removal mode, and only Push cloud asks for absence', async () => {
  const cloud = await readFile('src/lib/cloudWorkspace.ts', 'utf8');
  const calls = cloud.match(/await replaceWorkspaceRows\(\{[\s\S]*?\n {4}\}\);/g) ?? [];
  assert.equal(calls.length, 8, 'eight relational tables');
  for (const call of calls) {
    assert.match(call, /removal: removal\('[a-z_]+'\)/, `a table save without a removal mode:\n${call.slice(0, 80)}`);
  }
  assert.match(cloud, /options\.replace\s*\?\s*\{ mode: 'absent' \}/, 'absence only when replace was asked for');
  assert.match(
    cloud,
    /if \(removal\.mode === 'absent'\) \{\s*if \(params\.overwriteContext\) await verifyReplacementContext\(params\.overwriteContext\);\s*const \{ data: existingRows/,
    'the cloud ids are read only for a replace',
  );

  const sources = await Promise.all(
    [
      'src/components/CloudBootstrap.tsx',
      'src/routes/Settings.tsx',
      'src/routes/SetupWorkspace.tsx',
      'src/store/useXbarStore.ts',
    ].map(async (path) => [path, await readFile(path, 'utf8')] as const),
  );
  const replacing = sources
    .filter(([, source]) => /saveWorkspaceBackupToCloud\([^)]*replace: true/.test(source))
    .map(([path]) => path);
  assert.deepEqual(replacing, ['src/routes/Settings.tsx'], 'only Settings > Push cloud replaces');
});

test('Push cloud asks before it replaces the cloud copy', async () => {
  const settings = await readFile('src/routes/Settings.tsx', 'utf8');
  assert.match(settings, /onClick=\{\(\) => setPushConfirmOpen\(true\)\}/, 'the button opens the confirmation');
  assert.match(settings, /onConfirm=\{\(\) => \{\s*setPushConfirmOpen\(false\);\s*void handlePushCloud\(\);/);
  assert.doesNotMatch(settings, /onClick=\{handlePushCloud\}/, 'no path pushes without the confirmation');
});

test('autosave sends the queue and forgets it only once the cloud has it', async () => {
  const bootstrap = await readFile('src/components/CloudBootstrap.tsx', 'utf8');
  const saves = bootstrap.match(/saveWorkspaceBackupToCloud\([^)]*\)/g) ?? [];
  assert.equal(saves.length, 2, 'push-local and autosave');
  for (const save of saves) {
    assert.match(save, /\{\s*deletions\s*(?:,|\})/, `${save} must carry the queued deletions`);
  }
  const acks = bootstrap.match(
    /if \((saved|result)\.ok && \1\.deletionsApplied\) acknowledgeCloudDeletions\(deletions\);/g,
  );
  assert.equal(acks?.length, 2, 'acknowledged only when the deletions reached the copy devices load');
});

test('the actions that remove synced records queue them, and wholesale replacements clear the queue', async () => {
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  const action = (name: string) =>
    store.slice(store.indexOf(`      ${name}: (`), store.indexOf('\n      },', store.indexOf(`      ${name}: (`)));
  assert.match(action('deleteHorse'), /queueCloudDeletions\(\[\s*\{ table: 'horses', id: horseId \}/);
  assert.match(action('deleteHorse'), /table: 'sales_leads' as const/, 'the cascaded sale leads too');
  assert.match(action('deleteHorse'), /table: 'expense_receipts' as const/, 'the cascaded receipts too');
  assert.match(action('deleteAsset'), /queueCloudDeletions\(\[\{ table: 'ranch_assets', id: assetId \}\]\)/);
  assert.match(action('resetWorkspace'), /clearCloudDeletions\(\)/);
  assert.match(action('importWorkspaceBackup'), /set\(nextState\);[\s\S]*?clearCloudDeletions\(\)/);
});

test('a relational save that failed is not reported as saved because a snapshot landed', async () => {
  const cloud = await readFile('src/lib/cloudWorkspace.ts', 'utf8');
  const fallback = cloud.slice(cloud.indexOf('NOT a success.'), cloud.indexOf('NOT a success.') + 2000);
  assert.match(fallback, /return \{\s*ok: false,\s*retryable: true,\s*message: `Cloud save incomplete:/);
  assert.doesNotMatch(cloud, /Saved a legacy snapshot instead/);
});

test('a save that only reached the snapshot keeps autosave retrying instead of locking it', async () => {
  // The message says the change "will retry"; locking autosave on first load
  // would make that untrue, and nothing else retries it.
  const cloud = await readFile('src/lib/cloudWorkspace.ts', 'utf8');
  assert.match(cloud, /ok: false,\s*retryable: true,\s*message: `Cloud save incomplete:/);
  const bootstrap = await readFile('src/components/CloudBootstrap.tsx', 'utf8');
  assert.match(bootstrap, /finish\(\s*saved\.ok \|\| saved\.retryable === true,/);
});

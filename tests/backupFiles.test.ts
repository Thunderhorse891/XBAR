import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  type LocalFileEntry,
  base64ToBytes,
  clearLocalFileVault,
  blobToBase64,
  exportLocalFiles,
  importLocalFiles,
  openLocalFile,
  listLocalFiles,
  readLocalFile,
  storeLocalFile,
  sweepLocalFileVault,
} from '../src/lib/localFileVault.js';
import { installFakeIndexedDb } from './helpers/fakeIndexedDb.js';

/** The workspace these tests write as. The vault is origin-wide, so every
 * entry records an owner and the sweep only deletes what it can prove is its
 * own — a browser holding two accounts used to lose one of them. */
const TEST_WORKSPACE = 'ws-test';

/** Write straight into the store, bypassing `storeLocalFile`, to reproduce a
 * pre-namespacing record that carries no `workspaceId`. */
async function storeLegacyEntry(entry: LocalFileEntry) {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const request = indexedDB.open('xbar-file-vault');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(entry);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

/*
 * A workspace backup used to carry the records and not the files.
 *
 * Every document and receipt kept an opaque `localFileKey`; the bytes lived in
 * a separate IndexedDB store that `exportWorkspaceBackup` never read. Restored
 * on a second device, all of it was listed as stored on-device and none of it
 * opened — the backup a rancher runs precisely so they do not lose their proof
 * was leaving all of the proof behind.
 */

test('a file survives a backup and a restore onto an empty device', async () => {
  const restore = installFakeIndexedDb();
  let exported;
  try {
    const key = await storeLocalFile(
      new Blob(['NEGATIVE COGGINS 2026'], { type: 'application/pdf' }),
      'coggins.pdf',
      undefined,
      TEST_WORKSPACE,
    );
    exported = await exportLocalFiles([key]);

    assert.equal(exported.files.length, 1);
    assert.equal(exported.skipped.length, 0);
    // The key travels with the file: the restored records still point at it.
    assert.equal(exported.files[0].key, key);
  } finally {
    restore();
  }

  // A different device: a fresh vault with nothing in it.
  const restoreFresh = installFakeIndexedDb();
  try {
    assert.deepEqual(await listLocalFiles(), []);

    const { restored, failed } = await importLocalFiles(exported.files, { workspaceId: TEST_WORKSPACE });
    assert.equal(restored, 1);
    assert.deepEqual(failed, []);

    const entry = await readLocalFile(exported.files[0].key);
    assert.ok(entry, 'the record’s key must resolve on the new device');
    assert.equal(entry.name, 'coggins.pdf');
    assert.equal(entry.type, 'application/pdf');
    assert.equal(await entry.blob.text(), 'NEGATIVE COGGINS 2026');
  } finally {
    restoreFresh();
  }
});

test('only the files the workspace still references are carried', async () => {
  const restore = installFakeIndexedDb();
  try {
    const kept = await storeLocalFile(new Blob(['keep']), 'keep.pdf', undefined, TEST_WORKSPACE);
    await storeLocalFile(new Blob(['orphan']), 'orphan.pdf', undefined, TEST_WORKSPACE);

    const { files } = await exportLocalFiles([kept]);

    assert.deepEqual(
      files.map((file) => file.name),
      ['keep.pdf'],
    );
  } finally {
    restore();
  }
});

test('a file too large for the budget is named, not dropped', async () => {
  const restore = installFakeIndexedDb();
  try {
    const small = await storeLocalFile(new Blob(['ab']), 'small.pdf', undefined, TEST_WORKSPACE);
    const large = await storeLocalFile(new Blob(['abcdefghij']), 'large.pdf', undefined, TEST_WORKSPACE);

    const { files, skipped } = await exportLocalFiles([small, large], 5);

    // Smallest first, so a tight budget still carries the most files it can
    // rather than being consumed by the largest one.
    assert.deepEqual(
      files.map((file) => file.name),
      ['small.pdf'],
    );
    assert.deepEqual(skipped, [{ name: 'large.pdf', reason: 'too large to fit in the backup file' }]);
  } finally {
    restore();
  }
});

test('a restore does not abandon the remaining files when one entry is corrupt', async () => {
  const restore = installFakeIndexedDb();
  try {
    const good = {
      key: 'vault-good',
      name: 'good.pdf',
      type: 'application/pdf',
      size: 4,
      storedAt: '2026-08-24T00:00:00.000Z',
      data: await blobToBase64(new Blob(['good'])),
    };
    const corrupt = { ...good, key: 'vault-bad', name: 'bad.pdf', data: '!!! not base64 !!!' };

    const { restored, failed } = await importLocalFiles([corrupt, good], { workspaceId: TEST_WORKSPACE });

    assert.equal(restored, 1, 'the good file must still be restored');
    // Skipping it quietly leaves a record whose localFileKey resolves to
    // nothing, with no way for the rancher to know which proof did not return.
    assert.deepEqual(failed, [{ name: 'bad.pdf', reason: 'the file could not be written to this device' }]);
    assert.ok(await readLocalFile('vault-good'));
    assert.equal(await readLocalFile('vault-bad'), null);
  } finally {
    restore();
  }
});

test('a referenced file that is not on this device is named, not dropped', async () => {
  const restore = installFakeIndexedDb();
  try {
    const present = await storeLocalFile(new Blob(['here']), 'here.pdf', undefined, TEST_WORKSPACE);

    // A record can name a file this device does not have — most often because
    // the workspace arrived from a cloud snapshot written on another machine.
    // Filtering the vault by the wanted keys dropped those silently, so the
    // backup reported success while omitting proof the records still claim.
    const { files, skipped } = await exportLocalFiles([present, 'vault-elsewhere']);

    assert.deepEqual(
      files.map((file) => file.name),
      ['here.pdf'],
    );
    assert.deepEqual(skipped, [{ name: 'vault-elsewhere', reason: 'the file is not stored on this device' }]);
  } finally {
    restore();
  }
});

test('a device that cannot store files reports every one, rather than restoring none quietly', async () => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;

  const { restored, failed } = await importLocalFiles(
    [{ key: 'vault-a', name: 'a.pdf', type: '', size: 1, storedAt: '', data: '' }],
    { workspaceId: TEST_WORKSPACE },
  );

  assert.equal(restored, 0);
  assert.deepEqual(failed, [{ name: 'a.pdf', reason: 'this browser cannot store files on this device' }]);
});

test('base64 round-trips bytes exactly, across the chunk boundary', async () => {
  // 0x8000 is the chunk size, so this spans three full chunks and a remainder —
  // the case that fails if the chunking loses or repeats a slice.
  const bytes = new Uint8Array(0x8000 * 3 + 7);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256;

  const encoded = await blobToBase64(new Blob([bytes]));
  const decoded = base64ToBytes(encoded);

  assert.equal(decoded.length, bytes.length);
  // Compared byte for byte, not by length: a conversion that mangles high bytes
  // produces a file of exactly the right size that no reader can open.
  assert.ok(
    decoded.every((value, index) => value === bytes[index]),
    'every byte must survive the round trip',
  );
});

test('the backup handlers carry files, and the restore keeps their keys', async () => {
  const source = await readFile('src/routes/Settings.tsx', 'utf8');

  assert.match(source, /exportLocalFiles\(\s*referencedVaultKeys\(/, 'the export must read the vault');
  assert.match(
    source,
    /JSON\.stringify\(\{ \.\.\.backup, files, omittedFiles: skipped \}/,
    'the files AND the record of what was left out must go into the backup file',
  );
  /*
   * The order is load-bearing in BOTH directions, so both are pinned.
   *
   * Files must land before the records that point at them. But the vault must
   * not be touched until the payload is known to be acceptable: restoration
   * preserves keys and uses `put`, so writing first and rejecting after would
   * overwrite blobs belonging to the workspace currently loaded.
   */
  const validateAt = source.indexOf('workspaceBackupPayload(payload)');
  const restoreFilesAt = source.indexOf('importLocalFiles(payload.files,');
  const restoreRecordsAt = source.indexOf('importWorkspaceBackup(payload)');

  assert.ok(validateAt > -1, 'the payload must be validated before anything is written');
  assert.ok(validateAt < restoreFilesAt, 'a rejected backup must not overwrite this workspace’s files');
  assert.ok(restoreFilesAt < restoreRecordsAt, 'files must land before the records that point at them');
  assert.match(source, /some files missing/, 'a partial restore must say so rather than reporting success');
  assert.match(source, /some files not included/, 'an incomplete backup must say so rather than reporting success');
});

test('deleting the account leaves nothing on the device', async () => {
  const restore = installFakeIndexedDb();
  try {
    await storeLocalFile(new Blob(['registration papers']), 'registration.pdf', undefined, TEST_WORKSPACE);
    await storeLocalFile(new Blob(['a receipt']), 'receipt.pdf', undefined, TEST_WORKSPACE);
    assert.equal((await listLocalFiles()).length, 2);

    const { cleared } = await clearLocalFileVault(TEST_WORKSPACE);
    assert.equal(cleared, true);

    // `persist.clearStorage()` operates on the workspace database and knows
    // nothing about this one, so without an explicit purge the proof documents
    // stayed on disk while the UI reported the account permanently deleted.
    assert.deepEqual(await listLocalFiles(), []);
  } finally {
    restore();
  }
});

test('purging a device with no vault at all is not an error', async () => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  // Runs after the account is already gone server-side; throwing here would
  // show a deletion error for data that is genuinely deleted. Nothing to clear
  // is a clean outcome, not a failed one.
  assert.deepEqual(await clearLocalFileVault(TEST_WORKSPACE), { cleared: true });
});

test('a vault that cannot be read reports every requested file, not silence', async () => {
  // IndexedDB exists but the vault cannot be enumerated — blocked by another
  // tab, or storage temporarily unreadable. Returning empty files AND empty
  // skipped said the same thing as a workspace with no local files, so Settings
  // downloaded a metadata-only backup and called it a success.
  const restore = installFakeIndexedDb({ abortWrites: true });
  try {
    const { files, skipped } = await exportLocalFiles(['vault-a', 'vault-b']);

    assert.deepEqual(files, []);
    assert.deepEqual(skipped.map((entry) => entry.name).sort(), ['vault-a', 'vault-b']);
    assert.ok(
      skipped.every((entry) => /could not be read/.test(entry.reason)),
      'the reason must distinguish an unreadable vault from a missing file',
    );
  } finally {
    restore();
  }
});

test('a browser with no vault at all still names what the backup is missing', async () => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;

  const { files, skipped } = await exportLocalFiles(['vault-a']);

  assert.deepEqual(files, []);
  assert.deepEqual(skipped, [{ name: 'vault-a', reason: 'this browser cannot store or read files on this device' }]);
});

test('a refused deletion is reported, not counted as cleared', async () => {
  const restore = installFakeIndexedDb({ refuseDelete: true });
  try {
    await storeLocalFile(new Blob(['registration papers']), 'registration.pdf', undefined, TEST_WORKSPACE);

    const { cleared } = await clearLocalFileVault(TEST_WORKSPACE);

    // The account is gone server-side either way, but the proof documents are
    // still on this machine — "permanently deleted" would be false about the
    // part the person can still see.
    assert.equal(cleared, false);
    assert.equal((await listLocalFiles()).length, 1);
  } finally {
    restore();
  }
});

test('account deletion purges the vault, not just the workspace', async () => {
  const source = await readFile('src/routes/Settings.tsx', 'utf8');

  assert.match(
    source,
    /await useXbarStore\.persist\.clearStorage\(\);[\s\S]{0,900}await clearLocalFileVault\(departingWorkspaceId, departingKeys\);/,
    'the files are in their own database and need their own purge — scoped to the departing workspace, because the vault is origin-wide and this browser may hold another account',
  );
});

test('a structurally broken backup is refused before any blob is written', async () => {
  const source = await readFile('src/routes/Settings.tsx', 'utf8');

  // The shape check is a precondition, not a guarantee: `{ horses: [null] }`
  // has a `horses` key and passes it, then `restorePersistedState` dereferences
  // the null and throws — after the vault has already been overwritten with the
  // backup's blobs, under keys the CURRENT workspace still points at.
  const shapeAt = source.indexOf('workspaceBackupPayload(payload)');
  const deepAt = source.indexOf('canRestorePersistedState(workspace)');
  const filesAt = source.indexOf('importLocalFiles(payload.files,');

  assert.ok(deepAt > -1, 'the full normalization must run before anything is written');
  assert.ok(shapeAt < deepAt, 'the cheap check comes first');
  assert.ok(deepAt < filesAt, 'nothing may be written until the payload is known to restore');
  assert.match(source, /Nothing on this device was changed/, 'the refusal must say the device is untouched');
});

test('the full normalization is what decides, so it cannot drift from the import', async () => {
  const source = await readFile('src/store/xbarStoreHelpers.ts', 'utf8');

  // Runs `restorePersistedState` rather than asserting a second set of shapes,
  // so "valid" cannot drift from what the import actually applies...
  assert.match(source, /normalized = restorePersistedState\(raw\);/, 'validation must run the real normalization');

  /*
   * ...but not throwing is not the same as being usable. `{ horses: [{}] }`
   * normalizes cleanly into a horse with no id and no name; that payload passed
   * both guards, the vault was overwritten, and the broken state was installed.
   * An id is what every lookup, key and cascade in the app assumes.
   */
  assert.match(source, /const IDENTIFIED_COLLECTIONS = \[/, 'the normalized result must be checked, not just produced');
  assert.match(source, /typeof id !== 'string' \|\| id\.trim\(\) === ''/, 'a record with no id must be refused');
});

test('a backup remembers what it could not include', async () => {
  const source = await readFile('src/routes/Settings.tsx', 'utf8');

  /*
   * The omission warning used to live exactly as long as the toast.
   *
   * A file left out of the archive — missing, unreadable, or past the size
   * budget — was named on screen and nowhere else. Import could not report it
   * later because it can only report entries it was GIVEN and failed to write,
   * and an omitted file is not in `files` at all. So restoring that archive
   * months later brought back records pointing at nothing, under an ordinary
   * success message.
   */
  assert.match(source, /omittedFiles: skipped/, 'the archive must record what it left out');
  assert.match(source, /omittedFiles\?: UnbackedUpFile\[\]/, 'and the importer must be able to read it back');
});

test('an import checks the restored records against the files actually present', async () => {
  const source = await readFile('src/routes/Settings.tsx', 'utf8');

  /*
   * The load-bearing half. Reading the archive's own manifest only covers
   * omissions the exporter knew about; reconciling against the vault after the
   * restore also catches an archive truncated or edited since, and one written
   * before omissions were recorded at all. The manifest is then used only to
   * say WHY, which reconciliation cannot reconstruct.
   */
  const reconcileAt = source.indexOf('const held = new Set((await listLocalFiles()).map');
  const restoreRecordsAt = source.indexOf('importWorkspaceBackup(payload)');

  assert.ok(reconcileAt > -1, 'the import must ask the vault what it actually holds');
  assert.ok(restoreRecordsAt < reconcileAt, 'the check must run against the RESTORED records, not the old ones');
  assert.match(source, /still point at/, 'a record pointing at a missing file must be named');
  assert.match(
    source,
    /const incomplete = failed\.length > 0 \|\| danglingNote !== '';/,
    'a dangling reference must downgrade the result, not leave it reporting plain success',
  );
});

test('a file that cannot run as a document is never opened as one', async () => {
  const vault = await readFile('src/lib/localFileVault.ts', 'utf8');
  const opener = await readFile('src/lib/openStoredFile.ts', 'utf8');

  /*
   * An object URL is same-origin with the page that made it, so navigating a
   * tab to one runs the file as an XBAR document — with the workspace's
   * localStorage and IndexedDB in reach. SVG is the case that matters: every
   * `accept="image/*"` input takes one without comment, so a seller can be sent
   * one, file it as a horse photo, and hand it script execution by clicking
   * "Open file". The deployed CSP blocks inline scripts, but local and
   * static-preview builds ship no CSP, and a control that works on one host
   * only is not a control.
   */
  assert.match(vault, /const INLINE_VIEWABLE_TYPES = new Set\(\[/, 'inline viewing must be an allowlist');
  assert.ok(!/'image\/svg\+xml'/.test(vault), 'SVG is an executable document and must not be inline-viewable');
  assert.ok(!/'text\/html'/.test(vault), 'HTML must not be inline-viewable');

  // Re-typed at the one place object URLs are minted, so a caller that
  // navigates anyway downloads an inert blob instead of executing it.
  assert.match(
    vault,
    /const blob = inlineSafe \? entry\.blob : new Blob\(\[entry\.blob\], \{ type: 'application\/octet-stream' \}\);/,
  );
  assert.match(opener, /if \(access\.inlineSafe === false\) \{/, 'the opener must download rather than navigate');
  assert.match(opener, /link\.download = access\.fileName \?\? 'download';/);
});

test('a PDF is still viewable, so the guard did not break opening files', async () => {
  const { isInlineViewableType } = await import('../src/lib/localFileVault.js');

  // The point is to stop active content rendering under this origin, not to
  // stop people reading their own receipts. A browser renders PDF in its own
  // sandboxed viewer rather than as a same-origin document.
  assert.equal(isInlineViewableType('application/pdf'), true);
  assert.equal(isInlineViewableType('image/png'), true);
  assert.equal(isInlineViewableType('image/jpeg; charset=binary'), true, 'a parameter must not defeat the match');
  assert.equal(isInlineViewableType('IMAGE/PNG'), true, 'the type is case-insensitive');

  assert.equal(isInlineViewableType('image/svg+xml'), false);
  assert.equal(isInlineViewableType('text/html'), false);
  assert.equal(isInlineViewableType(''), false, 'an unknown type is not assumed safe');
});

test('a packet XBAR generated may open as a document; an uploaded one may not', async () => {
  const restore = installFakeIndexedDb();
  try {
    /*
     * Provenance decides this, not the MIME type.
     *
     * Both files below are `text/html`. One is a sale packet this app wrote,
     * carrying the inline verifier whose hash `vercel.json` allows on purpose;
     * the other is a file a person uploaded, which is someone else's script and
     * must never run under this origin. Judging both by their type meant either
     * packets stopped opening — silently disabling the verifier the CSP work
     * exists to run — or uploads got to execute.
     */
    const packet = await storeLocalFile(new Blob(['<html>packet</html>']), 'packet.html', 'text/html', 'ws-a', {
      generated: true,
    });
    const upload = await storeLocalFile(new Blob(['<html>hostile</html>']), 'upload.html', 'text/html', 'ws-a');

    const openedPacket = await openLocalFile(packet);
    const openedUpload = await openLocalFile(upload);

    assert.equal(openedPacket?.inlineSafe, true, 'a generated packet must still open in a tab');
    assert.equal(openedUpload?.inlineSafe, false, 'an uploaded html file must not run as a document');

    openedPacket?.release();
    openedUpload?.release();
  } finally {
    restore();
  }
});

test('the wizard says how the packet was delivered, not how it hoped', async () => {
  const opener = await readFile('src/lib/openStoredFile.ts', 'utf8');
  const wizard = await readFile('src/components/SalePacketWizard.tsx', 'utf8');

  // An inert file is downloaded and no tab exists, so reporting every success
  // as a tab sends the seller looking for a window that was never opened.
  assert.match(opener, /delivery: 'tab' \| 'download'/, 'the result must carry which happened');
  assert.match(opener, /return \{ ok: true, delivery: 'download' \};/);
  assert.match(wizard, /packetDelivery === 'tab'/, 'the copy must branch on the reported mode');
  assert.match(wizard, /and downloaded to this device/, 'a download has to be described as one');
  assert.ok(!wizard.includes('packetTabOpened'), 'the boolean that could only say "tab" must be gone');
});

test('deleting one account leaves another account files alone', async () => {
  const restore = installFakeIndexedDb();
  try {
    /*
     * The sibling of the sweep bug, in the deletion path.
     *
     * `clearLocalFileVault` used to call `deleteDatabase`, which drops the whole
     * origin-wide vault. Once entries record an owner that is plainly the wrong
     * tool: deleting one cloud account from a browser that also holds another
     * took the other account's registration papers, receipts and packets with
     * it, permanently — and that account only found out when its records came
     * back pointing at nothing.
     */
    const mine = await storeLocalFile(new Blob(['mine']), 'mine.pdf', undefined, 'ws-a');
    const theirs = await storeLocalFile(new Blob(['theirs']), 'theirs.pdf', undefined, 'ws-b');

    const { cleared } = await clearLocalFileVault('ws-a');

    assert.equal(cleared, true);
    assert.equal(await readLocalFile(mine), null, 'the deleted account files must go');
    assert.notEqual(await readLocalFile(theirs), null, 'the other account files must stay');
  } finally {
    restore();
  }
});

test('deleting an account also removes the untagged files it was using', async () => {
  const restore = installFakeIndexedDb();
  try {
    // An untagged file cannot be SWEPT on a guess — it might be someone else's.
    // But one the departing workspace's own records pointed at is provably its
    // own, and leaving a rancher's documents on the device after they deleted
    // their account is its own kind of wrong.
    const legacy = await storeLocalFile(new Blob(['old']), 'legacy.pdf', undefined, 'ws-a');
    const entry = await readLocalFile(legacy);
    assert.ok(entry);
    await storeLegacyEntry({ ...entry, workspaceId: undefined });

    await clearLocalFileVault('ws-a', [legacy]);
    assert.equal(await readLocalFile(legacy), null);
  } finally {
    restore();
  }
});

test('a restored file is never executable, whatever the archive claims', async () => {
  const restore = installFakeIndexedDb();
  try {
    /*
     * Executable provenance cannot be derived from anything the archive
     * controls — and inside an import, everything is archive-controlled.
     *
     * Deriving it from the backup's own `salePacketBuilds` looked safe because
     * those records are normalized first, but normalization only requires a
     * non-empty id. A crafted backup could therefore point a "packet" record at
     * an arbitrary HTML entry, have it stored as generated, bypass the
     * inert-MIME allowlist, and execute attacker script in this origin the
     * moment it was opened — on any host without the Vercel CSP, which includes
     * the supported local and static-preview builds.
     */
    const hostile = {
      key: 'vault-x',
      name: 'packet.html',
      type: 'text/html',
      size: 4,
      storedAt: '',
      data: btoa('evl'),
    };
    const { restored } = await importLocalFiles([hostile], { workspaceId: 'ws-a' });
    assert.equal(restored, 1);

    const entry = await readLocalFile('vault-x');
    assert.equal(entry?.generated, false, 'no import may mark a file as XBAR-written');

    const opened = await openLocalFile('vault-x');
    assert.equal(opened?.inlineSafe, false, 'so it downloads rather than running as a document');
    opened?.release();
  } finally {
    restore();
  }
});

test('a restored file belongs to the workspace that restored it', async () => {
  const restore = installFakeIndexedDb();
  try {
    // Without an owner a restored file could never be swept and never purged on
    // account deletion — it would accumulate forever.
    await importLocalFiles([{ key: 'vault-r', name: 'r.pdf', type: '', size: 1, storedAt: '', data: btoa('r') }], {
      workspaceId: 'ws-a',
    });

    const entry = await readLocalFile('vault-r');
    assert.equal(entry?.workspaceId, 'ws-a');
    assert.equal(await sweepLocalFileVault([], 'ws-a'), 1, 'and is therefore collectable by its owner');
  } finally {
    restore();
  }
});

test('the preflight refuses a payload that normalizes into unusable records', async () => {
  const source = await readFile('src/store/xbarStoreHelpers.ts', 'utf8');

  /*
   * Asserted at the source rather than by calling it: `xbarStoreHelpers` imports
   * through `@/` aliases the node test build does not resolve, so this suite
   * cannot execute it. Named plainly because it is a real limit — these
   * assertions pin the rule, not the behaviour.
   *
   * The rule: `{ horses: [{}] }` normalizes cleanly — the spread copies nothing
   * and the migration adds `documentFacts: []` — into a horse with no id and no
   * name. That passed both guards, the vault was overwritten with the archive's
   * blobs, and the broken state was installed; screens that key or look up by id
   * then crash on it. Not throwing is not the same as being usable.
   */
  assert.match(source, /const IDENTIFIED_COLLECTIONS = \[/, 'the normalized result must be checked, not just produced');
  assert.match(source, /if \(!Array\.isArray\(entries\)\) return false;/);
  assert.match(
    source,
    /typeof id !== 'string' \|\| id\.trim\(\) === ''/,
    'a record with a blank or missing id is refused',
  );

  // The check has to sit between normalization and the return, or it decides
  // nothing.
  const normalizeAt = source.indexOf('normalized = restorePersistedState(raw);');
  const checkAt = source.indexOf('for (const collection of IDENTIFIED_COLLECTIONS)');
  assert.ok(normalizeAt > -1 && checkAt > normalizeAt, 'the records are validated after they are normalized');
});

test('an imported key never overwrites another workspace file', async () => {
  const restore = installFakeIndexedDb();
  try {
    /*
     * The vault is origin-wide and the keys in a backup were minted wherever it
     * was exported. Restoring under the original key overwrote a colliding
     * entry belonging to ANOTHER account in this browser and retagged it to the
     * importer — after which a sweep or account deletion of the importer
     * permanently removed the only local copy the other account still
     * referenced. Someone else's document, destroyed by your restore.
     */
    const theirs = await storeLocalFile(new Blob(['theirs']), 'theirs.pdf', undefined, 'ws-a');

    const { restored, remapped } = await importLocalFiles(
      [{ key: theirs, name: 'mine.pdf', type: '', size: 4, storedAt: '', data: btoa('mine') }],
      { workspaceId: 'ws-b' },
    );

    assert.equal(restored, 1);
    assert.equal(typeof remapped[theirs], 'string', 'the collision must be reported so records can follow it');
    assert.notEqual(remapped[theirs], theirs);

    const survivor = await readLocalFile(theirs);
    assert.equal(survivor?.workspaceId, 'ws-a', 'the other workspace must keep its file and its ownership');

    const mine = await readLocalFile(remapped[theirs]);
    assert.equal(mine?.workspaceId, 'ws-b', 'and the import lands under a key of its own');
  } finally {
    restore();
  }
});

test('a key that is free, or already ours, is preserved', async () => {
  const restore = installFakeIndexedDb();
  try {
    // Remapping unconditionally would break the ordinary restore-onto-an-empty
    // -device case, which is what backups are mostly for.
    const { remapped } = await importLocalFiles(
      [{ key: 'vault-free', name: 'a.pdf', type: '', size: 1, storedAt: '', data: btoa('a') }],
      { workspaceId: 'ws-b' },
    );
    assert.deepEqual(remapped, {}, 'a free key is kept');

    const ours = await storeLocalFile(new Blob(['ours']), 'ours.pdf', undefined, 'ws-b');
    const second = await importLocalFiles(
      [{ key: ours, name: 'ours.pdf', type: '', size: 4, storedAt: '', data: btoa('new!') }],
      { workspaceId: 'ws-b' },
    );
    assert.deepEqual(second.remapped, {}, 're-importing our own backup overwrites our own file, as it should');
  } finally {
    restore();
  }
});

test('restored records follow a re-minted key', async () => {
  const settings = await readFile('src/routes/Settings.tsx', 'utf8');
  const logic = await readFile('src/store/xbarStoreLogic.ts', 'utf8');

  assert.match(settings, /if \(next\) record\.localFileKey = next;/, 'the records must be rewritten to the new key');

  /*
   * That rewrite mutates the object `workspaceBackupPayload` returned, and
   * relies on it being the SAME object `importWorkspaceBackup` will read. Both
   * of its branches return a reference rather than a copy — pinned here,
   * because if that ever became a copy the remap would silently stop applying
   * and documents would restore pointing at nothing.
   */
  assert.match(logic, /\? \(backup as \{ workspace: unknown \}\)\.workspace\s*:\s*backup;/);
  assert.ok(!/return \{ \.\.\.record \};/.test(logic), 'workspaceBackupPayload must not start returning a copy');
});

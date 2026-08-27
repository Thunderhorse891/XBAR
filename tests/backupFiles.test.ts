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
  adoptVaultEntries,
} from '../src/lib/localFileVault.js';
import { resolvePacketAttachments } from '../src/lib/localPacketAttachments.js';
import { promoteLocalVaultFiles } from '../src/lib/workspacePromotion.js';
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
    exported = await exportLocalFiles([key], TEST_WORKSPACE);

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

    const { files } = await exportLocalFiles([kept], TEST_WORKSPACE);

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

    const { files, skipped } = await exportLocalFiles([small, large], TEST_WORKSPACE, 5);

    // Smallest first, so a tight budget still carries the most files it can
    // rather than being consumed by the largest one.
    assert.deepEqual(
      files.map((file) => file.name),
      ['small.pdf'],
    );
    // The vault KEY rides along with the display name: a restore reconciles
    // dangling records by key, and recording only the filename lost the reason
    // for exactly the size and read-failure cases this manifest exists for.
    assert.deepEqual(skipped, [{ key: large, name: 'large.pdf', reason: 'too large to fit in the backup file' }]);
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
    assert.deepEqual(failed, [
      { key: 'vault-bad', name: 'bad.pdf', reason: 'the file could not be written to this device' },
    ]);
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
    const { files, skipped } = await exportLocalFiles([present, 'vault-elsewhere'], TEST_WORKSPACE);

    assert.deepEqual(
      files.map((file) => file.name),
      ['here.pdf'],
    );
    assert.deepEqual(skipped, [
      { key: 'vault-elsewhere', name: 'vault-elsewhere', reason: 'the file is not stored on this device' },
    ]);
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
  assert.deepEqual(failed, [
    { key: 'vault-a', name: 'a.pdf', reason: 'this browser cannot store files on this device' },
  ]);
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
    const { files, skipped } = await exportLocalFiles(['vault-a', 'vault-b'], TEST_WORKSPACE);

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

  const { files, skipped } = await exportLocalFiles(['vault-a'], TEST_WORKSPACE);

  assert.deepEqual(files, []);
  assert.deepEqual(skipped, [
    { key: 'vault-a', name: 'vault-a', reason: 'this browser cannot store or read files on this device' },
  ]);
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
  const reconcileAt = source.indexOf('const held = new Set(');
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

    const openedPacket = await openLocalFile(packet, 'ws-a');
    const openedUpload = await openLocalFile(upload, 'ws-a');

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

    const opened = await openLocalFile('vault-x', 'ws-a');
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

test('a key belonging to another workspace is never treated as this one’s file', async () => {
  const settings = await readFile('src/routes/Settings.tsx', 'utf8');
  const vault = await readFile('src/lib/localFileVault.ts', 'utf8');
  const cloud = await readFile('src/lib/cloudWorkspace.ts', 'utf8');

  /*
   * A file OMITTED from an archive never passes through `importLocalFiles`, so
   * its key is not remapped and the restored record keeps the original
   * workspace's key. The vault is origin-wide, so that key still resolves —
   * which meant workspace B, restoring A's backup in the same browser, held a
   * live reference to A's document.
   */

  // 1. The reconciliation note must not call a foreign key "held".
  assert.match(
    settings,
    /\.filter\(\(entry\) => entry\.workspaceId === undefined \|\| entry\.workspaceId === owner\)/,
    'presence in the origin-wide vault was never the question — ownership is',
  );

  // 2. The read path must refuse, because the note is a message and this is the
  //    actual leak: a key on a record is not permission to read the bytes.
  assert.match(
    vault,
    /export function mayReadVaultEntry\(entry: \{ workspaceId\?: string \}, workspaceId: string\): boolean \{\s*return entry\.workspaceId === undefined \|\| entry\.workspaceId === workspaceId;/,
    'one predicate, because this rule was missed at three separate read paths',
  );
  assert.match(vault, /if \(!mayReadVaultEntry\(entry, workspaceId\)\) return null;/, 'openLocalFile must refuse');
  assert.match(cloud, /openLocalFile\(document\.localFileKey, vaultOwnerId\(\)\)/, 'the caller must say who is asking');

  /*
   * Every path that turns a key into bytes, counted. Each of the three misses
   * so far looked exactly like the last one — a reader that resolved a key
   * without asking who owned it — so the guard is that no such reader is added
   * without this list changing.
   */
  const attachments = await readFile('src/lib/localPacketAttachments.ts', 'utf8');
  assert.match(
    attachments,
    /if \(!mayReadVaultEntry\(entry, workspaceId\)\) \{/,
    'a packet embeds bytes and hands them to a BUYER — the worst destination a dangling key had',
  );
  assert.match(
    vault,
    /wanted\.has\(entry\.key\) && mayReadVaultEntry\(entry, workspaceId\)/,
    'the backup copies bytes somewhere they open freely, so the export must check ownership too',
  );
  assert.equal(
    (vault.match(/mayReadVaultEntry\(/g) ?? []).length + (attachments.match(/mayReadVaultEntry\(/g) ?? []).length,
    5,
    'a new vault reader must be reviewed against the ownership rule',
  );

  // 3. Account deletion must not carry away a foreign blob through an imported
  //    reference. `alsoDeleteKeys` is what this workspace REFERENCED, which is
  //    not the same as what it owns.
  assert.doesNotMatch(
    vault,
    /const owned = new Set\(alsoDeleteKeys\);/,
    'referenced-is-owned is the assumption that deletes the other account’s documents',
  );
  assert.match(vault, /if \(mayReadVaultEntry\(entry, workspaceId\)\) owned\.add\(key\);/);

  /*
   * Untagged entries stay readable and stay adoptable in all three places.
   * They predate ownership being recorded, so unowned is indistinguishable from
   * mine — refusing them locks people out of their own files. The rule is the
   * mirror of the sweep's: the sweep deletes only what it can prove is its own,
   * these refuse only what they can prove is someone else's.
   */
  for (const [name, source] of [
    ['the vault', vault],
    ['the restore note', settings],
  ] as const) {
    assert.match(source, /workspaceId === undefined/, `${name} must let a legacy untagged file through`);
  }
});

test('one workspace cannot open or delete another workspace’s stored file', async () => {
  const restore = installFakeIndexedDb();
  try {
    // A's registration papers, and a legacy file from before ownership existed.
    const aKey = await storeLocalFile(new Blob(['A registration']), 'reg-a.pdf', 'application/pdf', 'ws-a');
    const legacyKey = await storeLocalFile(new Blob(['legacy scan']), 'legacy.pdf', 'application/pdf', 'ws-b');
    await sweepLocalFileVault([], 'ws-nobody');

    // Make the legacy entry untagged, the way a file written before ownership
    // was recorded actually sits in the vault.
    const legacy = await readLocalFile(legacyKey);
    assert.ok(legacy);
    await importLocalFiles(
      [
        {
          key: legacyKey,
          name: legacy.name,
          type: legacy.type,
          size: legacy.size,
          storedAt: legacy.storedAt,
          data: await blobToBase64(legacy.blob),
        },
      ],
      { workspaceId: 'ws-b' },
    );

    // B holds A's key — exactly what a restore of A's backup leaves behind when
    // the file itself was omitted from the archive.
    const leaked = await openLocalFile(aKey, 'ws-b');
    assert.equal(leaked, null, 'a key on a record is not permission to read another account’s document');

    const mine = await openLocalFile(aKey, 'ws-a');
    assert.ok(mine, 'the owning workspace must still be able to open its own file');
    mine?.release();

    /*
     * Deleting B's account must not take A's file, even though B's restored
     * record referenced it. `alsoDeleteKeys` is what this workspace REFERENCED,
     * which is not the same as what it owns.
     */
    await clearLocalFileVault('ws-b', [aKey]);

    const survivors = new Set((await listLocalFiles()).map((entry) => entry.key));
    assert.ok(survivors.has(aKey), 'B deleting its account must not delete A’s document');
  } finally {
    restore();
  }
});

test('a foreign key reaches neither a backup nor a buyer’s packet', async () => {
  const restore = installFakeIndexedDb();
  try {
    const aKey = await storeLocalFile(new Blob(['A registration']), 'reg-a.pdf', 'application/pdf', 'ws-a');
    const mine = await storeLocalFile(new Blob(['B coggins']), 'coggins-b.pdf', 'application/pdf', 'ws-b');

    /*
     * B's restored records reference both — the omitted file was never
     * remapped, so A's key rode along. Two paths then turn that reference into
     * bytes somewhere they open freely, and neither goes through
     * `openLocalFile`: the backup writes them into a portable archive, and a
     * sale packet embeds them and hands the result to a buyer.
     */
    const { files, skipped } = await exportLocalFiles([mine, aKey], 'ws-b');

    assert.deepEqual(
      files.map((file) => file.name),
      ['coggins-b.pdf'],
      'another workspace’s document must not be copied into this workspace’s backup',
    );
    assert.deepEqual(
      skipped.map((entry) => entry.key),
      [aKey],
      'and it must be named as missing rather than silently dropped',
    );

    const { attachments, unattached } = await resolvePacketAttachments(
      [
        {
          id: 'd-foreign',
          title: 'Registration',
          type: 'Registration',
          localFileKey: aKey,
          uploadedBy: 'Ranch Owner',
          uploadedAt: '2026-06-02',
          source: 'Upload',
          state: 'Ready',
          confidence: 96,
          duplicateRisk: 'Low',
          extractedTextPreview: '',
          summary: '',
          entities: {},
        } as never,
      ],
      'ws-b',
    );

    assert.deepEqual(attachments, [], 'a packet must never embed another workspace’s document');
    assert.equal(unattached.length, 1);
    assert.match(unattached[0].reason, /belongs to another workspace/);
  } finally {
    restore();
  }
});

test('a record that installs but crashes the route it lands on is refused', async () => {
  const helpers = await readFile('src/store/xbarStoreHelpers.ts', 'utf8');
  // The table only. Comments stripped so the prose explaining an exclusion
  // cannot satisfy an assertion about it, and scoped so unrelated code
  // elsewhere in the file cannot either.
  const shapeTable = (helpers.match(/const NESTED_SHAPES[\s\S]*?\n {2}\};/) ?? [''])[0]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.ok(shapeTable.length > 0, 'the shape table must be findable, or these assertions prove nothing');
  // The whole file, minus prose, for the parts of the guard that live outside
  // the table itself — the shared item shape above it and the loops below.
  const helperCode = helpers.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const documents = await readFile('src/routes/Documents.tsx', 'utf8');
  const studio = await readFile('src/routes/SalePacketStudio.tsx', 'utf8');

  /*
   * Passing the id loop is not the same as being usable, and horses were not
   * the only record with deep reads. `{ documents: [{ id: 'doc-1' }] }` has an
   * id, normalizes, installs — and the Documents route immediately reads
   * `document.entities.horseName`, on a screen the rancher just chose, after
   * the vault has already been overwritten with the backup's blobs.
   */
  assert.match(helpers, /salePacketBuilds: \{ lists: \['documentIds'\] \}/, 'packets deref a nested array unguarded');
  assert.match(helpers, /objects: \['bloodline', 'assignments', 'sale', 'readiness', 'location'\]/);

  /*
   * Found by searching the routes rather than waiting to be told. The first two
   * passes added only what a reviewer had named and left siblings behind each
   * time, so this pins every unguarded dereference on a restored collection.
   */
  assert.match(helpers, /expenseReceipts: \{ strings: \['vendor'\] \}/);
  /*
   * `{lead.channel}` and `{lead.stage}` are rendered straight into JSX, so
   * validating only `name` let a lead install and crash the Sales route.
   *
   * `lastTouch` is deliberately out: it is sorted and passed around as a due
   * date and never given a string method, so a guard would protect nothing and
   * could only turn away a valid archive.
   */
  assert.match(shapeTable, /salesLeads: \{ strings: \['id', 'name', 'channel', 'stage'\] \}/);
  assert.doesNotMatch(shapeTable, /'lastTouch'/, 'a guard with no unguarded read behind it is over-rejection');

  /*
   * Intake batches had no entry at all — only the shared id check — so the
   * Documents route rendered `{batch.label}` and four counters off a record
   * nothing had checked.
   *
   * `state` is excluded because `restorePersistedState` runs
   * `normalizeBatchState` over every batch: it cannot arrive malformed, which
   * is the one ground for exclusion besides "nothing reads it".
   */
  assert.match(
    shapeTable,
    /intakeBatches: \{\s*strings: \['id', 'label', 'source', 'receivedAt'\],\s*numbers: \['fileCount', 'processedCount', 'matchedCount', 'needsReviewCount'\],\s*\}/,
  );
  assert.doesNotMatch(shapeTable, /'state'/, 'a normalized field cannot arrive malformed and must not be validated');
  assert.match(helpers, /state: normalizeBatchState\(batch\.state\)/, 'which is what makes that exclusion true');

  /*
   * Numbers reach JSX exactly as strings do — `{batch.fileCount} files` throws
   * "Objects are not valid as a React child" — a shape `strings` cannot
   * describe and `objects` would accept. NaN is refused with them: it is a
   * number by `typeof` and renders as "NaN" on the screen.
   */
  assert.match(
    helperCode,
    /for \(const field of shape\.numbers \?\? \[\]\) \{\s*if \(!Number\.isFinite\(valueAtPath\(record, field\)\)\) return false;/,
    'a number field must be finite, not merely typeof number',
  );
  assert.match(helpers, /sharedListings: \{ lists: \['channels'\] \}/);
  /*
   * `role` and `label` are the scalar half of a collection whose ARRAYS were
   * already guarded, which is exactly what made the gap easy to miss:
   * `{ role: {}, primaryModules: [], permissions: [] }` passed, and Settings
   * renders `{workspace.role}` as a React child on the panel beside them.
   */
  assert.match(
    shapeTable,
    /roleWorkspaces: \{\s*strings: \['role', 'label'\],\s*lists: \['primaryModules'\],\s*stringItems: \['permissions'\],\s*\}/,
  );
  /*
   * `actor` was the only field checked and it is not the one that crashes
   * first: `formatDateLabel(event.at)` throws a TypeError before React is
   * involved, and `{event.note || ...}` renders a truthy object into JSX.
   *
   * `horseId` and `amount` stay out — the first is only compared, and the
   * second renders as "NaN" rather than throwing.
   */
  assert.match(
    shapeTable,
    /buyerRoomEvents: \{ strings: \['id', 'kind', 'at', 'actor'\], optionalStrings: \['note'\] \}/,
  );
  assert.match(helpers, /ranchAssets: \{ strings: \['name', 'category', 'assignedTo'\] \}/);
  assert.match(helpers, /strings: \['name', 'owner', 'segment'\]/);
  assert.match(helpers, /'activity',/);

  /*
   * A nested path, because requiring `readiness` to be an OBJECT says nothing
   * about `readiness.blockers` being an array. `horse.readiness.blockers
   * .filter()` runs on the first qualifying photo upload — after the media file
   * is already stored, which is the same too-late ordering as the rest of these.
   */
  assert.match(helpers, /'readiness\.blockers',/);

  /*
   * The entries, not just the container. `breedingTimeline: [null]` satisfies
   * `Array.isArray` and throws the moment Breeding reads `event.id`; a non-null
   * entry with no `title` throws on `event.title.toLowerCase()`.
   */
  assert.match(shapeTable, /breedingTimeline: TIMELINE_EVENT_SHAPE,/);

  /*
   * `activity` was added to the horse `lists` in the previous pass with no
   * entry under `itemShapes` at all, so `activity: [null]` satisfied
   * `Array.isArray` and then threw at AnimalProfile.tsx:713. The container was
   * guarded and its contents were not — the same half-fix `roleWorkspaces` had.
   *
   * All three timeline collections hold TimelineEvent, so they share ONE shape
   * rather than three partial copies: `medicalTimeline` previously required
   * only `id` while `breedingTimeline` required `id` and `title`, and neither
   * required `date`, which `formatDateLabel` dereferences.
   */
  assert.match(shapeTable, /medicalTimeline: TIMELINE_EVENT_SHAPE,/);
  assert.match(shapeTable, /activity: TIMELINE_EVENT_SHAPE,/);
  assert.match(
    helperCode,
    /const TIMELINE_EVENT_SHAPE = \{ strings: \['id', 'date', 'title', 'summary', 'owner', 'category'\] \};/,
    'every TimelineEvent field that reaches a string method or JSX must be required',
  );

  /*
   * Arrays of strings whose ENTRIES reach JSX. `itemShapes` cannot express
   * this — it requires each entry to be a plain object — so before this loop
   * existed there was no way to reject `permissions: [{}]` or
   * `auditTrail: [{}]`, both of which render straight into a list item.
   */
  assert.match(helperCode, /for \(const list of shape\.stringItems \?\? \[\]\) \{/);
  assert.match(
    helperCode,
    /for \(const item of items as unknown\[\]\) \{\s*if \(typeof item !== 'string'\) return false;/,
    'the entries, not the container — the container was already an array in both bugs',
  );

  assert.match(helpers, /gallery: \{ strings: \['status', 'kind'\] \}/);

  /*
   * `documentFacts` checked only `id`, so
   * `{ id: 'fact-1', label: {}, value: 'x' }` installed and then threw on the
   * Documents tab of the restored horse — `{f.label}` and `{f.value}` go
   * straight into JSX.
   *
   * `decision` is the same crash and cannot be required: it is optional in the
   * type and genuinely absent on most facts, so demanding it would turn away
   * valid archives. `{f.decision ?? 'Review'}` does not protect it — `??`
   * catches null and undefined, never an object.
   */
  assert.match(
    shapeTable,
    /documentFacts: \{\s*strings: \['id', 'label', 'value'\],\s*optionalStrings: \['decision'\],\s*\}/,
  );
  assert.match(
    helperCode,
    /for \(const field of itemShape\.optionalStrings \?\? \[\]\) \{[\s\S]{0,200}?value !== undefined && value !== null && typeof value !== 'string'/,
    'an absent optional field must pass; a wrong-typed one must not',
  );
  assert.match(helpers, /ownership: \{ strings: \['name', 'role'\] \}/);
  assert.match(
    helpers,
    /if \(!item \|\| typeof item !== 'object' \|\| Array\.isArray\(item\)\) return false;/,
    'a null entry is the whole point — every item must be a plain object',
  );
  assert.match(helpers, /path\.split\('\.'\)\.reduce/, 'the table has to be able to express a path, not just a field');

  /*
   * All THREE loops must resolve the path, and OVER-REJECTION is the failure to
   * watch here rather than over-acceptance: a loop still doing `record[list]`
   * looks up the literal key `'readiness.blockers'`, finds nothing, and refuses
   * every well-formed horse — turning away a backup that restores perfectly,
   * which no amount of caution justifies.
   */
  assert.equal(
    (helpers.match(/valueAtPath\(record, /g) ?? []).length,
    7,
    'every loop must resolve paths — objects, lists, strings, numbers, item shapes, optional scalars and string items — or a valid archive is rejected',
  );

  /*
   * `pendingDocuments` and `transferStatus` were both EXCLUDED here once, on
   * the grounds that their reads are guarded — `record?.pendingDocuments ?? []`
   * in the ownership selectors, and `normalizeOwnershipRecord` mapped over the
   * records in Ownership.tsx. Both true; neither generalises. OwnershipChain
   * maps the raw store records, and Horses.tsx hands a raw record to
   * `buildHorsePacketCompleteness`, which tests the record for truthiness and
   * then reads the field.
   *
   * The assertions that pinned those exclusions are gone rather than adjusted.
   * A test that enforces a wrong decision is worse than no test: it made the
   * mistake permanent and would have failed anyone who tried to fix it.
   */
  assert.match(helpers, /strings: \['legalOwner', 'transferStatus'\]/);
  assert.match(shapeTable, /lists: \['pendingDocuments'\]/);
  assert.match(shapeTable, /stringItems: \['auditTrail'\]/);

  assert.match(helpers, /'medicalTimeline'/, 'horse.medicalTimeline.map was missing from the horse list itself');

  /*
   * Found only by reading, not grepping. `add(horse.owner, horse.id)` puts the
   * dereference one call away inside the helper, so a text search for
   * `horse.owner.trim()` finds nothing — which is how `owner` and `legalOwner`
   * survived the previous sweep.
   */
  assert.match(helpers, /'owner', 'segment'\]/, 'horse.owner reaches rawName.trim() through a helper');
  assert.match(shapeTable, /documents: \{\s*objects: \['entities'\],\s*strings: \['title'\],/);

  /*
   * The entity VALUES, not just the `entities` container. Two shapes of crash,
   * both after the archive and its files are installed: Documents.tsx builds
   * `entityRows`, filters on `Boolean(row.value)` — `{}` is truthy — and
   * renders `{row.value}`; and `entities.registry?.trim()` and its ten
   * siblings throw a TypeError, because optional chaining stops at null and
   * undefined and says nothing about an object.
   *
   * Every field of the interface, because every one is optional and nearly all
   * of them reach `.trim()` through the enrichment path — `sex`, `breed`,
   * `sire` and the rest are never rendered, so a sweep for displayed fields
   * walks straight past them.
   */
  for (const field of [
    'horseName',
    'registrationNumber',
    'registry',
    'sex',
    'color',
    'breed',
    'foaledOn',
    'sire',
    'sireRegistration',
    'dam',
    'damRegistration',
    'ownerName',
    'examDate',
    'veterinarian',
    'transferStatus',
  ]) {
    assert.match(shapeTable, new RegExp(`'entities\\.${field}'`), `entities.${field} is read without a type check`);
  }
  const entityFields = Object.keys(
    (
      (await readFile('src/types/xbar.ts', 'utf8')).match(/export interface DocumentEntities \{([\s\S]*?)\n\}/)?.[1] ??
      ''
    )
      .split('\n')
      .reduce<Record<string, true>>((all, line) => {
        const name = line.match(/^\s*(\w+)\??:/)?.[1];
        if (name) all[name] = true;
        return all;
      }, {}),
  );
  assert.ok(entityFields.length > 0, 'the interface must be findable, or the next assertion proves nothing');
  for (const field of entityFields) {
    // Driven off the TYPE, so a field added later fails here instead of
    // silently becoming a new way to crash the Documents queue.
    assert.match(shapeTable, new RegExp(`'entities\\.${field}'`), `DocumentEntities.${field} is unvalidated`);
  }
  assert.match(
    helperCode,
    /for \(const field of shape\.optionalStrings \?\? \[\]\) \{\s*const value = valueAtPath\(record, field\);/,
    'optional record scalars must resolve a path, so a field nested in a validated object can be named',
  );

  /*
   * `alerts` accepted any plain object, so
   * `alerts: [{ title: {}, summary: '', module: '', severity: 'low' }]`
   * installed and then crashed the Tasks tab, which renders `{a.title}` and
   * `{a.summary} · {a.module}`.
   */
  assert.match(shapeTable, /alerts: \{ strings: \['id', 'title', 'summary', 'severity', 'module'\] \}/);

  /*
   * `notes` was missing from the required arrays entirely. Normalization
   * backfills only `documentFacts`, so a backup that omits it restores cleanly
   * and throws on `[nextNote, ...horse.notes]` the first time someone adds a
   * note.
   *
   * The CONTAINER only: no `itemShapes` entry, because that spread is the only
   * read of this array anywhere — nothing renders or iterates an existing note
   * — so validating the entries would guard a crash that cannot happen and
   * could only turn away a valid archive.
   */
  assert.match(shapeTable, /'notes',/);
  assert.doesNotMatch(shapeTable, /notes: \{/, 'a guard with no read behind it is over-rejection waiting to happen');
  assert.match(helpers, /'ownership',\s*'documents',/, 'horse.ownership and horse.documents are read as arrays');

  // A missing primitive fails on the TYPE, not on emptiness: the empty string
  // is valid and the routes are written to expect it.
  assert.match(helpers, /if \(typeof valueAtPath\(record, field\) !== 'string'\) return false;/);

  /*
   * Tied to the dereferences the guard exists for, so this fails if a route
   * stops reading them — at which point the entry is dead weight — rather than
   * asserting a list against itself.
   */
  assert.match(documents, /document\.entities\.horseName/, 'unguarded, which is why `entities` must be present');
  assert.match(studio, /packet\.documentIds\.length/, 'unguarded, which is why `documentIds` must be an array');

  for (const [route, deref] of [
    ['src/routes/Expenses.tsx', /receipt\.vendor\.trim\(\)/],
    ['src/routes/Medical.tsx', /horse\.medicalTimeline\.map\(/],
    ['src/routes/SharedAccess.tsx', /listing\.channels\.includes\(/],
    ['src/components/BuyerResponseQueue.tsx', /lead\.name\.trim\(\)/],
    ['src/lib/commandPalette.ts', /const name = rawName\.trim\(\);/],
    ['src/lib/commandPalette.ts', /for \(const horse of horses\) add\(horse\.owner, horse\.id\);/],
    ['src/lib/commandPalette.ts', /add\(record\.legalOwner, record\.horseId\);/],
    ['src/features/ownership/selectors.ts', /horse\.ownership\.reduce\(/],
    ['src/routes/Horses.tsx', /horse\.location\.barn/],
    ['src/routes/Settings.tsx', /workspace\.primaryModules\.length/],
    ['src/routes/Settings.tsx', /workspace\.permissions\.map\(/],
    ['src/components/BuyerResponseQueue.tsx', /event\.actor\.trim\(\)/],
    ['src/components/BuyerResponseQueue.tsx', /\{event\.actor\} · \{formatDateLabel\(event\.at\)\}/],
    ['src/components/BuyerResponseQueue.tsx', /\{event\.note \|\|/],
    ['src/routes/RanchAssets.tsx', /a\.assignedTo\.toLowerCase\(\)/],
    ['src/routes/Sales.tsx', /h\.segment\.toLowerCase\(\)/],
    ['src/routes/AnimalProfile.tsx', /animal\.activity\.length/],
    ['src/routes/Ownership.tsx', /selectedRecord\.auditTrail\.length/],
    ['src/store/useXbarStore.ts', /horse\.readiness\.blockers\.filter\(/],
    ['src/routes/Breeding.tsx', /event\.title\.toLowerCase\(\)/],
    ['src/lib/xbarPhaseTwo.ts', /asset\.kind === 'Hero' && asset\.status === 'Approved'/],
    ['src/features/ownership/selectors.ts', /stake\.role === 'Legal Owner'/],
    /*
     * The "Objects are not valid as a React child" shape: these do not throw
     * where they are read, they throw where React renders them, which is why
     * a sweep for `.toLowerCase()` and `.map(` walked straight past them.
     */
    ['src/routes/Settings.tsx', /<div className="stack-item__title">\{workspace\.role\}<\/div>/],
    ['src/routes/Settings.tsx', /<Pill key=\{permission\}>\{permission\}<\/Pill>/],
    ['src/routes/Ownership.tsx', /<li key=\{entry\}>\{entry\}<\/li>/],
    ['src/routes/AnimalProfile.tsx', /<div className="xs-tl__title">\{e\.title\}<\/div>/],
    ['src/routes/AnimalProfile.tsx', /\{e\.summary\} · \{e\.date\}/],
    ['src/components/InteractionSystem.tsx', /<dd>\{fact\.value\}<\/dd>/],
    ['src/routes/AnimalProfile.tsx', /<span className="xs-mrow__title">\{f\.label\}<\/span>/],
    ['src/routes/AnimalProfile.tsx', /<span className="xs-mrow__detail">\{f\.value\}<\/span>/],
    ['src/routes/AnimalProfile.tsx', /\{f\.decision \?\? 'Review'\}/],
    ['src/routes/Expenses.tsx', /uploadedBy: roleWorkspace\.label,/],
    ['src/routes/Sales.tsx', /\{lead\.channel\} · \{horse\?\.name\}/],
    ['src/routes/Documents.tsx', /<div className="stack-item__title">\{batch\.label\}<\/div>/],
    [
      'src/routes/Documents.tsx',
      /\{batch\.fileCount\} files · \{batch\.source\} · \{formatDateTimeLabel\(batch\.receivedAt\)\}/,
    ],
    ['src/routes/Documents.tsx', /\{batch\.processedCount\}\/\{batch\.fileCount\} logged/],
    /*
     * And the one that throws at the read: `formatDateLabel` calls `.trim()`
     * on whatever it is handed, so a timeline event whose `date` is an object
     * takes out Medical and Breeding before React is involved at all.
     */
    ['src/routes/Medical.tsx', /value: formatDateLabel\(event\.date\)/],
    ['src/lib/format.ts', /if \(!value\?\.trim\(\)\) \{/],
  ] as const) {
    assert.match(await readFile(route, 'utf8'), deref, `${route} still reads this unguarded`);
  }

  /*
   * Derived state must NOT be in the table. `packet.saleSlots` reads like one of
   * these and is not — `buildHorsePacketCompleteness` constructs it, so it can
   * never arrive missing from a backup, and guarding it would reject valid
   * archives.
   */
  assert.doesNotMatch(shapeTable, /saleSlots/, 'a computed field cannot arrive malformed and must not be validated');

  /*
   * Derived is the only ground for exclusion. "A read site normalizes it first"
   * was used as one here twice, for `transferStatus` and `pendingDocuments`,
   * and both had OTHER read sites that do not normalize — so both are now
   * required and the assertions pinning their exclusion are gone.
   *
   * These pin the unguarded reads that make them required, so the entries fail
   * as dead weight if a route ever starts guarding.
   */
  assert.match(
    await readFile('src/routes/OwnershipChain.tsx', 'utf8'),
    /o\.pendingDocuments\.length/,
    'OwnershipChain maps the RAW store records',
  );
  assert.match(
    await readFile('src/lib/xbarPhaseTwo.ts', 'utf8'),
    /ownershipRecord\.transferStatus\.toLowerCase\(\)/,
    'and this guard tests the record for truthiness, then reads the field',
  );
  assert.match(
    await readFile('src/routes/Horses.tsx', 'utf8'),
    /ownershipRecords\.find\(\(record\) => record\.horseId === horse\.id\)/,
    'which Horses.tsx feeds with a raw record',
  );

  // Still not a full runtime schema: a second description of "valid" drifts
  // from the types, which is the trade the original comment was right about.
  assert.doesNotMatch(helpers, /z\.object\(|yup\.|joi\./, 'the guard must stay a list of crash sites, not a schema');
});

test('signing in brings this device’s own files along, and nobody else’s', async () => {
  const restore = installFakeIndexedDb();
  try {
    /*
     * A signed-out rancher's files are owned by `'local'`. Signing in gives the
     * browser a new vault owner, and every ownership check then refuses those
     * entries — the records still name them and nothing can open them. The
     * rancher signs in and their documents vanish.
     */
    const mine = await storeLocalFile(new Blob(['coggins']), 'coggins.pdf', 'application/pdf', 'local');
    const alsoMine = await storeLocalFile(new Blob(['bill']), 'bill.pdf', 'application/pdf', 'local');
    // Local, but nothing in the promoted records points at it.
    const unreferenced = await storeLocalFile(new Blob(['stray']), 'stray.pdf', 'application/pdf', 'local');
    // A previous cloud account's file, which must not be swept up.
    const theirs = await storeLocalFile(new Blob(['theirs']), 'theirs.pdf', 'application/pdf', 'ws-other');

    const moved = await adoptVaultEntries([mine, alsoMine, theirs], 'local', 'ws-new');

    assert.equal(moved.adopted, 2, 'only the referenced local entries change hands');
    assert.deepEqual(moved.failed, [], 'a clean move leaves nothing behind');

    const owners = new Map((await listLocalFiles()).map((entry) => [entry.key, entry.workspaceId]));
    assert.equal(owners.get(mine), 'ws-new');
    assert.equal(owners.get(alsoMine), 'ws-new');
    assert.equal(owners.get(theirs), 'ws-other', 'a previous account keeps its own files even when named');
    assert.equal(owners.get(unreferenced), 'local', 'nothing unreferenced is claimed on a guess');

    // And the promoted files really are readable as the new owner now.
    const opened = await openLocalFile(mine, 'ws-new');
    assert.ok(opened, 'the whole point: the rancher can still open their document after signing in');
    opened?.release();
  } finally {
    restore();
  }
});

test('a half-finished move is reported, and retried on the next load', async () => {
  const promotion = await readFile('src/lib/workspacePromotion.ts', 'utf8');
  const vault = await readFile('src/lib/localFileVault.ts', 'utf8');
  const bootstrap = await readFile('src/components/CloudBootstrap.tsx', 'utf8');
  const settings = await readFile('src/routes/Settings.tsx', 'utf8');

  /*
   * Swallowing a partial move makes it permanent. The caller marks the records
   * as the new owner's, reconciliation settles, and every later load sees the
   * two copies agree — so the promotion is never attempted again and the files
   * still tagged `'local'` stay refused for as long as the session lasts.
   */
  assert.match(vault, /const failed: string\[\] = \[\];/, 'the keys that did not move must be named');
  assert.match(vault, /return \{ adopted: 0, failed: \[\.\.\.referenced\] \}/, 'an unlistable vault resolves nothing');
  assert.match(
    promotion,
    /if \(result\.failed\.length === 0\) rememberRecordsOwner\(owner\);/,
    'only a COMPLETE move may record the promotion as finished',
  );

  /*
   * Retried on `connected`, which is the decision every load after a
   * successful push lands on. Adopting only on `push-local` meant a move that
   * half-failed was never tried again.
   */
  const connectedAt = bootstrap.indexOf("if (decision === 'connected')");
  const promoteAfterConnected = bootstrap.indexOf('promoteLocalVaultFiles', connectedAt);
  assert.ok(connectedAt > -1 && promoteAfterConnected > connectedAt, 'the retry lands on connected');

  /*
   * `import-remote` must NOT promote: its records came from the cloud, and a
   * `'local'` file they happen to name belongs to another workspace — adopting
   * there is the cross-workspace leak, not a migration.
   */
  const importAt = bootstrap.indexOf("if (decision === 'import-remote'");
  const importEnd = bootstrap.indexOf("if (decision === 'push-local')");
  assert.doesNotMatch(bootstrap.slice(importAt, importEnd), /promoteLocalVaultFiles/);

  // Both promotion routes share the step. The conflict-lock message sends
  // people to this button by name, so a manual push that skipped adoption is
  // the same defect with a different route in.
  assert.match(settings, /await promoteLocalVaultFiles\(/, "Settings' Push cloud must promote too");
  assert.match(settings, /could not be moved to the cloud workspace yet and will be retried/);
  assert.match(bootstrap, /Autosave is locked until you choose Push cloud or Pull cloud in Settings/);
  assert.equal(
    (promotion.match(/rememberRecordsOwner\(/g) ?? []).length,
    1,
    'one place decides when a promotion counts as finished',
  );
});

test('a file that cannot be moved is named rather than counted as moved', async () => {
  const restore = installFakeIndexedDb();
  let key: string;
  try {
    key = await storeLocalFile(new Blob(['coggins']), 'coggins.pdf', 'application/pdf', 'local');
  } finally {
    restore();
  }

  // Same vault, but every write now fails the way a browser out of quota does:
  // the request reports success and the transaction is rolled back.
  const restoreFailing = installFakeIndexedDb({ abortWrites: true });
  try {
    await storeLocalFile(new Blob(['coggins']), 'coggins.pdf', 'application/pdf', 'local').catch(() => '');
    const moved = await adoptVaultEntries([key], 'local', 'ws-new');

    assert.equal(moved.adopted, 0, 'a rolled-back retag has not moved anything');
    assert.ok(
      moved.failed.length > 0 || moved.adopted === 0,
      'the key must come back unresolved, so the caller can decline to record the promotion as finished',
    );
  } finally {
    restoreFailing();
  }
});

test('a new workspace claims its records on the path first-run actually takes', async () => {
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  const setup = await readFile('src/routes/SetupWorkspace.tsx', 'utf8');

  /*
   * `initializeWorkspace` has TWO success returns, and the marker was only on
   * the second — the profile update. `SetupWorkspace` calls the action and
   * navigates away, so a brand-new local ranch on a Supabase-configured
   * deployment carried no owner marker at all and the sweep withheld itself
   * forever: orphaned blobs accumulating until the rancher happened to edit
   * their profile.
   */
  assert.match(setup, /initializeWorkspace\(/, 'first-run really does go through this action');

  const createdAt = store.indexOf("? 'Workspace created and legacy starter records were cleared.'");
  const updatedAt = store.indexOf("return { ok: true, message: 'Workspace profile updated.' };");
  const markers = [...store.matchAll(/rememberRecordsOwner\(vaultOwnerId\(\)\)/g)].map((match) => match.index ?? -1);

  assert.ok(
    markers.some((at) => at < createdAt),
    'the creation path must claim the records — it is the one first-run takes',
  );
  assert.ok(
    markers.some((at) => at > createdAt && at < updatedAt),
    'and the update path still must, since either can be the first workspace this browser owns',
  );
  assert.equal(markers.length, 3, 'creation, update, and the backup import — a new one needs reviewing');
});

/*
 * A localStorage the records-owner marker can actually be read from, since
 * `readRecordsOwner` is what now decides whether a promotion may take files.
 */
function installRecordsOwner(value: string | null) {
  const previous = (globalThis as { window?: unknown }).window;
  const store = new Map<string, string>();
  if (value !== null) store.set('xbar-records-owner', value);
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, next: string) => store.set(key, next),
      removeItem: (key: string) => store.delete(key),
    },
  };
  return {
    read: () => store.get('xbar-records-owner') ?? null,
    restore: () => {
      if (previous === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = previous;
    },
  };
}

/** Store one `'local'` file and hand back the workspace shape that names it. */
async function localWorkspaceWithFile() {
  const key = await storeLocalFile(new Blob(['coggins']), 'coggins.pdf', 'application/pdf', 'local');
  return { key, workspace: { documents: [{ localFileKey: key }] } };
}

async function ownerOf(key: string) {
  const files = await listLocalFiles();
  return files.find((file) => file.key === key)?.workspaceId ?? null;
}

for (const [label, marker] of [
  ['never recorded', null],
  ['recorded as local', 'local'],
] as const) {
  test(`a promotion takes this device's files when the records are its own (${label})`, async () => {
    const restoreDb = installFakeIndexedDb();
    const marker$ = installRecordsOwner(marker);
    try {
      const { key, workspace } = await localWorkspaceWithFile();
      const result = await promoteLocalVaultFiles(workspace, 'ws-new');

      assert.equal(result.adopted, 1, 'the rancher signing in must keep their own documents');
      assert.deepEqual(result.failed, []);
      assert.equal(await ownerOf(key), 'ws-new');
      assert.equal(marker$.read(), 'ws-new', 'a complete move records who the records now belong to');
    } finally {
      marker$.restore();
      restoreDb();
    }
  });
}

test('a promotion does not take files the records merely reference', async () => {
  /*
   * Import a backup while signed in and the records become the signed-in
   * workspace's, while any file the archive omitted is still on this device
   * tagged `'local'` and still named by those records — `importWorkspaceBackup`
   * warns about exactly those references. Adopting on a key match alone hands
   * the local ranch's documents to the signed-in workspace, which can then open
   * and export them while the ranch they belong to cannot reach them at all.
   *
   * The marker is what separates a promotion from an import: it names a
   * workspace these records ALREADY belong to, so they were never local.
   */
  const restoreDb = installFakeIndexedDb();
  const marker$ = installRecordsOwner('ws-imported');
  try {
    const { key, workspace } = await localWorkspaceWithFile();
    const result = await promoteLocalVaultFiles(workspace, 'ws-imported');

    assert.equal(result.adopted, 0, 'a key collision is not proof of ownership');
    assert.deepEqual(result.failed, [], 'and declining is not a failure to move');
    assert.equal(await ownerOf(key), 'local', 'the file stays with the ranch it belongs to');
    assert.equal(marker$.read(), 'ws-imported', 'and the marker is not rewritten by a promotion that did not happen');
  } finally {
    marker$.restore();
    restoreDb();
  }
});

test('an imported document cannot navigate this app to a script URL', async () => {
  const cloud = await readFile('src/lib/cloudWorkspace.ts', 'utf8');
  const opener = await readFile('src/lib/openStoredFile.ts', 'utf8');
  const cloudCode = cloud.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const openerCode = opener.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /*
   * Refused at the source, so every caller is covered — including ones added
   * later that never think about it. `fileUrl` is workspace data and workspace
   * data arrives in imported backups.
   */
  const directBranch = cloudCode.slice(
    cloudCode.indexOf('const directFileUrl'),
    cloudCode.indexOf('if (document.localFileKey)'),
  );
  assert.match(directBranch, /if \(!isNavigableFileUrl\(directFileUrl\)\)/, 'a direct fileUrl must be scheme-checked');
  assert.doesNotMatch(
    directBranch.slice(0, directBranch.indexOf('isNavigableFileUrl')),
    /return \{\s*ok: true/,
    'and checked BEFORE it is handed back, not after',
  );

  /*
   * And again at the sinks, because this file is where a string stops being a
   * string: a same-origin `location.href`, an `<a download>`, and
   * `window.open`. The assignment targets an `about:blank` this app opened, so
   * it inherits this origin.
   */
  const guardAt = openerCode.indexOf('isNavigableFileUrl(access.url)');
  const navigateAt = openerCode.indexOf('previewWindow.location.href = access.url');
  assert.ok(guardAt >= 0, 'the opener must check the resolved url too');
  assert.ok(navigateAt > guardAt, 'and must check it before navigating');
  assert.match(openerCode, /previewWindow\.location\.href = access\.url/, 'which is the sink this protects');

  /*
   * One predicate, two call sites. Two copies of a security rule is how one of
   * them ends up laxer than the other.
   */
  // Comments stripped: the rationale in that file NAMES the broken check it
  // exists to avoid, and would satisfy the assertion against it.
  const lib = (await readFile('src/lib/navigableFileUrl.ts', 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.match(lib, /new URL\(url, base\)\.protocol/, 'parsed, never pattern-matched');
  assert.doesNotMatch(
    lib,
    /startsWith\('javascript:'\)|\.includes\('javascript'\)/,
    'a string test misses JaVaScRiPt:, leading whitespace and embedded tabs, all of which execute',
  );
});

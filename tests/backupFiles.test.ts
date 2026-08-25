import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  base64ToBytes,
  clearLocalFileVault,
  blobToBase64,
  exportLocalFiles,
  importLocalFiles,
  listLocalFiles,
  readLocalFile,
  storeLocalFile,
} from '../src/lib/localFileVault.js';
import { installFakeIndexedDb } from './helpers/fakeIndexedDb.js';

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
    const key = await storeLocalFile(new Blob(['NEGATIVE COGGINS 2026'], { type: 'application/pdf' }), 'coggins.pdf');
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

    const { restored, failed } = await importLocalFiles(exported.files);
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
    const kept = await storeLocalFile(new Blob(['keep']), 'keep.pdf');
    await storeLocalFile(new Blob(['orphan']), 'orphan.pdf');

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
    const small = await storeLocalFile(new Blob(['ab']), 'small.pdf');
    const large = await storeLocalFile(new Blob(['abcdefghij']), 'large.pdf');

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

    const { restored, failed } = await importLocalFiles([corrupt, good]);

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
    const present = await storeLocalFile(new Blob(['here']), 'here.pdf');

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

  const { restored, failed } = await importLocalFiles([
    { key: 'vault-a', name: 'a.pdf', type: '', size: 1, storedAt: '', data: '' },
  ]);

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
  assert.match(source, /JSON\.stringify\(\{ \.\.\.backup, files \}/, 'the files must go into the backup file');
  /*
   * The order is load-bearing in BOTH directions, so both are pinned.
   *
   * Files must land before the records that point at them. But the vault must
   * not be touched until the payload is known to be acceptable: restoration
   * preserves keys and uses `put`, so writing first and rejecting after would
   * overwrite blobs belonging to the workspace currently loaded.
   */
  const validateAt = source.indexOf('workspaceBackupPayload(payload)');
  const restoreFilesAt = source.indexOf('importLocalFiles(payload.files)');
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
    await storeLocalFile(new Blob(['registration papers']), 'registration.pdf');
    await storeLocalFile(new Blob(['a receipt']), 'receipt.pdf');
    assert.equal((await listLocalFiles()).length, 2);

    const { cleared } = await clearLocalFileVault();
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
  assert.deepEqual(await clearLocalFileVault(), { cleared: true });
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
    await storeLocalFile(new Blob(['registration papers']), 'registration.pdf');

    const { cleared } = await clearLocalFileVault();

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
    /await useXbarStore\.persist\.clearStorage\(\);[\s\S]{0,400}await clearLocalFileVault\(\);/,
    'the files are in their own database and need their own purge',
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
  const filesAt = source.indexOf('importLocalFiles(payload.files)');

  assert.ok(deepAt > -1, 'the full normalization must run before anything is written');
  assert.ok(shapeAt < deepAt, 'the cheap check comes first');
  assert.ok(deepAt < filesAt, 'nothing may be written until the payload is known to restore');
  assert.match(source, /Nothing on this device was changed/, 'the refusal must say the device is untouched');
});

test('the full normalization is what decides, so it cannot drift from the import', async () => {
  const source = await readFile('src/store/xbarStoreHelpers.ts', 'utf8');

  // Deliberately runs `restorePersistedState` rather than asserting a deeper
  // set of shapes: a second description of "valid" would drift from the one the
  // import actually applies.
  assert.match(
    source,
    /export function canRestorePersistedState\(raw: unknown\): boolean \{\s*try \{\s*restorePersistedState\(raw\);/,
    'validation must run the real normalization',
  );
});

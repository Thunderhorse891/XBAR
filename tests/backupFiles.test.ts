import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  base64ToBytes,
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

    const count = await importLocalFiles(exported.files);
    assert.equal(count, 1);

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

    const count = await importLocalFiles([corrupt, good]);

    assert.equal(count, 1, 'the good file must still be restored');
    assert.ok(await readLocalFile('vault-good'));
    assert.equal(await readLocalFile('vault-bad'), null);
  } finally {
    restore();
  }
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
  // Files before records: a record restored ahead of its bytes is briefly a
  // broken reference, and the count is what the rancher is told.
  assert.match(
    source,
    /const restored = Array\.isArray\(payload\.files\) \? await importLocalFiles\(payload\.files\) : 0;\s*const result = importWorkspaceBackup\(payload\);/,
    'the restore must put the files back before the records that point at them',
  );
  assert.match(source, /some files not included/, 'an incomplete backup must say so rather than reporting success');
});

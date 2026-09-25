import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { checkBackupEvidence } from '../../scripts/backup-evidence.mjs';
import { encryptBackup, decryptBackup } from '../../scripts/database-backup.mjs';

test('production preflight fails without verified backup and restore evidence', () => {
  const result = spawnSync(process.execPath, ['scripts/preflight.mjs'], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Backup.*BLOCKED/);
});

test('encrypted backup round trip rejects tampering and the wrong key', () => {
  const bytes = Buffer.from('synthetic database content');
  const key = 'a1'.repeat(32);
  const archive = encryptBackup(bytes, key);
  assert.equal(archive.includes(bytes), false);
  assert.deepEqual(decryptBackup(archive, key), bytes);
  assert.throws(() => decryptBackup(archive, 'b2'.repeat(32)));
  const changed = Buffer.from(archive);
  changed[changed.length - 1] ^= 1;
  assert.throws(() => decryptBackup(changed, key));
  assert.throws(() => encryptBackup(bytes, 'short'));
});

test('backup evidence requires fresh matching production/archive/scratch/RLS proof', () => {
  const now = Date.parse('2026-09-25T18:00:00Z');
  const stamp = '2026-09-25T17:00:00Z';
  const evidence = {
    sourceRef: 'production',
    createdAt: stamp,
    archiveSha256: 'a'.repeat(64),
    runUrl: 'https://github.com/Thunderhorse891/XBAR/actions/runs/123',
    restore: {
      target: 'scratch',
      verifiedAt: stamp,
      archiveSha256: 'a'.repeat(64),
      schemaAndDataVerified: true,
      rlsVerified: true,
    },
  };
  assert.equal(checkBackupEvidence(evidence, 'production', now).ok, true);
  for (const value of [
    undefined,
    { ...evidence, sourceRef: 'wrong' },
    { ...evidence, createdAt: '2026-01-01' },
    { ...evidence, createdAt: '2027-01-01' },
    { ...evidence, restore: null },
    { ...evidence, restore: { ...evidence.restore, target: 'production' } },
    { ...evidence, restore: { ...evidence.restore, archiveSha256: 'b'.repeat(64) } },
    { ...evidence, restore: { ...evidence.restore, rlsVerified: false } },
  ]) {
    assert.equal(checkBackupEvidence(value, 'production', now).ok, false);
  }
});

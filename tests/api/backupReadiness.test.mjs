import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

test('configured preflight rejects unhealthy or malformed HTTP 200 probe responses', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xbar-preflight-probe-'));
  const receipt = path.join(dir, 'receipt.json');
  const stamp = new Date().toISOString();
  writeFileSync(
    receipt,
    JSON.stringify({
      sourceRef: 'fixture-production',
      createdAt: stamp,
      archiveSha256: 'a'.repeat(64),
      runUrl: 'https://github.com/Thunderhorse891/XBAR/actions/runs/123',
      restore: {
        target: 'fixture-scratch',
        verifiedAt: stamp,
        archiveSha256: 'a'.repeat(64),
        schemaAndDataVerified: true,
        rlsVerified: true,
      },
    }),
  );
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    BACKUP_EVIDENCE_PATH: receipt,
    XBAR_BACKUP_SOURCE_REF: 'fixture-production',
  };
  for (const name of [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_ID_STARTER',
    'STRIPE_PRICE_ID_PROFESSIONAL',
    'STRIPE_PRICE_ID_RANCH_OPS',
    'STRIPE_PRICE_ID_ENTERPRISE',
    'STRIPE_PRICE_ID_STARTER_ANNUAL',
    'STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL',
    'STRIPE_PRICE_ID_RANCH_OPS_ANNUAL',
    'STRIPE_PRICE_ID_ENTERPRISE_ANNUAL',
    'EMAIL_FROM_ADDRESS',
    'RESEND_API_KEY',
    'CRON_SECRET',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'SENTRY_DSN',
    'VITE_SENTRY_DSN',
  ])
    env[name] = 'fixture-only';
  let responseBody = { ok: true, subsystems: {} };
  let status = 200;
  const server = createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['scripts/preflight.mjs', '--url', `http://127.0.0.1:${server.address().port}`],
        { env, timeout: 10000 },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  try {
    const control = await run();
    assert.equal(control.code, 0, control.stderr);
    assert.match(control.stdout, /0 awaiting configuration/);
    assert.match(control.stdout, /VERIFIED EVIDENCE/);
    for (const [label, body] of [
      ['negative health', { ok: false, subsystems: {} }],
      ['missing health verdict', {}],
      ['string health verdict', { ok: 'true' }],
      ['null body', null],
      ['invalid JSON', 'not-json'],
    ]) {
      await t.test(label, async () => {
        responseBody = body;
        const result = await run();
        assert.equal(result.code, 1, `probe accepted ${label}: ${result.stdout}`);
        assert.match(result.stderr, /Probe failed/);
      });
    }
    responseBody = { ok: true };
    status = 503;
    assert.equal((await run()).code, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

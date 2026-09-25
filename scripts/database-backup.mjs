// Database-only recovery. Storage object bytes and project secrets are NOT in pg_dump.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 50 * 1024 * 1024;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function encryptBackup(bytes, keyHex) {
  if (!/^[a-f0-9]{64}$/i.test(keyHex ?? '')) throw new Error('A 32-byte BACKUP_ENCRYPTION_KEY is required.');
  if (bytes.length > MAX_BYTES) throw new Error('Backup exceeds the 50 MiB free-storage safety limit.');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), nonce);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([Buffer.from('XBARDB01'), nonce, cipher.getAuthTag(), encrypted]);
}
export function decryptBackup(bytes, keyHex) {
  if (bytes.subarray(0, 8).toString() !== 'XBARDB01') throw new Error('Unsupported backup format.');
  if (!/^[a-f0-9]{64}$/i.test(keyHex ?? '')) throw new Error('Backup decryption key is unavailable.');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), bytes.subarray(8, 20));
  cipher.setAuthTag(bytes.subarray(20, 36));
  return Buffer.concat([cipher.update(bytes.subarray(36)), cipher.final()]);
}
export function databaseEnv(url) {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('Postgres URL required.');
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGCONNECT_TIMEOUT: '15',
    PGSSLMODE:
      parsed.searchParams.get('sslmode') ||
      (['localhost', '127.0.0.1'].includes(parsed.hostname) ? 'disable' : 'verify-full'),
  };
}
function command(name, args, env, input) {
  const result = spawnSync(name, args, { env, input, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  // Never echo a connection string, query output or provider error containing credentials.
  if (result.error || result.status !== 0) throw new Error(`${name} failed; backup/restore is NOT verified.`);
  return result.stdout;
}
export function createBackup({ url, sourceRef, key, output, runUrl = '' }) {
  if (!sourceRef) throw new Error('XBAR_BACKUP_SOURCE_REF is required.');
  if (!/^[a-f0-9]{64}$/i.test(key ?? '')) throw new Error('Backup key is required before reading the database.');
  const dir = mkdtempSync(path.join(tmpdir(), 'xbar-backup-'));
  try {
    const env = databaseEnv(url);
    const dump = path.join(dir, 'database.dump');
    command('pg_dump', ['--format=custom', '--file', dump], env);
    if (statSync(dump).size > MAX_BYTES * 0.7) throw new Error('Dump exceeds the encrypted archive budget.');
    const roles = command('pg_dumpall', ['--roles-only', '--no-role-passwords'], env);
    const payload = Buffer.from(
      JSON.stringify({ version: 1, sourceRef, roles, dump: readFileSync(dump).toString('base64') }),
    );
    const archive = encryptBackup(payload, key);
    writeFileSync(output, archive, { mode: 0o600 });
    const receipt = {
      version: 1,
      sourceRef,
      createdAt: new Date().toISOString(),
      archiveSha256: digest(archive),
      archiveBytes: archive.length,
      runUrl,
      coverage:
        'Postgres logical database and role definitions; no role passwords, Storage object bytes or platform configuration',
      restore: null,
    };
    writeFileSync(`${output}.json`, JSON.stringify(receipt, null, 2));
    return receipt;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
export function restoreBackup({ archivePath, key, url }) {
  const archive = readFileSync(archivePath);
  const payload = JSON.parse(decryptBackup(archive, key).toString());
  const env = databaseEnv(url);
  // Automatic drills are confined to disposable, local databases. A hosted
  // Supabase restore requires the separately documented, reviewed platform steps.
  if (!['localhost', '127.0.0.1'].includes(env.PGHOST) || !/^xbar_restore_[a-z0-9_]+$/.test(env.PGDATABASE)) {
    throw new Error('Automatic restore requires a local xbar_restore_* scratch database.');
  }
  const occupied = command(
    'psql',
    [
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m');",
    ],
    env,
  );
  if (Number(occupied.trim()) !== 0) throw new Error('Scratch database must be empty; nothing was restored.');
  const dir = mkdtempSync(path.join(tmpdir(), 'xbar-restore-'));
  try {
    const dump = path.join(dir, 'database.dump');
    writeFileSync(dump, Buffer.from(payload.dump, 'base64'), { mode: 0o600 });
    // Roles already exist when drilling in the source cluster. On a separate
    // cluster, apply the archived role definitions only after the runbook review.
    command(
      'pg_restore',
      ['--exit-on-error', '--single-transaction', '--no-owner', '--dbname', env.PGDATABASE, dump],
      env,
    );
    return {
      sourceRef: payload.sourceRef,
      target: env.PGDATABASE,
      archiveSha256: digest(archive),
      restoredAt: new Date().toISOString(),
      schemaAndDataVerified: false,
      rlsVerified: false,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    if (mode === 'create')
      createBackup({
        url: process.env.BACKUP_DATABASE_URL,
        sourceRef: process.env.XBAR_BACKUP_SOURCE_REF,
        key: process.env.BACKUP_ENCRYPTION_KEY,
        output: process.argv[3] || 'database.enc',
        runUrl: process.env.GITHUB_RUN_ID
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : '',
      });
    else if (mode === 'restore')
      console.log(
        JSON.stringify(
          restoreBackup({
            archivePath: process.argv[3],
            key: process.env.BACKUP_ENCRYPTION_KEY,
            url: process.env.RESTORE_DATABASE_URL,
          }),
        ),
      );
    else throw new Error('Usage: database-backup.mjs create|restore archive.enc');
  } catch {
    console.error(
      'Database backup/restore failed. No verification claim was issued. Check configuration and the restore runbook.',
    );
    process.exitCode = 1;
  }
}

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createBackup, restoreBackup, databaseEnv } from './database-backup.mjs';

const source = process.env.TEST_DATABASE_URL;
if (!source || !['127.0.0.1', 'localhost'].includes(new URL(source).hostname))
  throw new Error('Local scratch source required.');
const target = new URL(source);
target.pathname = '/xbar_restore_readiness';
const call = (name, args, url = source) => {
  const r = spawnSync(name, args, { env: databaseEnv(url), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`${name} drill failed: ${r.stderr}`);
  return r.stdout;
};
const query = (sql, url) => call('psql', ['-XAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], url);
query(
  'create table public.backup_restore_probe (id integer primary key, payload jsonb); insert into public.backup_restore_probe values (1, \'{"name":"synthetic horse","nested":{"a":[1,2,3]}}\');',
);
call('createdb', ['xbar_restore_readiness']);
const dir = mkdtempSync(path.join(tmpdir(), 'xbar-drill-'));
try {
  const key = randomBytes(32).toString('hex');
  const output = path.join(dir, 'scratch.enc');
  createBackup({ url: source, sourceRef: 'local-synthetic-ci', key, output });
  restoreBackup({ archivePath: output, key, url: target.href });
  const schema = (url) =>
    call('pg_dump', ['--schema-only', '--no-owner', '--no-privileges'], url).replace(/^\\(?:un)?restrict .*$/gm, '');
  assert.equal(schema(target.href), schema(source), 'restored schema differs');
  const tables = query(
    "select quote_ident(schemaname)||'.'||quote_ident(tablename) from pg_tables where schemaname in ('public','auth','storage') order by 1;",
  )
    .trim()
    .split(/\r?\n/);
  for (const table of tables) {
    const sql = `select coalesce(jsonb_agg(r order by r::text), '[]'::jsonb) from (select to_jsonb(t) r from ${table} t) q;`;
    assert.equal(query(sql, target.href), query(sql, source), `restored rows differ: ${table}`);
  }
  call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/checks/ci-rls.sql'], target.href);
  // The target is now populated. Re-running restore must refuse, not overwrite.
  assert.throws(() => restoreBackup({ archivePath: output, key, url: target.href }), /must be empty/);
  console.log(
    `Scratch restore passed: ${tables.length} tables compared, schema equality, RLS and occupied-target refusal. Synthetic local data only; not a hosted production restore.`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

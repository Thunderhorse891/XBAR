import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { databaseEnv } from './database-backup.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const catalogPath = 'supabase/checks/release-catalog.sql';
export const baselinePath = 'supabase/checks/release-catalog.expected.json';
export const ledgerMapPath = 'supabase/checks/migration-ledger-map.json';
const read = (name) => readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(path.join(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
// Earlier production migrations used different ledger versions. Reconciliation
// of those is by actual definitions. Critical versions require their exact ID
// or a reviewed, project-bound batch whose SQL and source hashes still match.
export const requiredVersions = migrations.filter((f) => f >= '20260924').map((f) => f.split('_')[0]);
export function loadLedgerMap() {
  return validateLedgerMap(JSON.parse(read(ledgerMapPath)));
}
export function validateLedgerMap(map) {
  if (map.version !== 1 || !/^[a-z]{20}$/.test(map.sourceRef) || !Array.isArray(map.batches))
    throw new Error('Invalid reviewed migration ledger map.');
  const versions = new Set();
  const mappedFiles = new Set();
  for (const batch of map.batches) {
    if (
      !/^\d{14}$/.test(batch.version) ||
      versions.has(batch.version) ||
      typeof batch.name !== 'string' ||
      !batch.name ||
      batch.statementCount !== 1 ||
      !/^[a-f0-9]{64}$/.test(batch.statementsSha256) ||
      !batch.sourceFiles ||
      typeof batch.sourceFiles !== 'object' ||
      Array.isArray(batch.sourceFiles) ||
      Object.keys(batch.sourceFiles).length === 0
    )
      throw new Error('Invalid reviewed migration ledger batch.');
    versions.add(batch.version);
    for (const [file, expectedHash] of Object.entries(batch.sourceFiles)) {
      if (
        !migrations.includes(file) ||
        mappedFiles.has(file) ||
        createHash('sha256')
          .update(read(`supabase/migrations/${file}`))
          .digest('hex') !== expectedHash
      )
        throw new Error(`Migration ledger mapping needs source review: ${file}`);
      mappedFiles.add(file);
    }
  }
  return map;
}
export function sourceDigest() {
  const hash = createHash('sha256');
  for (const name of [
    'supabase/production-schema.sql',
    ...migrations.map((f) => `supabase/migrations/${f}`),
    catalogPath,
    ledgerMapPath,
  ]) {
    hash.update(name).update('\0').update(read(name)).update('\0');
  }
  return hash.digest('hex');
}
export function loadBaseline() {
  loadLedgerMap();
  const baseline = JSON.parse(read(baselinePath));
  if (baseline.sourceDigest !== sourceDigest() || !isDeepStrictEqual(baseline.requiredVersions, requiredVersions)) {
    throw new Error('Database baseline is stale; regenerate from an isolated migrated PostgreSQL 17 database.');
  }
  return baseline;
}
export function compareCatalog(actual, expected) {
  const failures = [];
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return ['Database catalog is missing.'];
  for (const section of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (isDeepStrictEqual(actual[section], expected[section])) continue;
    const wanted = expected[section];
    const found = actual[section];
    if (wanted && found && typeof wanted === 'object' && typeof found === 'object') {
      for (const key of new Set([...Object.keys(wanted), ...Object.keys(found)])) {
        if (!isDeepStrictEqual(wanted[key], found[key])) failures.push(`Database drift: ${section}.${key}`);
      }
    } else failures.push(`Database drift: ${section}`);
  }
  return failures;
}
export function checkDatabaseEvidence(evidence, sourceRef, now = Date.now()) {
  const failures = [];
  let expected;
  try {
    expected = loadBaseline();
  } catch (error) {
    return { ok: false, failures: [error.message] };
  }
  if (!sourceRef || evidence?.sourceRef !== sourceRef)
    failures.push('Database evidence must match the production project.');
  const checkedAt = Date.parse(evidence?.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > 60 * 60 * 1000) {
    failures.push('Database catalog evidence must be no more than one hour old.');
  }
  if (evidence?.version !== 1 || evidence?.sourceDigest !== expected.sourceDigest) {
    failures.push('Database evidence does not match this revision of the schema and migrations.');
  }
  const versions = evidence?.migrationVersions;
  const map = loadLedgerMap();
  const covered = new Set();
  if (evidence?.sourceRef === map.sourceRef && Array.isArray(versions) && Array.isArray(evidence?.migrationRecords)) {
    for (const batch of map.batches) {
      const records = evidence.migrationRecords.filter((r) => r?.version === batch.version);
      const record = records[0];
      if (
        versions.includes(batch.version) &&
        records.length === 1 &&
        record.name === batch.name &&
        record.statementCount === batch.statementCount &&
        record.statementsSha256 === batch.statementsSha256
      ) {
        for (const file of Object.keys(batch.sourceFiles)) covered.add(file.split('_')[0]);
      }
    }
  }
  for (const version of requiredVersions) {
    if (!Array.isArray(versions) || (!versions.includes(version) && !covered.has(version)))
      failures.push(`Missing migration ledger version: ${version}`);
  }
  failures.push(...compareCatalog(evidence?.catalog, expected.catalog));
  return { ok: failures.length === 0, failures };
}
function query(sql, url) {
  const env = databaseEnv(url);
  // Enforce read-only independently of the SQL file, never pass secrets in argv.
  env.PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=15000';
  const result = spawnSync('psql', ['-XqAt', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    env,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error('Read-only database inspection failed; compatibility remains unverified.');
  return result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
}
export function inspectCatalog(url) {
  return query(read(catalogPath), url)[0];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [mode, output] = process.argv.slice(2);
    if (mode === '--baseline') {
      loadLedgerMap();
      const url = process.env.TEST_DATABASE_URL;
      if (!url || !['127.0.0.1', 'localhost', 'postgres'].includes(new URL(url).hostname)) {
        throw new Error('Baseline generation requires an isolated local test database.');
      }
      const baseline = { sourceDigest: sourceDigest(), requiredVersions, catalog: inspectCatalog(url) };
      if (output !== '--write') {
        if (!isDeepStrictEqual(baseline, loadBaseline()))
          throw new Error('Migrated database differs from the committed release baseline.');
        console.log('Migrated PostgreSQL catalog matches the release baseline.');
      } else {
        writeFileSync(path.join(root, baselinePath), `${JSON.stringify(baseline, null, 2)}\n`);
        console.log('Generated local catalog baseline; review its diff before committing.');
      }
    } else if (mode === '--inspect' && output) {
      const sourceRef = process.env.XBAR_DATABASE_SOURCE_REF;
      const url = process.env.READINESS_DATABASE_URL;
      // Bind the reported project to Supabase's direct or session-pooler connection.
      const parsed = new URL(url);
      const direct = parsed.hostname === `db.${sourceRef}.supabase.co`;
      const pooler =
        parsed.hostname.endsWith('.pooler.supabase.com') &&
        decodeURIComponent(parsed.username) === `postgres.${sourceRef}` &&
        (parsed.port || '5432') === '5432';
      if (
        !/^[a-z]{20}$/.test(sourceRef ?? '') ||
        (!direct && !pooler) ||
        (parsed.searchParams.get('sslmode') && parsed.searchParams.get('sslmode') !== 'verify-full')
      ) {
        throw new Error('Inspection requires the matching Supabase project connection with verified TLS.');
      }
      const sql = read(catalogPath).replace(
        'rollback;',
        `select jsonb_build_object(
          'versions', coalesce(jsonb_agg(version order by version), '[]'::jsonb),
          'records', coalesce(jsonb_agg(jsonb_build_object(
            'version', version, 'name', name, 'statementCount', coalesce(cardinality(statements),0),
            'statementsSha256', encode(sha256(convert_to(coalesce(array_to_string(statements,E'\\n'),''),'UTF8')),'hex')
          ) order by version), '[]'::jsonb)) from supabase_migrations.schema_migrations;\nrollback;`,
      );
      const [catalog, ledger] = query(sql, url);
      const evidence = {
        version: 1,
        sourceRef,
        checkedAt: new Date().toISOString(),
        sourceDigest: sourceDigest(),
        migrationVersions: ledger?.versions,
        migrationRecords: ledger?.records,
        catalog,
      };
      writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
      const result = checkDatabaseEvidence(evidence, sourceRef);
      for (const failure of result.failures) console.error(failure);
      console.log(
        `Database compatibility: ${result.ok ? 'MATCHED' : 'BLOCKED'}. Metadata only; no workflow acceptance.`,
      );
      if (!result.ok) process.exitCode = 1;
    } else
      throw new Error(
        'Use --baseline [--write] for local CI or --inspect <evidence.json> for read-only Supabase inspection.',
      );
  } catch (error) {
    // Do not print a URL parse exception that could contain connection credentials.
    console.error(error instanceof TypeError ? 'Invalid database configuration.' : error.message);
    process.exitCode = 1;
  }
}

// Guards the one defect that made the production schema undeployable: the raw
// base file uses `create policy if not exists`, which PostgreSQL rejects
// outright (ERROR 42601). `npm run supabase:prepare` rewrites those into the
// idempotent `drop policy if exists` + `create policy` pair, and the GENERATED
// file is the only artifact that may be applied to a Supabase project.
//
// This script regenerates the artifact from scratch and fails loudly if the
// result would not execute, so a non-deployable schema can never land silently.
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const basePath = path.join(root, 'supabase', 'production-schema.sql');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const generatedPath = path.join(root, 'supabase', 'production-schema.generated.sql');

// Statement forms PostgreSQL has no `IF NOT EXISTS` variant for. `CREATE TABLE`,
// `CREATE INDEX` and `CREATE EXTENSION` do support it and are intentionally absent.
const UNSUPPORTED_IF_NOT_EXISTS = [
  { label: 'CREATE POLICY ... IF NOT EXISTS', pattern: /create\s+policy\s+if\s+not\s+exists/gi },
  { label: 'CREATE TRIGGER ... IF NOT EXISTS', pattern: /create\s+trigger\s+if\s+not\s+exists/gi },
  { label: 'CREATE RULE ... IF NOT EXISTS', pattern: /create\s+rule\s+if\s+not\s+exists/gi },
];

const failures = [];
const fail = (message) => failures.push(message);

const countMatches = (source, pattern) => (source.match(pattern) ?? []).length;

// 1. Regeneration must succeed. The preparer throws when it cannot convert every
//    unsupported statement, so a non-zero exit is itself a deployability failure.
try {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'prepare-supabase-schema.mjs')], {
    cwd: root,
    stdio: 'pipe',
  });
} catch (error) {
  const detail = [error.stderr?.toString(), error.stdout?.toString(), error.message].find(Boolean) ?? '';
  console.error('FAIL  npm run supabase:prepare could not generate a deployable schema.');
  console.error(detail.trim());
  process.exit(1);
}

const [baseSource, generated, migrationFiles] = await Promise.all([
  readFile(basePath, 'utf8'),
  readFile(generatedPath, 'utf8'),
  readdir(migrationsDir).then((files) => files.filter((file) => file.endsWith('.sql')).sort()),
]);

// 2. The generated artifact must contain zero unsupported statements.
for (const { label, pattern } of UNSUPPORTED_IF_NOT_EXISTS) {
  const remaining = countMatches(generated, pattern);
  if (remaining > 0) {
    fail(`${remaining} unconverted \`${label}\` statement(s) survived into production-schema.generated.sql.`);
  }
}

// 3. Every unsupported policy in the base file must come out the other side as a
//    real policy, not be dropped on the floor by a regex that silently misses.
const basePolicies = countMatches(baseSource, /create\s+policy\s+if\s+not\s+exists/gi);
const generatedPolicies = countMatches(generated, /^create policy /gim);
if (generatedPolicies < basePolicies) {
  fail(
    `production-schema.sql declares ${basePolicies} policies but the generated artifact only creates ` +
      `${generatedPolicies}. Conversion is losing statements.`,
  );
}

// 4. Conversion must be idempotent — each converted policy is paired with a drop.
const generatedDrops = countMatches(generated, /^drop policy if exists /gim);
if (generatedDrops < basePolicies) {
  fail(
    `Only ${generatedDrops} of ${basePolicies} converted policies are preceded by \`drop policy if exists\`. ` +
      'Re-applying the schema would fail on the second run.',
  );
}

// 5. Every migration must be bundled, in filename order, after the base schema.
let cursor = generated.indexOf('-- Migration: ');
if (migrationFiles.length && cursor === -1) {
  fail('The generated artifact contains no migrations at all.');
}
for (const file of migrationFiles) {
  const marker = `-- Migration: ${file}`;
  const at = generated.indexOf(marker);
  if (at === -1) {
    fail(`Migration ${file} is missing from the generated artifact.`);
    continue;
  }
  if (at < cursor) {
    fail(`Migration ${file} is bundled out of filename order.`);
  }
  cursor = at;
}

// 6. The artifact must actually be the full schema, not a truncated write.
if (generated.length < baseSource.length) {
  fail('The generated artifact is smaller than the base schema — generation was truncated.');
}

if (failures.length) {
  console.error('FAIL  supabase/production-schema.generated.sql is not deployable:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error('\nFix scripts/prepare-supabase-schema.mjs or the offending SQL before merging.');
  process.exit(1);
}

console.log(
  `OK    production-schema.generated.sql is deployable: ${basePolicies} policies converted to ` +
    `drop-then-create, ${migrationFiles.length} migration(s) bundled in order, 0 unsupported statements.`,
);

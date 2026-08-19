import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';

const fromRoot = (filePath: string) => path.resolve(process.cwd(), filePath);

const baseSchema = await readFile(fromRoot('supabase/production-schema.sql'), 'utf8');
const deleteGuardPath = 'supabase/20260525_block_relational_mirror_deletes.sql';
const deleteGuardSource = await readFile(fromRoot(deleteGuardPath), 'utf8');

// The verifier regenerates the artifact itself, so this suite never depends on a
// stale generated file left behind by an earlier command.
test('the generated Supabase schema is deployable', () => {
  const output = execFileSync(process.execPath, [fromRoot('scripts/verify-supabase-schema.mjs')], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.match(output, /^OK\b/m);
});

test('the base schema still contains the unsupported syntax the preparer exists to convert', () => {
  // If this ever stops matching, the conversion step is dead code and the
  // deployability guard below is no longer proving anything.
  assert.match(baseSchema, /create policy if not exists/);
});

test('no unsupported IF NOT EXISTS statement survives into the generated artifact', async () => {
  const generated = await readFile(fromRoot('supabase/production-schema.generated.sql'), 'utf8');
  // PostgreSQL rejects these outright (ERROR 42601) — a single one makes the
  // whole file undeployable.
  assert.doesNotMatch(generated, /create\s+policy\s+if\s+not\s+exists/i);
  assert.doesNotMatch(generated, /create\s+trigger\s+if\s+not\s+exists/i);
  assert.doesNotMatch(generated, /create\s+rule\s+if\s+not\s+exists/i);
  // Conversion must stay idempotent: every policy is dropped before it is created.
  const created = (generated.match(/^create policy /gim) ?? []).length;
  const dropped = (generated.match(/^drop policy if exists /gim) ?? []).length;
  const declared = (baseSchema.match(/create policy if not exists/gi) ?? []).length;
  assert.ok(created >= declared, `expected at least ${declared} policies in the artifact, found ${created}`);
  assert.ok(dropped >= declared, `expected at least ${declared} policy drops in the artifact, found ${dropped}`);
});

test('every migration is bundled into the generated artifact in filename order', async () => {
  const generated = await readFile(fromRoot('supabase/production-schema.generated.sql'), 'utf8');
  const migrations = (await readdir(fromRoot('supabase/migrations'))).filter((file) => file.endsWith('.sql')).sort();
  assert.ok(migrations.length > 0, 'expected at least one migration');
  let cursor = -1;
  for (const file of migrations) {
    const at = generated.indexOf(`-- Migration: ${file}`);
    assert.notEqual(at, -1, `${file} is missing from the generated artifact`);
    assert.ok(at > cursor, `${file} is bundled out of filename order`);
    cursor = at;
  }
});

// --- Deliberately excluded: the relational-mirror delete guard -----------------
// This migration is NOT part of the canonical artifact and is NOT applied to the
// production project. It blocks all direct deletes on the nine mirror tables,
// which breaks two shipped flows (cloud sync pruning and post-account-deletion
// workspace purge). See the file header and docs/backend-data-pipeline.md.
test('the relational-mirror delete guard stays outside the canonical migration set', async () => {
  const migrations = await readdir(fromRoot('supabase/migrations'));
  assert.ok(
    !migrations.includes('20260525_block_relational_mirror_deletes.sql'),
    'The delete guard was moved into supabase/migrations/, which would apply it to production. It aborts ' +
      'cascade deletes from api/account/delete.js and stale-row pruning in cloudWorkspace.ts. Resolve both ' +
      'before adopting it.',
  );
  const generated = await readFile(fromRoot('supabase/production-schema.generated.sql'), 'utf8');
  assert.doesNotMatch(generated, /xbar_block_relational_mirror_delete/);
});

test('the excluded delete guard documents why it is not applied', () => {
  assert.match(deleteGuardSource, /NOT APPLIED/);
  assert.match(deleteGuardSource, /xbar_block_relational_mirror_delete/);
  // The two concrete blockers must stay named in the file, so anyone reaching for
  // it sees what has to be solved first.
  assert.match(deleteGuardSource, /account\/delete\.js/);
  assert.match(deleteGuardSource, /cloudWorkspace\.ts/);
});

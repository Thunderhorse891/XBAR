import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

assert.ok(['localhost', '127.0.0.1'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE, 'recovery_fixture');
assert.equal(process.env.PGUSER, 'postgres');
assert.equal(process.env.PGPASSWORD, 'synthetic-ci-only');

const fixture = readFileSync('tests/database/public-listing-projection.sql', 'utf8');
const resultLine = " result := public.xbar_resolve_public_listing('synthetic-projection','synthetic-token');";
assert.ok(fixture.includes(resultLine));
const cases = [
  ['horse,name', 'Valid buyer link did not resolve'],
  ['ownershipRecord,transferStatus', 'Legacy ownership summary regressed'],
  ['ownershipRecord,confidence', 'Legacy ownership summary regressed'],
  ['sharedListing,workspaceId', 'Canonical workspace lost'],
  ['horse,sale,askPrice', 'Buyer fields regressed'],
  ['horse,bloodline,sire', 'Buyer fields regressed'],
  ['documents,0,entities,registrationNumber', 'Buyer fields regressed'],
  ['horse,gallery', 'Approved media contract regressed'],
  ['horse,gallery,0,storagePath', 'Approved media contract regressed'],
  ['horse,profileImage', 'Primary photo projection regressed'],
];
const escaped = [];
for (const [path, expectedFailure] of cases) {
  for (const mode of ['missing', 'null']) {
    const mutation = mode === 'missing' ? `result #- '{${path}}'` : `jsonb_set(result, '{${path}}', 'null'::jsonb)`;
    const sql = fixture.replace(resultLine, `${resultLine}\n result := ${mutation};`);
    const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'expect_fixed=1'], {
      input: sql,
      encoding: 'utf8',
      timeout: 30000,
    });
    if (result.error) throw result.error;
    if (result.status === 0) {
      escaped.push(`${mode} ${path}`);
      continue;
    }
    const invalidArray =
      path === 'horse,gallery' && mode === 'null' && result.stderr.includes('cannot get array length of a scalar');
    assert.ok(
      result.stderr.includes(expectedFailure) || invalidArray,
      `${mode} ${path} failed for the wrong reason: ${result.stderr}`,
    );
    console.log(`REFUSED ${mode} ${path}`);
  }
}
assert.deepEqual(escaped, [], `Buyer contract accepted missing/null fields: ${escaped.join('; ')}`);

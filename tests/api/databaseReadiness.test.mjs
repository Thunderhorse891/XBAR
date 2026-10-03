import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { checkDatabaseEvidence, loadBaseline, validateLedgerMap } from '../../scripts/database-readiness.mjs';

const baseline = loadBaseline();
const stamp = '2026-09-28T14:00:00Z';
const now = Date.parse(stamp);
const valid = () => ({
  version: 1,
  sourceRef: 'abcdefghijklmnopqrst',
  checkedAt: stamp,
  sourceDigest: baseline.sourceDigest,
  migrationVersions: [...baseline.requiredVersions],
  catalog: structuredClone(baseline.catalog),
});
const check = (value) => checkDatabaseEvidence(value, 'abcdefghijklmnopqrst', now);
test('a fresh matching catalog and critical migration ledger pass compatibility only', () => {
  assert.deepEqual(check(valid()), { ok: true, failures: [] });
});
test('missing, stale, wrong-project and wrong-revision evidence fail closed', () => {
  for (const evidence of [
    undefined,
    null,
    {},
    [],
    true,
    { ...valid(), version: '1' },
    { ...valid(), sourceRef: 'another-project' },
    { ...valid(), sourceDigest: 'a'.repeat(64) },
    { ...valid(), checkedAt: 'invalid' },
    { ...valid(), checkedAt: '2026-09-28T15:00:00Z' },
    { ...valid(), checkedAt: '2026-09-28T12:59:59Z' },
    { ...valid(), catalog: null },
    { ...valid(), catalog: [] },
    { ...valid(), migrationVersions: null },
    { ...valid(), migrationVersions: baseline.requiredVersions.join(',') },
  ])
    assert.equal(check(evidence).ok, false, JSON.stringify(evidence));
});
test('ledger entries never substitute for the actual bucket, functions, policies or enforcement', () => {
  const mutations = [
    (x) => {
      x.catalog.buckets['horse-media'] = true;
    },
    (x) => {
      delete x.catalog.billingPeriod;
    },
    (x) => {
      x.catalog.rls['public.workspace_subscription_profiles'] = false;
    },
    (x) => {
      x.catalog.functions = {};
    },
    (x) => {
      x.catalog.policies = {};
    },
    (x) => {
      x.catalog.triggers = {};
    },
    (x) => {
      x.catalog.policies['storage.objects.unreviewed'] = { command: 'SELECT', using: 'true' };
    },
  ];
  for (const mutate of mutations) {
    const evidence = valid();
    mutate(evidence);
    assert.equal(check(evidence).ok, false);
    assert.ok(check(evidence).failures.some((f) => f.startsWith('Database drift:')));
  }
});
test('each missing critical migration blocks even if the actual catalog matches', () => {
  for (const version of baseline.requiredVersions) {
    const evidence = valid();
    evidence.migrationVersions = evidence.migrationVersions.filter((v) => v !== version);
    assert.ok(check(evidence).failures.includes(`Missing migration ledger version: ${version}`));
  }
});

const ledgerMap = JSON.parse(readFileSync('supabase/checks/migration-ledger-map.json', 'utf8'));
test('reviewed ledger mappings refuse changed source fingerprints, unknown paths and duplicate coverage', () => {
  assert.deepEqual(validateLedgerMap(ledgerMap), ledgerMap);
  for (const mutate of [
    (m) => {
      m.batches[0].sourceFiles[Object.keys(m.batches[0].sourceFiles)[0]] = '0'.repeat(64);
    },
    (m) => {
      m.batches[0].sourceFiles['../../unreviewed.sql'] = '0'.repeat(64);
    },
    (m) => {
      m.batches.push({ ...m.batches[0] });
    },
    (m) => {
      Object.assign(m.batches[1].sourceFiles, m.batches[0].sourceFiles);
    },
  ]) {
    const map = structuredClone(ledgerMap);
    mutate(map);
    assert.throws(() => validateLedgerMap(map), /review|Invalid/);
  }
});
const bundled = () => {
  const evidence = valid();
  evidence.sourceRef = ledgerMap.sourceRef;
  const covered = new Set(ledgerMap.batches.flatMap((b) => Object.keys(b.sourceFiles).map((f) => f.split('_')[0])));
  evidence.migrationVersions = [
    ...evidence.migrationVersions.filter((version) => !covered.has(version)),
    ...ledgerMap.batches.map((b) => b.version),
  ];
  evidence.migrationRecords = ledgerMap.batches.map(({ version, name, statementCount, statementsSha256 }) => ({
    version,
    name,
    statementCount,
    statementsSha256,
  }));
  return evidence;
};
const checkBundled = (evidence) => checkDatabaseEvidence(evidence, ledgerMap.sourceRef, now);
test('verified project-specific hosted batches satisfy only their exact mapped source migrations', () => {
  assert.deepEqual(checkBundled(bundled()), { ok: true, failures: [] });
  const evidence = bundled();
  evidence.migrationVersions = evidence.migrationVersions.filter((v) => v !== '20260925180000');
  assert.equal(checkBundled(evidence).ok, false, 'an unrelated unapplied migration stays blocked');
});
test('the historical batch cannot cover the superseded media source with its new replay-refusal guard', () => {
  const file = '20260924134000_horse_media_private_signed_urls.sql';
  assert.ok(ledgerMap.historicalExclusions[file]);
  assert.ok(ledgerMap.batches.every((batch) => !(file in batch.sourceFiles)));
  const evidence = bundled();
  evidence.migrationVersions = evidence.migrationVersions.filter((version) => version !== '20260924134000');
  const result = checkBundled(evidence);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes('20260924134000')));
});
test('batch IDs alone, altered SQL metadata, duplicates and a different project never satisfy missing versions', () => {
  for (const mutate of [
    (e) => {
      delete e.migrationRecords;
    },
    (e) => {
      e.migrationRecords = [];
    },
    (e) => {
      e.migrationRecords[0].statementsSha256 = '0'.repeat(64);
    },
    (e) => {
      e.migrationRecords[0].name = 'unreviewed';
    },
    (e) => {
      e.migrationRecords[0].statementCount = 2;
    },
    (e) => {
      e.migrationRecords[0].statementCount = '1';
    },
    (e) => {
      e.migrationRecords.push({ ...e.migrationRecords[0] });
    },
    (e) => {
      e.migrationVersions = e.migrationVersions.filter((v) => v !== ledgerMap.batches[0].version);
    },
  ]) {
    const evidence = bundled();
    mutate(evidence);
    assert.equal(checkBundled(evidence).ok, false);
  }
  const evidence = bundled();
  evidence.sourceRef = 'abcdefghijklmnopqrst';
  assert.equal(checkDatabaseEvidence(evidence, evidence.sourceRef, now).ok, false);
  const drift = bundled();
  drift.catalog.buckets['horse-media'] = true;
  assert.equal(checkBundled(drift).ok, false, 'matching batches cannot hide actual catalog drift');
});

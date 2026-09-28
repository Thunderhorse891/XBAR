import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDatabaseEvidence, loadBaseline } from '../../scripts/database-readiness.mjs';

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

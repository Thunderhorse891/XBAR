import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { changedRecords, stableStringify, mergeConcurrentFields } from '../src/lib/relationalDiff.js';

/*
 * A save writes only what changed on this device since its last saved or
 * loaded copy. The failure this prevents is silent: a phone that loaded the
 * ranch an hour ago rewrote every row with its hour-old values on its next
 * save, reverting what other devices had saved in between.
 */

const horse = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Horse ${id}`, notes: [], ...extra });

test('a record unchanged on this device is not written, whatever another device did to it since', () => {
  const baseline = [horse('a'), horse('b')];
  const current = [horse('a'), horse('b', { name: 'Renamed here' })];
  assert.deepEqual(
    changedRecords(current, baseline).map((record) => record.id),
    ['b'],
    "'a' is identical to what this device last saw, so the cloud's 'a' is left alone",
  );
});

test('a new record is written', () => {
  assert.deepEqual(
    changedRecords([horse('a'), horse('new')], [horse('a')]).map((record) => record.id),
    ['new'],
  );
});

test('without a baseline every record is written, as before', () => {
  assert.equal(changedRecords([horse('a'), horse('b')], undefined).length, 2);
});

test('an empty baseline is a baseline: every current record is new', () => {
  assert.equal(changedRecords([horse('a')], []).length, 1);
});

test('key order is not a change; a nested change is', () => {
  const baseline = [{ id: 'a', name: 'A', location: { barn: 'North', stall: 3 } }];
  assert.deepEqual(changedRecords([{ location: { stall: 3, barn: 'North' }, name: 'A', id: 'a' }], baseline), []);
  assert.equal(changedRecords([{ id: 'a', name: 'A', location: { barn: 'North', stall: 4 } }], baseline).length, 1);
});

test('array order is a change', () => {
  assert.equal(changedRecords([horse('a', { tags: ['y', 'x'] })], [horse('a', { tags: ['x', 'y'] })]).length, 1);
});

test('a record without a string id is always written rather than silently dropped', () => {
  const odd = { id: 7, name: 'odd' } as unknown as { id: string };
  assert.equal(changedRecords([odd], [odd]).length, 1);
});

test('stable JSON ignores undefined fields and key order', () => {
  assert.equal(stableStringify({ b: 1, a: undefined, c: [1, { z: 1, y: 2 }] }), '{"b":1,"c":[1,{"y":2,"z":1}]}');
});

/*
 * The wiring lives in modules the node runner cannot compile (Vite's `@/`
 * alias), so it is pinned to source.
 */
test('every relational table is written through the diff, and a replace bypasses it', async () => {
  const cloud = await readFile('src/lib/cloudWorkspace.ts', 'utf8');
  for (const slice of [
    'horses',
    'documents',
    'intakeBatches',
    'ownershipRecords',
    'expenseReceipts',
    'ranchAssets',
    'salesLeads',
    'sharedListings',
  ]) {
    assert.ok(
      cloud.includes(`changed(workspace.${slice}, baseline?.${slice}).map(`),
      `${slice} must be filtered to changed records`,
    );
  }
  assert.match(cloud, /const baseline = options\.replace \? undefined :/, 'Push cloud writes everything');
});

test('the baseline is the copy known to match the cloud, never a re-export after an await', async () => {
  const bootstrap = await readFile('src/components/CloudBootstrap.tsx', 'utf8');
  // Autosave diffs against the last saved copy and advances it only on success.
  assert.match(bootstrap, /baseline: lastPersistedBackupRef\.current \?\? undefined/);
  assert.match(
    bootstrap,
    /lastPersistedSignatureRef\.current = signature;\s*[\s\S]{0,200}lastPersistedBackupRef\.current = backup;/,
  );
  // Hydration hands finish() the exact matched copy.
  assert.match(bootstrap, /lastPersistedBackupRef\.current = matched;/);
  assert.doesNotMatch(
    bootstrap,
    /lastPersistedBackupRef\.current = (?:exportWorkspaceBackup\(\)|settled)/,
    'a live re-export would mark edits made during the await as already in the cloud',
  );
  assert.match(bootstrap, /promotionMessage\(promoted\.failed, 'Cloud workspace connected\.'\),\s*local,/);
  assert.match(bootstrap, /saved\.ok \? local : null,/);
});

test('three-way merging preserves unrelated nested edits and explicit field removal', () => {
  const before = { id: 'a', links: { instagram: 'old', facebook: 'old' }, notes: 'same' };
  const current = { id: 'a', links: { facebook: 'old' }, notes: 'same' };
  const remote = { id: 'a', links: { instagram: 'old', facebook: 'new' }, notes: 'remote note' };
  assert.deepEqual(mergeConcurrentFields(before, current, remote), {
    id: 'a',
    links: { facebook: 'new' },
    notes: 'remote note',
  });
  assert.throws(
    () =>
      mergeConcurrentFields(before, current, {
        ...remote,
        links: { instagram: 'changed elsewhere', facebook: 'new' },
      }),
    /conflict/,
  );
});

test('three-way arrays cannot silently choose one simultaneous append', () => {
  assert.throws(() => mergeConcurrentFields({ notes: [] }, { notes: ['local'] }, { notes: ['remote'] }), /conflict/);
  assert.deepEqual(mergeConcurrentFields({ notes: [] }, { notes: ['same'] }, { notes: ['same'] }), { notes: ['same'] });
});

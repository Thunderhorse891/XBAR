import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  createEmptyWorkspaceState,
  createHorseRecord,
  restorePersistedState,
} from '../../src/store/xbarStoreHelpers.ts';
import { useXbarStore } from '../../src/store/useXbarStore.ts';
import { useCloudStore } from '../../src/store/useCloudStore.ts';
import { hasHorsePhoto } from '../../src/lib/animalPassport.ts';
import { primaryHorseMedia } from '../../src/lib/horseMedia.ts';
import { rememberRecordsOwner } from '../../src/lib/recordsOwner.ts';
await new Promise((resolve) => setImmediate(resolve));
let persisted;
const ownershipStorage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => ownershipStorage.get(key) ?? null,
    setItem: (key, value) => ownershipStorage.set(key, value),
  },
};
useXbarStore.persist.setOptions({
  storage: {
    getItem: () => persisted,
    setItem: (_key, value) => {
      persisted = JSON.parse(JSON.stringify(value));
    },
    removeItem: () => {
      persisted = null;
    },
  },
});
const photo = (id, patch = {}) => ({
  id,
  label: id,
  kind: 'Conformation',
  status: 'Approved',
  url: `https://example.test/${id}.jpg`,
  storagePath: `ranch/horse/${id}.jpg`,
  ...patch,
});
beforeEach(() => {
  ownershipStorage.clear();
  rememberRecordsOwner('local');
  useCloudStore.setState({
    workspaceId: null,
    session: null,
    status: 'unavailable',
    workspaceReady: true,
    autosaveReady: true,
    autosaveUnlocked: true,
    workspaceRole: 'Admin',
  });
  const empty = createEmptyWorkspaceState();
  const horse = createHorseRecord(
    {
      name: 'Photo Horse',
      barnName: '',
      sex: 'Mare',
      segment: 'Sale Prospect',
      status: 'Pasture',
      owner: 'Test',
      ownerEntity: 'Test',
      barn: 'West',
      pasture: '',
    },
    empty.workspaceProfile,
  );
  horse.id = 'horse';
  horse.gallery = [photo('a'), photo('b')];
  horse.profileImage = horse.gallery[0].url;
  useXbarStore.setState({ ...empty, currentRole: 'Admin', horses: [horse] });
});
const horse = () => useXbarStore.getState().horses[0];
const change = (id, action) => useXbarStore.getState().changeHorsePhoto('horse', id, action);

test('a different uploaded photo becomes primary and survives persisted restore', () => {
  assert.equal(change('b', 'primary').ok, true);
  assert.equal(primaryHorseMedia(horse()).storagePath, 'ranch/horse/b.jpg');
  const restored = restorePersistedState(persisted.state);
  assert.equal(primaryHorseMedia(restored.horses[0]).storagePath, 'ranch/horse/b.jpg');
});
test('removal retains exact originals, chooses a remaining primary, and restores prior approval', () => {
  const original = structuredClone(horse().gallery[0]);
  assert.equal(change('a', 'remove').ok, true);
  const removed = horse().gallery.find((x) => x.id === 'a');
  assert.equal(removed.status, 'Archived');
  assert.equal(removed.url, original.url);
  assert.equal(removed.storagePath, original.storagePath);
  assert.equal(primaryHorseMedia(horse()).storagePath, 'ranch/horse/b.jpg');
  useXbarStore.setState(restorePersistedState(persisted.state));
  assert.equal(change('a', 'restore').ok, true);
  assert.equal(horse().gallery.find((x) => x.id === 'a').status, 'Approved');
  assert.equal(primaryHorseMedia(horse()).storagePath, 'ranch/horse/b.jpg');
});
test('last photo removal clears the photo requirement without deleting either retained original', () => {
  change('a', 'remove');
  change('b', 'remove');
  assert.equal(hasHorsePhoto(horse()), false);
  assert.equal(primaryHorseMedia(horse()).src, null);
  assert.equal(horse().gallery.length, 2);
  assert.equal(change('a', 'restore').ok, true);
  assert.equal(hasHorsePhoto(horse()), true);
});
test('storage-path-only photos can be selected as primary without treating a signed URL as durable identity', () => {
  useXbarStore.setState({
    horses: [{ ...horse(), gallery: [photo('a', { url: '' }), photo('b', { url: '' })], profileImage: '' }],
  });
  assert.equal(change('b', 'primary').ok, true);
  assert.deepEqual(primaryHorseMedia(horse()), { src: null, storagePath: 'ranch/horse/b.jpg' });
  change('b', 'remove');
  assert.equal(primaryHorseMedia(horse()).storagePath, 'ranch/horse/a.jpg');
});
for (const role of ['Admin', 'Ranch Manager', 'Sales Lead', 'Owner', 'Medical Lead', 'Unknown'])
  test(`photo actions enforce ${role} permissions at the store boundary`, () => {
    const allowed = ['Admin', 'Ranch Manager', 'Sales Lead'].includes(role);
    useXbarStore.setState({ currentRole: role });
    const before = useXbarStore.getState();
    assert.equal(change('a', 'remove').ok, allowed);
    if (!allowed) assert.deepEqual(useXbarStore.getState(), before);
  });
test('missing, duplicate, non-photo and invalid actions cannot mutate the gallery', () => {
  const before = useXbarStore.getState();
  assert.equal(change('missing', 'remove').ok, false);
  assert.equal(change('a', 'bogus').ok, false);
  assert.deepEqual(useXbarStore.getState(), before);
  useXbarStore.setState({ horses: [{ ...horse(), gallery: [photo('a'), photo('a')] }] });
  assert.equal(change('a', 'remove').ok, false);
  useXbarStore.setState({ horses: [{ ...horse(), gallery: [photo('doc', { kind: 'Pedigree' })] }] });
  assert.equal(change('doc', 'primary').ok, false);
});
test('a changed or unresolved cloud workspace and an authoritative denied role refuse gallery writes', () => {
  useCloudStore.setState({ session: { user: { id: 'test' } }, workspaceId: 'other', workspaceReady: false });
  assert.equal(change('a', 'remove').ok, false);
  rememberRecordsOwner('other');
  useCloudStore.setState({ workspaceReady: true, autosaveReady: true, autosaveUnlocked: true, workspaceRole: 'Owner' });
  assert.equal(change('a', 'remove').ok, false);
});

for (const status of ['Pending', 'Draft'])
  test(`selecting a ${status} primary never exposes its URL in the buyer profile`, async () => {
    const { sanitizeHorseForBuyerView } = await import('../../src/lib/publicShare.ts');
    useXbarStore.setState({ horses: [{ ...horse(), gallery: [photo('a'), photo('b', { status })] }] });
    change('b', 'primary');
    const publicHorse = sanitizeHorseForBuyerView(horse());
    assert.equal(publicHorse.gallery.length, 1);
    assert.equal(primaryHorseMedia(publicHorse).src, 'https://example.test/a.jpg');
    assert.equal(JSON.stringify(publicHorse).includes('https://example.test/b.jpg'), false);
  });
test('a horse with no approved active photos has no buyer-facing primary image', async () => {
  const { sanitizeHorseForBuyerView } = await import('../../src/lib/publicShare.ts');
  useXbarStore.setState({ horses: [{ ...horse(), gallery: [photo('a', { status: 'Pending' })] }] });
  change('a', 'primary');
  const publicHorse = sanitizeHorseForBuyerView(horse());
  assert.equal(primaryHorseMedia(publicHorse).src, null);
  assert.equal(publicHorse.profileImage, '');
});

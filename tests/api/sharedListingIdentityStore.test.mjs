import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (/\/cloudWorkspace(?:\.ts|\.js)?$/.test(specifier)) {
      const original = next(specifier, context).url;
      const source = `export * from ${JSON.stringify(`${original}?listing-original`)};
        export const upsertSharedListingInCloud = (...args) => globalThis.__listingSave(...args);
        export const updateSharedListingChannelsInCloud = (...args) => globalThis.__listingShare(...args);`;
      return { url: `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { createEmptyWorkspaceState } = await import('../../src/store/xbarStoreHelpers.ts');
const { useXbarStore } = await import('../../src/store/useXbarStore.ts');
const { useCloudStore } = await import('../../src/store/useCloudStore.ts');
const { supabaseConfig } = await import('../../src/lib/platformConfig.ts');
await new Promise((done) => setImmediate(done));
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem() {}, removeItem() {} } });
supabaseConfig.url = 'https://synthetic.invalid';
supabaseConfig.anonKey = 'synthetic';
const listing = () => ({
  id: 'listing-a',
  horseId: 'horse-a',
  state: 'Live',
  accessMode: 'Public Link',
  shareToken: 'old-token',
  channels: [],
  updatedAt: '2026-10-01',
});
beforeEach(() => {
  useCloudStore.setState({ session: { user: { id: 'user-a' } }, workspaceId: 'workspace-a', workspaceRole: 'Admin' });
  useXbarStore.setState({
    ...createEmptyWorkspaceState(),
    currentRole: 'Admin',
    horses: [{ id: 'horse-a', alerts: [] }],
    sharedListings: [listing()],
  });
  globalThis.__listingSave = async (next) => ({ ok: true, listing: next });
});
for (const action of ['rotateSharedListingToken', 'updateSharedListingAccessMode']) {
  for (const [name, change] of [
    ['workspace switch', () => useCloudStore.setState({ workspaceId: 'workspace-b' })],
    ['account switch', () => useCloudStore.setState({ session: { user: { id: 'user-b' } } })],
    ['local role loss', () => useXbarStore.setState({ currentRole: 'Viewer' })],
    ['cloud role loss', () => useCloudStore.setState({ workspaceRole: 'Viewer' })],
    ['listing removed', () => useXbarStore.setState({ sharedListings: [] })],
    ['listing edited', () => useXbarStore.setState({ sharedListings: [{ ...listing(), state: 'Archived' }] })],
  ])
    test(`${action} refuses a local commit after ${name}`, async () => {
      let expected;
      globalThis.__listingSave = async (next) => {
        change();
        expected = structuredClone(useXbarStore.getState().sharedListings);
        return { ok: true, listing: next };
      };
      const result = await useXbarStore.getState()[action]('horse-a', 'Private Token');
      assert.equal(result.ok, false);
      assert.deepEqual(useXbarStore.getState().sharedListings, expected);
    });
  test(`${action} keeps the cloud's newer restrictions and passes the original identity`, async () => {
    globalThis.__listingSave = async (next, context) => {
      assert.deepEqual(context.expectedIdentity, { userId: 'user-a', workspaceId: 'workspace-a' });
      assert.deepEqual(context.previous, listing());
      return { ok: true, listing: { ...next, state: 'Archived', shareToken: 'newer-token' } };
    };
    const result = await useXbarStore.getState()[action]('horse-a', 'Private Token');
    assert.equal(result.ok, true, result.message);
    assert.equal(useXbarStore.getState().sharedListings[0].state, 'Archived');
    assert.equal(useXbarStore.getState().sharedListings[0].shareToken, 'newer-token');
  });
}
test('recording a share requires manageSharedAccess before any sale processing', async () => {
  useXbarStore.setState({ currentRole: 'Viewer' });
  const result = await useXbarStore.getState().recordSharedChannel('horse-a', 'Direct Link');
  assert.equal(result.ok, false);
  assert.match(result.message, /permission|role|access|allowed/i);
});

for (const patch of [
  { state: 'Archived' },
  { releaseConfirmedAt: '' },
  { accessMode: 'Private Token', shareToken: 'rotated' },
])
  test(`sharing refuses a remote eligibility change ${JSON.stringify(patch)}`, async () => {
    const { createHorseRecord } = await import('../../src/store/xbarStoreHelpers.ts');
    const { ownershipDocumentReviewKey } = await import('../../src/lib/ownershipDocumentReview.ts');
    const { buildSaleHold } = await import('../../src/lib/saleTrustEngine.ts');
    const horse = createHorseRecord(
      {
        name: 'DESERT DAISY',
        barnName: '',
        registrationNumber: '7001111',
        sex: 'Mare',
        segment: 'Sale Prospect',
        status: 'Sale Prep',
        owner: 'Synthetic',
        ownerEntity: '',
        barn: 'Test',
        pasture: '',
      },
      createEmptyWorkspaceState().workspaceProfile,
    );
    horse.id = 'horse-a';
    horse.alerts = [];
    const proof = {
      id: 'proof',
      horseId: horse.id,
      title: 'Registration',
      type: 'Registration',
      state: 'Ready',
      localFileKey: 'original',
      extractedTextPreview: 'CERTIFICATE OF REGISTRATION\nRegistered Name: DESERT DAISY\nRegistration Number: 7001111',
      entities: { horseName: horse.name, registrationNumber: horse.registrationNumber },
      duplicateRisk: 'Low',
    };
    const documents = [
      proof,
      {
        id: 'coggins',
        horseId: horse.id,
        type: 'Coggins',
        state: 'Ready',
        uploadedAt: new Date().toISOString(),
        entities: {},
      },
    ];
    const ownership = {
      horseId: horse.id,
      transferStatus: 'Clear',
      proofRequirements: [
        {
          kind: 'registration_certificate',
          label: 'Registration',
          documentId: proof.id,
          status: 'verified',
          reviewAttestedAt: '2026-01-01',
          verifiedBy: 'Tester',
          verifiedAt: '2026-01-01',
          reviewedSourceKey: ownershipDocumentReviewKey(proof),
        },
      ],
    };
    assert.equal(buildSaleHold(horse, documents, ownership).held, false);
    const before = { ...listing(), releaseConfirmedAt: '2026-01-01', releaseConfirmedBy: 'Seller' };
    const remote = { ...before, ...patch };
    useXbarStore.setState({ horses: [horse], documents, ownershipRecords: [ownership], sharedListings: [before] });
    let called = false;
    globalThis.__listingShare = async () => {
      called = true;
      return { ok: true, listing: remote };
    };
    const result = await useXbarStore.getState().recordSharedChannel(horse.id, 'Direct Link');
    assert.equal(called, true);
    assert.equal(result.ok, false);
    assert.deepEqual(useXbarStore.getState().sharedListings, [remote]);
    assert.equal(
      useXbarStore.getState().auditEvents.some((event) => event.action === 'shared'),
      false,
    );
  });

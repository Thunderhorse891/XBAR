import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    if (/\/cloudWorkspace(?:\.ts|\.js)?$/.test(specifier)) {
      const original = next(specifier, context).url;
      return {
        url: `data:text/javascript;base64,${Buffer.from(`export * from ${JSON.stringify(`${original}?media-original`)}; export const uploadMediaAssetToCloud = async () => ({storagePath:'ranch/horses/horse/media-new/photo.jpg'});`).toString('base64')}`,
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});
const { useXbarStore } = await import('../../src/store/useXbarStore.ts');
const { useCloudStore } = await import('../../src/store/useCloudStore.ts');
const { createEmptyWorkspaceState, createHorseRecord } = await import('../../src/store/xbarStoreHelpers.ts');
await new Promise((resolve) => setImmediate(resolve));
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem() {}, removeItem() {} } });
for (const role of ['Admin', 'Ranch Manager', 'Sales Lead'])
  test(`${role} uploads a photo for review, not automatic buyer approval`, async () => {
    useCloudStore.setState({ session: null, workspaceId: null });
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
    useXbarStore.setState({ ...empty, currentRole: role, horses: [horse] });
    const result = await useXbarStore.getState().uploadHorseMedia({
      horseId: horse.id,
      files: [new File(['synthetic image'], 'horse.jpg', { type: 'image/jpeg' })],
      kind: 'Hero',
      makePrimary: true,
    });
    assert.equal(result.ok, true, result.message);
    const saved = useXbarStore.getState().horses[0];
    assert.equal(saved.gallery[0].status, 'Pending');
    assert.equal(saved.sale.socialReady, false, 'an unreviewed upload does not certify sales readiness');
    assert.equal(saved.gallery[0].storagePath, 'ranch/horses/horse/media-new/photo.jpg');
  });

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspaceState, restorePersistedState } from '../../src/store/xbarStoreHelpers.ts';
import { useXbarStore } from '../../src/store/useXbarStore.ts';
import { supabaseConfig } from '../../src/lib/platformConfig.ts';
// Actual local store, synthetic records and in-memory persistence. No cloud writes.
await new Promise((resolve) => setImmediate(resolve));
supabaseConfig.url = '';
supabaseConfig.anonKey = '';
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
for (const existingToken of ['', 'existing-private-token'])
  test(`explicit public-to-private transition ${existingToken ? 'preserves the credential' : 'creates a missing credential'}`, async () => {
    const state = restorePersistedState({
      ...createEmptyWorkspaceState(),
      sharedListings: [
        {
          id: 'listing-a',
          horseId: 'horse-a',
          accessMode: 'Public Link',
          state: 'Live',
          shareToken: existingToken,
          tokenIssuedAt: existingToken ? '2026-01-01' : '',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    });
    assert.equal(state.sharedListings[0].shareToken, existingToken);
    useXbarStore.setState({ ...state, currentRole: 'Admin' });
    const r = await useXbarStore.getState().updateSharedListingAccessMode('horse-a', 'Private Token');
    assert.equal(r.ok, true, r.message);
    const listing = useXbarStore.getState().sharedListings[0];
    assert.equal(listing.accessMode, 'Private Token');
    assert.ok(listing.shareToken.trim());
    assert.ok(listing.tokenIssuedAt);
    if (existingToken) {
      assert.equal(listing.shareToken, existingToken);
      assert.equal(listing.tokenIssuedAt, '2026-01-01');
    }
  });

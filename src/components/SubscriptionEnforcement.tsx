import { useEffect } from 'react';
import '@/lib/subscriptionPlans';
import { documentIntakeGate, horseLimitGate, sharedListingGate } from '@/lib/subscriptionGates';
import { useXbarStore } from '@/store/useXbarStore';

let installed = false;

export function SubscriptionEnforcement() {
  useEffect(() => {
    if (installed) return;
    installed = true;

    const state = useXbarStore.getState();
    const toggleSharedListing = state.toggleSharedListing;
    const createDocumentIntake = state.createDocumentIntake;
    const addHorse = state.addHorse;

    useXbarStore.setState({
      toggleSharedListing: async (horseId) => {
        const current = useXbarStore.getState();
        const removingExistingListing = current.sharedListings.some((listing) => listing.horseId === horseId && listing.state !== 'Archived');
        const blocked = removingExistingListing ? null : sharedListingGate(current.subscription);
        return blocked ? { ok: false, message: blocked } : toggleSharedListing(horseId);
      },
      createDocumentIntake: async (input) => {
        const current = useXbarStore.getState();
        const blocked = documentIntakeGate(current.subscription, current.documents.length, input.files.filter(Boolean).length);
        return blocked ? { ok: false, message: blocked } : createDocumentIntake(input);
      },
      addHorse: (input) => {
        const current = useXbarStore.getState();
        const blocked = horseLimitGate(current.subscription, current.horses.length);
        return blocked ? { ok: false, message: blocked } : addHorse(input);
      },
    });
  }, []);

  return null;
}

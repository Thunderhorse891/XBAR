import { useEffect } from 'react';
import '@/lib/subscriptionPlans';
import {
  documentIntakeGate,
  horseCreationGate,
  packetExportGate,
  sharedListingGate,
  teamInviteGate,
} from '@/lib/subscriptionGates';
import { useWorkspaceHydrated, useXbarStore } from '@/store/useXbarStore';

let installed = false;

export function SubscriptionEnforcement() {
  const workspaceHydrated = useWorkspaceHydrated();

  useEffect(() => {
    if (!workspaceHydrated) return;
    if (installed) return;
    installed = true;

    const state = useXbarStore.getState();
    const toggleSharedListing = state.toggleSharedListing;
    const createDocumentIntake = state.createDocumentIntake;
    const addHorse = state.addHorse;
    const createSalePacketBuild = state.createSalePacketBuild;
    const inviteWorkspaceMember = state.inviteWorkspaceMember;

    useXbarStore.setState({
      toggleSharedListing: async (horseId) => {
        const current = useXbarStore.getState();
        const removingExistingListing = current.sharedListings.some(
          (listing) => listing.horseId === horseId && listing.state !== 'Archived',
        );
        const blocked = removingExistingListing ? null : sharedListingGate(current.subscription);
        return blocked ? { ok: false, message: blocked } : toggleSharedListing(horseId);
      },
      createDocumentIntake: async (input) => {
        const current = useXbarStore.getState();
        const activeDocumentCount = current.documents.filter((document) => document.state !== 'Archived').length;
        const blocked = documentIntakeGate(
          current.subscription,
          activeDocumentCount,
          input.files.filter(Boolean).length,
        );
        const horseBlocked = input.createHorseFromBatch
          ? horseCreationGate(current.subscription, current.horses.length)
          : null;
        return blocked || horseBlocked
          ? { ok: false, message: blocked ?? horseBlocked ?? '' }
          : createDocumentIntake(input);
      },
      addHorse: (input) => {
        const current = useXbarStore.getState();
        const blocked = horseCreationGate(current.subscription, current.horses.length);
        return blocked ? { ok: false, message: blocked } : addHorse(input);
      },
      createSalePacketBuild: (input) => {
        const current = useXbarStore.getState();
        const blocked = packetExportGate(current.subscription);
        return blocked ? { ok: false, message: blocked } : createSalePacketBuild(input);
      },
      inviteWorkspaceMember: async (email, role) => {
        const current = useXbarStore.getState();
        const blocked = teamInviteGate(current.subscription);
        return blocked ? { ok: false, message: blocked } : inviteWorkspaceMember(email, role);
      },
    });
  }, [workspaceHydrated]);

  return null;
}

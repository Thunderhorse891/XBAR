import { create } from 'zustand';
import { documentsSeed, ocrBatchesSeed } from '@/data/xbarDocuments';
import { horsesSeed } from '@/data/xbarHorses';
import {
  ownershipSeed,
  portalSeed,
  ranchAssetsSeed,
  roleSeed,
  salesLeadsSeed,
  subscriptionSeed,
  weatherSeed,
} from '@/data/xbarPlatform';
import type {
  DocumentRecord,
  HorseRecord,
  OCRBatch,
  OwnershipRecord,
  PortalSnapshot,
  RanchAsset,
  RoleWorkspace,
  SalesLead,
  SubscriptionProfile,
  UserRole,
  WeatherSnapshot,
} from '@/types/xbar';

type XbarStore = {
  currentRole: UserRole;
  horses: HorseRecord[];
  documents: DocumentRecord[];
  ocrBatches: OCRBatch[];
  ownershipRecords: OwnershipRecord[];
  ranchAssets: RanchAsset[];
  subscription: SubscriptionProfile;
  weather: WeatherSnapshot;
  roleWorkspaces: RoleWorkspace[];
  salesLeads: SalesLead[];
  portal: PortalSnapshot;
  savedHorseIds: string[];
  setCurrentRole: (role: UserRole) => void;
  toggleSavedHorse: (horseId: string) => void;
};

export const useXbarStore = create<XbarStore>((set) => ({
  currentRole: 'Admin',
  horses: horsesSeed,
  documents: documentsSeed,
  ocrBatches: ocrBatchesSeed,
  ownershipRecords: ownershipSeed,
  ranchAssets: ranchAssetsSeed,
  subscription: subscriptionSeed,
  weather: weatherSeed,
  roleWorkspaces: roleSeed,
  salesLeads: salesLeadsSeed,
  portal: portalSeed,
  savedHorseIds: ['horse-wiggy', 'horse-dolly'],
  setCurrentRole: (role) => set({ currentRole: role }),
  toggleSavedHorse: (horseId) =>
    set((state) => ({
      savedHorseIds: state.savedHorseIds.includes(horseId)
        ? state.savedHorseIds.filter((id) => id !== horseId)
        : [...state.savedHorseIds, horseId],
    })),
}));

export function useCurrentRoleWorkspace() {
  return useXbarStore((state) => {
    const match = state.roleWorkspaces.find((workspace) => workspace.role === state.currentRole);
    return match ?? state.roleWorkspaces[0];
  });
}

export function useHorseRecord(id?: string) {
  return useXbarStore((state) => state.horses.find((horse) => horse.id === id));
}

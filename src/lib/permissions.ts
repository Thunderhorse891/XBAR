import type { RoleCapability, UserRole } from '../types/xbar.js';

const roleCapabilityMap: Record<UserRole, RoleCapability[]> = {
  Admin: [
    'createHorse',
    'editHorse',
    'uploadDocuments',
    'reviewDocuments',
    'uploadMedia',
    'manageMedical',
    'manageBreeding',
    'manageSales',
    'manageOwnership',
    'manageAssets',
    'manageSharedAccess',
    'manageSettings',
    'manageBilling',
    'syncCloud',
  ],
  'Ranch Manager': [
    'createHorse',
    'editHorse',
    'uploadDocuments',
    'uploadMedia',
    'manageMedical',
    'manageAssets',
    'manageSharedAccess',
  ],
  Owner: [
    'uploadDocuments',
  ],
  'Medical Lead': [
    'uploadDocuments',
    'reviewDocuments',
    'manageMedical',
  ],
  'Sales Lead': [
    'editHorse',
    'uploadDocuments',
    'uploadMedia',
    'manageSales',
    'manageSharedAccess',
  ],
};

const capabilityMessages: Record<RoleCapability, string> = {
  createHorse: 'This role cannot create horse records.',
  editHorse: 'This role cannot edit horse records.',
  uploadDocuments: 'This role cannot upload documents.',
  reviewDocuments: 'This role cannot approve or discard documents.',
  uploadMedia: 'This role cannot upload media assets.',
  manageMedical: 'This role cannot update medical records.',
  manageBreeding: 'This role cannot update breeding records.',
  manageSales: 'This role cannot update sales pipeline records.',
  manageOwnership: 'This role cannot change ownership data.',
  manageAssets: 'This role cannot update ranch asset records.',
  manageSharedAccess: 'This role cannot manage shared-access exposure.',
  manageSettings: 'This role cannot change workspace settings.',
  manageBilling: 'This role cannot manage billing.',
  syncCloud: 'This role cannot control cloud sync for this workspace.',
};

export function hasRoleCapability(role: UserRole, capability: RoleCapability) {
  return roleCapabilityMap[role]?.includes(capability) ?? false;
}

export function getCapabilityDeniedMessage(capability: RoleCapability) {
  return capabilityMessages[capability];
}

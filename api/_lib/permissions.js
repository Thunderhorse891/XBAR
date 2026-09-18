// Server-side role/capability policy.
//
// Keep this matrix aligned with src/lib/permissions.ts. Service-role API
// handlers bypass table RLS by design, so they must authorize the requested
// action explicitly before any privileged write.

const roleCapabilityMap = {
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
  Owner: ['editHorse', 'uploadDocuments', 'reviewDocuments', 'manageMedical', 'syncCloud'],
  'Medical Lead': ['uploadDocuments', 'reviewDocuments', 'manageMedical'],
  'Sales Lead': ['editHorse', 'uploadDocuments', 'uploadMedia', 'manageSales', 'manageSharedAccess'],
};

const capabilityMessages = {
  createHorse: 'This workspace role cannot create horse records.',
  editHorse: 'This workspace role cannot edit horse records.',
  uploadDocuments: 'This workspace role cannot upload documents.',
  reviewDocuments: 'This workspace role cannot approve or discard documents.',
  uploadMedia: 'This workspace role cannot upload media assets.',
  manageMedical: 'This workspace role cannot update medical records.',
  manageBreeding: 'This workspace role cannot update breeding records.',
  manageSales: 'This workspace role cannot update sales pipeline records.',
  manageOwnership: 'This workspace role cannot change ownership data.',
  manageAssets: 'This workspace role cannot update ranch asset records.',
  manageSharedAccess: 'This workspace role cannot manage shared-access exposure.',
  manageSettings: 'This workspace role cannot change workspace settings.',
  manageBilling: 'This workspace role cannot manage billing.',
  syncCloud: 'This workspace role cannot control cloud sync for this workspace.',
};

export function hasRoleCapability(role, capability) {
  return roleCapabilityMap[role]?.includes(capability) ?? false;
}

export function getCapabilityDeniedMessage(capability) {
  return capabilityMessages[capability] || 'This workspace role cannot perform that action.';
}

export function requireRoleCapability(role, capability) {
  return hasRoleCapability(role, capability) ? null : getCapabilityDeniedMessage(capability);
}

import {
  ExpenseReceipt,
  OwnershipRecord,
  RanchAsset,
  RoleWorkspace,
  SalesLead,
  SharedListingRecord,
  SharedAccessSnapshot,
  SubscriptionProfile,
  WorkspaceProfile,
} from '@/types/xbar';

export const ownershipSeed: OwnershipRecord[] = [
  // Empty by default. Ownership records are created from real horse records or imported backups.
];

export const ranchAssetsSeed: RanchAsset[] = [
  // Empty by default. Assets should be entered by the customer or imported.
];

export const expenseReceiptsSeed: ExpenseReceipt[] = [
  // Empty by default. Budgeting starts when real receipts are uploaded.
];

export const subscriptionSeed: SubscriptionProfile = {
  tier: 'Starter',
  monthlyRate: 0,
  renewalDate: '',
  billingState: 'Manual Billing',
  sharedAccessEnabled: false,
  featureFlags: [
    'First-run workspace setup',
    'Manual document upload',
    'Receipt logging',
    'Horse ledger',
  ],
  usage: {
    horsesUsed: 0,
    horseLimit: 5,
    seatsUsed: 0,
      seatLimit: 1,
    documentsProcessed: 0,
    documentLimit: 250,
    salePacketsGenerated: 0,
    salePacketLimit: 2,
    storageUsedGb: 0,
    storageLimitGb: 5,
    sharedAccessSeatsUsed: 0,
    sharedAccessSeatLimit: 1,
  },
};

export const roleSeed: RoleWorkspace[] = [
  {
    role: 'Admin',
    label: 'Admin',
    summary: 'Full control across records, documents, contracts, and shared links.',
    primaryModules: ['Ownership', 'Documents', 'Subscriptions', 'Settings'],
    permissions: ['Full record write access', 'Contract visibility', 'Shared access approvals'],
  },
  {
    role: 'Ranch Manager',
    label: 'Ranch Manager',
    summary: 'Horse ops, equipment & property, and active blockers.',
    primaryModules: ['Dashboard', 'Horses', 'Equipment & Property'],
    permissions: ['Horse updates', 'Asset assignments', 'Medical watch visibility'],
  },
  {
    role: 'Owner',
    label: 'Horse Owner / Client',
    summary: 'Read-only horse records, documents, and sale packets.',
    primaryModules: ['Sale Listings', 'Documents', 'Title & Transfer'],
    permissions: ['Packet viewing', 'Client document upload', 'Saved listing access'],
  },
  {
    role: 'Medical Lead',
    label: 'Medical Lead',
    summary: 'Care cadence, treatment history, medical kits, and review.',
    primaryModules: ['Medical', 'Documents'],
    permissions: ['Vet note review', 'Care protocol updates', 'Travel hold approvals'],
  },
  {
    role: 'Sales Lead',
    label: 'Sales Lead',
    summary: 'Listing quality, record completeness, and transfer blockers.',
    primaryModules: ['Sales', 'Horses', 'Sale Listings'],
    permissions: ['Listing packet edits', 'Lead tracking', 'Shareable presentation controls'],
  },
];

export const salesLeadsSeed: SalesLead[] = [
  // Empty by default. Leads should only appear when captured from real outreach.
];

export const sharedAccessSeed: SharedAccessSnapshot = {
  invitedOwners: 0,
  activeOwners: 0,
  savedHorses: 0,
  openInquiries: 0,
};

export const sharedListingsSeed: SharedListingRecord[] = [
  // Empty by default. Shared listings are created from real horses.
];

export const workspaceProfileSeed: WorkspaceProfile = {
  ranchName: '',
  businessName: '',
  defaultOwnerName: '',
  defaultOwnerEntity: '',
  ranchManagerName: '',
  operationsEmail: '',
  defaultBarn: '',
  defaultPasture: '',
  workspaceShortcuts: [],
  setupCompleteAt: '',
};

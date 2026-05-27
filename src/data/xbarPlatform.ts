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
  brandedListings: false,
  featureFlags: [
    'First-run workspace setup',
    'Manual document intake',
    'Receipt logging',
    'Horse ledger',
  ],
  usage: {
    seatsUsed: 0,
    seatLimit: 2,
    documentsProcessed: 0,
    documentLimit: 250,
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
    summary: 'Horse ops, ranch assets, and active blockers.',
    primaryModules: ['Dashboard', 'Horses', 'Ranch Assets'],
    permissions: ['Horse updates', 'Asset assignments', 'Medical watch visibility'],
  },
  {
    role: 'Owner',
    label: 'Horse Owner / Client',
    summary: 'Read-only horse records, documents, and sale packets.',
    primaryModules: ['Buyer Rooms', 'Documents', 'Title & Transfer'],
    permissions: ['Packet viewing', 'Client document upload', 'Saved listing access'],
  },
  {
    role: 'Medical Lead',
    label: 'Medical Lead',
    summary: 'Care cadence, treatment history, kit readiness, and review.',
    primaryModules: ['Medical', 'Documents'],
    permissions: ['Vet note review', 'Care protocol updates', 'Travel hold approvals'],
  },
  {
    role: 'Sales Lead',
    label: 'Sales Lead',
    summary: 'Listing quality, buyer trust, and transfer blockers.',
    primaryModules: ['Sales', 'Horses', 'Shared Access'],
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

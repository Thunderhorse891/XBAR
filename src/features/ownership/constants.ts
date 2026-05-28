import type { DocumentType, OwnershipStake, TransferStatus } from '@/types/xbar';

export const ownershipRoles: OwnershipStake['role'][] = [
  'Legal Owner',
  'Co-Owner',
  'Managing Partner',
  'Prospective Buyer',
];

export const transferStatuses: TransferStatus[] = [
  'Clear',
  'Pending Signatures',
  'AQHA Review',
  'Attention Required',
];

export const ownershipDocumentTypes: DocumentType[] = [
  'Bill of Sale',
  'Registration',
  'Transfer Packet',
  'Ownership Memo',
];

export type SortMode = 'Deadline' | 'Horse' | 'Status' | 'Confidence';

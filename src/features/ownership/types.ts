import type { HorseRecord, OwnershipRecord, TransferStatus } from '@/types/xbar';

export type OwnerRegistryRow = {
  name: string;
  contact: string;
  horses: string[];
  roles: string[];
  shares: number[];
  statuses: TransferStatus[];
};

export type RelationshipRow = {
  horse: HorseRecord;
  record?: OwnershipRecord;
  currentOwner: string;
  totalShare: number;
  acquisitionDate: string;
  status: TransferStatus;
  deadline: string;
  pendingDocuments: string[];
  billOfSaleCount: number;
  registrationCount: number;
  transferDocCount: number;
};

import type { DocumentRecord, HorseRecord, OwnershipRecord } from '@/types/xbar';
import { normalize, ownershipDocsForHorse, firstAuditDate } from './helpers';
import type { OwnerRegistryRow, RelationshipRow } from './types';

export function createRelationshipRows(
  horses: HorseRecord[],
  ownershipRecords: OwnershipRecord[],
  documents: DocumentRecord[],
): RelationshipRow[] {
  return horses.map((horse) => {
    const record = ownershipRecords.find((item) => item.horseId === horse.id);
    const horseDocs = ownershipDocsForHorse(documents, horse.id);
    const totalShare = horse.ownership.reduce((sum, stake) => sum + stake.share, 0);
    const legalStake = horse.ownership.find((stake) => stake.role === 'Legal Owner');
    const pending = [...(record?.pendingDocuments ?? [])];

    if (!record) {
      pending.unshift('Ownership record missing');
    }
    if (!horseDocs.some((document) => document.type === 'Bill of Sale' && document.state === 'Ready')) {
      pending.unshift('Bill of sale missing');
    }
    if (!horseDocs.some((document) => document.type === 'Registration' && document.state === 'Ready')) {
      pending.unshift('Registration missing');
    }

    return {
      horse,
      record,
      currentOwner: record?.legalOwner || legalStake?.name || horse.owner || 'Unknown owner',
      totalShare,
      acquisitionDate: firstAuditDate(record),
      status: record?.transferStatus ?? 'Attention Required',
      deadline: record?.complianceDeadline ?? '',
      pendingDocuments: Array.from(new Set(pending)),
      billOfSaleCount: horseDocs.filter((document) => document.type === 'Bill of Sale').length,
      registrationCount: horseDocs.filter((document) => document.type === 'Registration').length,
      transferDocCount: horseDocs.filter(
        (document) => document.type === 'Transfer Packet' || document.type === 'Ownership Memo',
      ).length,
    };
  });
}

export function createOwnerRegistry(relationshipRows: RelationshipRow[]): OwnerRegistryRow[] {
  const rows = new Map<string, OwnerRegistryRow>();

  const upsertOwner = (params: {
    name: string;
    contact?: string;
    horseName?: string;
    role?: string;
    share?: number;
    status?: RelationshipRow['status'];
  }) => {
    const key = normalize(params.name);
    if (!key) {
      return;
    }

    const existing: OwnerRegistryRow =
      rows.get(key) ??
      {
        name: params.name.trim(),
        contact: params.contact?.trim() ?? '',
        horses: [],
        roles: [],
        shares: [],
        statuses: [],
      };

    if (!existing.contact && params.contact?.trim()) {
      existing.contact = params.contact.trim();
    }
    if (params.horseName && !existing.horses.includes(params.horseName)) {
      existing.horses.push(params.horseName);
    }
    if (params.role && !existing.roles.includes(params.role)) {
      existing.roles.push(params.role);
    }
    if (typeof params.share === 'number') {
      existing.shares.push(params.share);
    }
    if (params.status && !existing.statuses.includes(params.status)) {
      existing.statuses.push(params.status);
    }

    rows.set(key, existing);
  };

  relationshipRows.forEach((row) => {
    upsertOwner({
      name: row.currentOwner,
      horseName: row.horse.name,
      role: 'Legal Owner',
      share: row.horse.ownership.find((stake) => normalize(stake.name) === normalize(row.currentOwner))?.share,
      status: row.status,
    });

    row.horse.ownership.forEach((stake) => {
      upsertOwner({
        name: stake.name,
        contact: stake.contact,
        horseName: row.horse.name,
        role: stake.role,
        share: stake.share,
        status: row.status,
      });
    });
  });

  return Array.from(rows.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function filterAndSortRelationshipRows(
  relationshipRows: RelationshipRow[],
  query: string,
  statusFilter: string,
  sortMode: string,
): RelationshipRow[] {
  const normalizedQuery = normalize(query);

  const matches = relationshipRows.filter((row) => {
    const haystack = [
      row.horse.name,
      row.horse.barnName,
      row.currentOwner,
      row.status,
      row.pendingDocuments.join(' '),
      row.horse.ownership.map((stake) => `${stake.name} ${stake.contact} ${stake.role}`).join(' '),
    ]
      .join(' ')
      .toLowerCase();

    return (!normalizedQuery || haystack.includes(normalizedQuery)) && (statusFilter === 'All' || row.status === statusFilter);
  });

  return [...matches].sort((left, right) => {
    if (sortMode === 'Horse') {
      return left.horse.name.localeCompare(right.horse.name);
    }
    if (sortMode === 'Status') {
      return left.status.localeCompare(right.status) || left.horse.name.localeCompare(right.horse.name);
    }
    if (sortMode === 'Confidence') {
      return (right.record?.confidence ?? 0) - (left.record?.confidence ?? 0);
    }

    return Date.parse(left.deadline || '9999-12-31') - Date.parse(right.deadline || '9999-12-31');
  });
}

export function getPendingTransfers(ownershipRecords: OwnershipRecord[]): OwnershipRecord[] {
  return ownershipRecords.filter((record) => record.transferStatus !== 'Clear');
}

export function getMissingDocumentRows(relationshipRows: RelationshipRow[]): RelationshipRow[] {
  return relationshipRows.filter((row) => row.pendingDocuments.length > 0);
}

export function getHorsesWithOwnership(relationshipRows: RelationshipRow[]): number {
  return relationshipRows.filter((row) => row.record).length;
}

export function getLatestOwnershipDocuments(
  documents: DocumentRecord[],
  types: string[],
  limit = 6,
): DocumentRecord[] {
  return documents
    .filter((document) => types.includes(document.type))
    .slice()
    .sort((left, right) => Date.parse(right.uploadedAt) - Date.parse(left.uploadedAt))
    .slice(0, limit);
}

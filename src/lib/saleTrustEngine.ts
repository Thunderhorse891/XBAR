import type { DocumentRecord, HorseRecord, OwnershipRecord } from '../types/xbar.js';

export type SaleHold = {
  held: boolean;
  reasons: string[];
  ownershipConfidence: number;
  transferStatus: string;
  missingTitleProof: string[];
};

function hasCurrentCoggins(documents: DocumentRecord[], horseId: string, now = new Date()) {
  return documents
    .filter((document) => document.horseId === horseId && document.type === 'Coggins' && document.state === 'Ready')
    .some((document) => {
      const parsed = Date.parse(document.entities.examDate ?? document.uploadedAt);
      return Number.isFinite(parsed) && now.getTime() - parsed <= 365 * 24 * 60 * 60 * 1000;
    });
}

export function buildSaleHold(horse: HorseRecord, documents: DocumentRecord[], ownershipRecord?: OwnershipRecord, now = new Date()): SaleHold {
  const reasons: string[] = [];
  const missingTitleProof = [...(ownershipRecord?.pendingDocuments ?? [])];
  const hasOwnershipProof = documents.some((document) =>
    document.horseId === horse.id &&
    document.state === 'Ready' &&
    ['Registration', 'Bill of Sale', 'Transfer Packet', 'Ownership Memo'].includes(document.type));

  if (horse.status === 'Medical Review') reasons.push('Medical Review blocks sale release.');
  if (!hasCurrentCoggins(documents, horse.id, now)) reasons.push('Current Coggins is missing.');
  if (!ownershipRecord) reasons.push('Ownership record is missing.');
  if (ownershipRecord && ownershipRecord.transferStatus !== 'Clear') reasons.push(`Transfer status is ${ownershipRecord.transferStatus}.`);
  if (!hasOwnershipProof) {
    reasons.push('Registry or legal-owner proof is missing.');
    missingTitleProof.push('Registry or legal-owner proof');
  }
  horse.alerts.filter((alert) => alert.severity === 'high').forEach((alert) => reasons.push(`${alert.title}: ${alert.summary}`));

  return {
    held: reasons.length > 0,
    reasons: [...new Set(reasons)],
    ownershipConfidence: ownershipRecord?.confidence ?? 0,
    transferStatus: ownershipRecord?.transferStatus ?? 'Attention Required',
    missingTitleProof: [...new Set(missingTitleProof)],
  };
}

export function applyAutomaticSaleHolds(horses: HorseRecord[], documents: DocumentRecord[], ownershipRecords: OwnershipRecord[]) {
  return horses.map((horse) => {
    const hold = buildSaleHold(horse, documents, ownershipRecords.find((record) => record.horseId === horse.id));
    if (hold.held && horse.sale.listingState !== 'Private') return { ...horse, sale: { ...horse.sale, listingState: 'Hold' as const } };
    if (!hold.held && horse.sale.listingState === 'Hold') return { ...horse, sale: { ...horse.sale, listingState: 'Buyer Review' as const } };
    return horse;
  });
}

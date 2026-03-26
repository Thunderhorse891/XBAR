import { createId, todayStamp } from '../lib/xbarRuntime.js';
import type {
  AssetCondition,
  AssetStatus,
  DocumentRecord,
  DocumentSource,
  HorseNote,
  HorseRecord,
  HorseSegment,
  HorseSex,
  HorseStatus,
  IntakeBatch,
  OwnershipRecord,
  SalesLead,
} from '../types/xbar.js';

export type NewHorseInput = {
  name: string;
  barnName: string;
  segment: HorseSegment;
  status: HorseStatus;
  sex: HorseSex;
  owner: string;
  ownerEntity: string;
  aqhaNumber?: string;
  registrationNumber?: string;
  barn: string;
  pasture: string;
};

export type DocumentIntakeInput = {
  files: File[];
  horseId?: string;
  source: DocumentSource;
  uploadedBy: string;
  label?: string;
};

export type MediaUploadInput = {
  horseId: string;
  files: File[];
  kind?: 'Hero' | 'Conformation' | 'Sale Still' | 'Pedigree' | 'Document Cover';
  makePrimary?: boolean;
};

export type LeadInput = {
  name: string;
  channel: SalesLead['channel'];
  horseId: string;
  portalReady?: boolean;
};

export type AssetPatch = {
  status?: AssetStatus;
  condition?: AssetCondition;
  assignedTo?: string;
  location?: string;
  nextService?: string;
  notes?: string;
};

export type LocationPatch = {
  barn?: string;
  pasture?: string;
  stall?: string;
};

function requireValue(value: string, label: string, minLength = 2) {
  if (value.trim().length < minLength) {
    return `${label} is required.`;
  }

  return null;
}

export function createOwnershipRecord(horse: HorseRecord): OwnershipRecord {
  return {
    id: createId('ownership'),
    horseId: horse.id,
    legalOwner: horse.owner,
    transferStatus: 'Attention Required',
    pendingDocuments: ['Ownership memo', 'Registration proof'],
    complianceDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    confidence: 35,
    auditTrail: [
      `${todayStamp()} Ownership record created from horse intake`,
      `${todayStamp()} Supporting ownership documents still need upload`,
    ],
  };
}

export function validateNewHorseInput(input: NewHorseInput) {
  return (
    requireValue(input.name, 'Registered name', 3) ??
    requireValue(input.barnName, 'Barn name', 2) ??
    requireValue(input.owner, 'Owner', 2) ??
    requireValue(input.ownerEntity, 'Owner entity', 2) ??
    requireValue(input.barn, 'Barn', 2) ??
    requireValue(input.pasture, 'Pasture', 2)
  );
}

export function validateLeadInput(input: LeadInput) {
  return requireValue(input.name, 'Lead name', 2);
}

export function validateHorseNoteInput(note: Pick<HorseNote, 'title' | 'body' | 'author' | 'tone'>) {
  return requireValue(note.title, 'Note title', 2) ?? requireValue(note.body, 'Note body', 4) ?? requireValue(note.author, 'Author', 2);
}

export function validateLocationPatch(patch: LocationPatch) {
  if (!patch.barn?.trim() && !patch.pasture?.trim() && !patch.stall?.trim()) {
    return 'Enter at least one location field before saving.';
  }

  return null;
}

export function validateAssetPatch(patch: AssetPatch) {
  if (!patch.location?.trim()) {
    return 'Location is required before saving an asset.';
  }

  if ((patch.status === 'Assigned' || patch.status === 'In Service') && !patch.assignedTo?.trim()) {
    return 'Assigned to is required when an asset is assigned or in service.';
  }

  if ((patch.status === 'In Service' || patch.condition === 'Service Soon' || patch.condition === 'Attention Required') && !patch.nextService?.trim()) {
    return 'Next service date is required for maintenance-sensitive assets.';
  }

  return null;
}

export function summarizeBatch(batch: IntakeBatch, documents: DocumentRecord[]): IntakeBatch {
  const batchDocuments = documents.filter((document) => document.batchId === batch.id);
  if (!batchDocuments.length) {
    return batch;
  }

  const fileCount = batchDocuments.length;
  const processedCount = batchDocuments.filter((document) => document.state !== 'Queued').length;
  const needsReviewCount = batchDocuments.filter((document) => document.state === 'Needs Review').length;
  const matchedCount = batchDocuments.filter((document) => document.state === 'Matched' || document.state === 'Ready').length;

  let state: IntakeBatch['state'] = 'Queued';
  if (needsReviewCount > 0) {
    state = 'Reviewing';
  } else if (matchedCount >= fileCount) {
    state = 'Completed';
  }

  return {
    ...batch,
    fileCount,
    processedCount,
    needsReviewCount,
    matchedCount,
    state,
  };
}

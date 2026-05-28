import type { DocumentRecord, TransferStatus } from '@/types/xbar';
import { ownershipDocumentTypes } from './constants';
import type { RelationshipRow } from './types';

export function transferTone(status: TransferStatus): 'emerald' | 'blue' | 'amber' | 'rose' {
  if (status === 'Clear') return 'emerald';
  if (status === 'AQHA Review') return 'blue';
  if (status === 'Pending Signatures') return 'amber';
  return 'rose';
}

export function documentTone(document: DocumentRecord): 'emerald' | 'blue' | 'amber' | 'slate' {
  if (document.state === 'Ready') return 'emerald';
  if (document.state === 'Matched') return 'blue';
  if (document.state === 'Needs Review') return 'amber';
  return 'slate';
}

export function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function scrollToSection(sectionId: string): void {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function ownershipDocsForHorse(documents: DocumentRecord[], horseId: string): DocumentRecord[] {
  return documents.filter((document) => document.horseId === horseId && ownershipDocumentTypes.includes(document.type));
}

export function firstAuditDate(record?: RelationshipRow['record']): string {
  const firstEntry = record?.auditTrail[0];
  const match = firstEntry?.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? '';
}

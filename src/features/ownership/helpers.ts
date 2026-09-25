import type { DocumentRecord } from '@/types/xbar';
import { ownershipDocumentTypes } from './constants';
import type { RelationshipRow } from './types';

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

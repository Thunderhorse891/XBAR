import type {
  DocumentRecord,
  DocumentEntities,
  HorseRecord,
  OwnershipProofKind,
  OwnershipProofRequirement,
  OwnershipRecord,
} from '../types/xbar.js';
import { sha256 } from './sha256.js';
import { extractRegistrationFields } from './registrationExtraction.js';
import { horseIdentityConflicts, registrationKey, hasDocumentSourceHeading, inferDocumentType } from './xbarRuntime.js';
import { extractionProducedNothing } from './documentIntelligence.js';
import { hasStoredFile } from './storedFiles.js';
import { documentDuplicateNeedsReview } from './documentDuplicates.js';

export type OwnershipDocumentReview = {
  ok: boolean;
  status: 'missing' | 'unreadable' | 'wrong_type' | 'identity_mismatch' | 'missing_identity' | 'review_needed';
  message: string;
};
const normalize = (value: string | undefined) => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ownershipTypes: DocumentRecord['type'][] = ['Registration', 'Bill of Sale', 'Transfer Packet', 'Ownership Memo'];
export const ownershipProofDocumentTypes: Record<OwnershipProofKind, DocumentRecord['type'][]> = {
  bill_of_sale: ['Bill of Sale'],
  registration_certificate: ['Registration'],
  transfer_form: ['Transfer Packet'],
  signature_page: ['Bill of Sale', 'Transfer Packet', 'Ownership Memo'],
  supporting: ownershipTypes,
};
const sourceCues: Record<OwnershipProofKind, RegExp> = {
  bill_of_sale: /\bbill\s+of\s+sale\b|\bpurchase\s+(?:and\s+sale\s+)?agreement\b/i,
  registration_certificate: /\bcertificate\s+of\s+registration\b|\bregistration\s+certificate\b/i,
  transfer_form: /\btransfer\s+(?:of\s+ownership|report|form|application|ownership)\b|\bownership\s+transfer\b/i,
  signature_page: /\bsignature\b|\bsigned\s+by\b|\b(?:seller|buyer)(?:'s)?\s+sign/i,
  supporting: /\b(?:owner|ownership|bill\s+of\s+sale|registration|transfer)\b/i,
};

function ownershipIdentityConflicts(horse: HorseRecord, entities?: DocumentEntities): boolean {
  if (horseIdentityConflicts(horse, entities)) return true;
  return (['sire', 'dam'] as const).some((parent) => {
    const stored = horse.bloodline?.[parent]?.trim();
    if (!stored) return false;
    // Imported parent IDs are displayed as "NAME (1234567)" in the profile.
    const storedId = stored.match(/\s+\(([^()]+)\)\s*$/)?.[1];
    const storedName = storedId ? stored.replace(/\s+\([^()]+\)\s*$/, '') : stored;
    const sourceName = entities?.[parent];
    const sourceId = entities?.[parent === 'sire' ? 'sireRegistration' : 'damRegistration'];
    return Boolean(
      (sourceName && normalize(sourceName) !== normalize(storedName)) ||
      (sourceId && storedId && registrationKey(sourceId) !== registrationKey(storedId)),
    );
  });
}

function microchipKey(value: string): string | undefined {
  // Recognize complete ISO and legacy identifiers, including scanner separators.
  // Words such as UNKNOWN or scanned are missing information, not conflicting IDs.
  const key = value
    .replace(/^AVID\*/i, '')
    .replace(/[.*\s-]/g, '')
    .toLowerCase();
  // Some readers prefix the 15-digit ISO display with its application bit.
  if (/^0\d{15}$/.test(key)) return key.slice(1);
  return /^(?:\d{9}|\d{15}|1\d{15}|[a-f0-9]{10})$/.test(key) ? key : undefined;
}

function sourceMicrochipKey(value: string): string | undefined {
  const tokens = value.trim().split(/\s+/);
  // A complete legacy numeric ID followed by prose/batch text is not a hex ID.
  // Numeric continuation remains eligible for a grouped ISO identifier.
  for (let end = 1; end < tokens.length; end += 1) {
    const prefix = microchipKey(tokens.slice(0, end).join(' '));
    if (prefix?.length === 9 && /^[a-z]/i.test(tokens[end])) return prefix;
  }
  const complete = microchipKey(value);
  if (complete) return complete;
  // OCR can place an unrelated date/count after a complete identifier. Preserve
  // the longest complete identifier at a token boundary, never a substring of
  // a malformed token (for example 900123456789012X).
  for (let end = tokens.length - 1; end > 0; end -= 1) {
    const prefix = microchipKey(tokens.slice(0, end).join(' '));
    if (!prefix) continue;
    // A nine-digit token can be the first group of a malformed ISO identifier.
    // Keep longer complete IDs when OCR appends a separate date or batch token.
    if (
      prefix.length !== 9 ||
      /^[a-z]/i.test(tokens[end]) ||
      tokens.slice(end).every((token) => /^[a-f0-9.*-]+$/i.test(token))
    )
      return prefix;
  }
  return undefined;
}

/** The same source identity screen for document movement, approval and ownership.
 * Cached entities in older backups may have been filled from the selected horse;
 * they cannot override contradictory identity still present in the original text.
 * No readable identity is an explicit manual assignment, not proof of ownership.
 */
export function inspectDocumentHorseIdentity(document: DocumentRecord, horse: HorseRecord) {
  const sourceIdentity = extractRegistrationFields(
    document.extractedTextPreview.replace(/(^|\n)\s*horse\s*[:#]\s*/gi, '$1Horse Name: '),
  );
  const sourceChips = [
    ...document.extractedTextPreview.matchAll(
      /\bmicrochip\b(?:\s+(?:number|no\.?|id))?(?:\s*[:#-])*\s*([^\s,;:()]+(?:\s+(?:(?=[A-Z0-9.*_-]*\d)[A-Z0-9.*_-]+|[A-F.*-]+)(?=[\s,;:()]|$))*)/gi,
    ),
  ]
    .map((match) => sourceMicrochipKey(match[1]))
    .filter((chip): chip is string => Boolean(chip));
  const storedChip = horse.microchipId && (microchipKey(horse.microchipId.trim()) ?? normalize(horse.microchipId));
  const conflictReason =
    document.identityReviewRequired || sourceIdentity.identityReviewRequired
      ? 'The source contains ambiguous horse identities. Upload separate or corrected papers.'
      : ownershipIdentityConflicts(horse, document.entities) || ownershipIdentityConflicts(horse, sourceIdentity)
        ? 'The readable source or extracted identity conflicts with the selected horse. Choose the correct horse or upload corrected papers.'
        : new Set(sourceChips).size > 1 || (storedChip && sourceChips.some((chip) => chip !== storedChip))
          ? 'The source microchip conflicts with this horse. Review the original and correct the record.'
          : undefined;
  return { sourceIdentity, conflictReason };
}

/** A content/identity screen, never a legal opinion or automatic verification. */
export function assessOwnershipDocument(
  document: DocumentRecord | undefined,
  horse: HorseRecord | undefined,
  kind: OwnershipProofKind,
): OwnershipDocumentReview {
  const fail = (status: OwnershipDocumentReview['status'], message: string): OwnershipDocumentReview => ({
    ok: false,
    status,
    message,
  });
  if (!document || document.state === 'Archived' || !hasStoredFile(document))
    return fail('missing', 'Source file is missing or archived. Upload the original document.');
  if (
    !horse ||
    document.horseId !== horse.id ||
    document.identityReviewRequired ||
    ownershipIdentityConflicts(horse, document.entities)
  )
    return fail(
      'identity_mismatch',
      'This document is not matched to this horse, or its extracted identity conflicts. Correct the assignment or upload the correct source.',
    );
  if (!document.extractedTextPreview.trim() || extractionProducedNothing(document.processingNote))
    return fail('unreadable', 'No readable source text. Upload a clearer scan before using this as ownership support.');
  if (document.processingNote?.trim())
    return fail(
      'review_needed',
      `The source was not fully read: ${document.processingNote} Upload a complete readable copy.`,
    );
  const text = document.extractedTextPreview;
  if (inferDocumentType('', text).ambiguous)
    return fail(
      'wrong_type',
      'The source contains conflicting document purposes. Upload the correct separate source for this requirement.',
    );

  const purposeMatches =
    kind === 'signature_page'
      ? sourceCues.signature_page.test(text) &&
        (hasDocumentSourceHeading(text, sourceCues.signature_page) ||
          hasDocumentSourceHeading(text, sourceCues.bill_of_sale) ||
          hasDocumentSourceHeading(text, sourceCues.transfer_form) ||
          hasDocumentSourceHeading(text, /\bownership\s+(?:memo|statement|declaration)\b/i))
      : hasDocumentSourceHeading(text, sourceCues[kind]);
  if (!ownershipProofDocumentTypes[kind]?.includes(document.type) || !purposeMatches)
    return fail(
      'wrong_type',
      'The document type or readable contents do not match this requirement. A filename alone is not evidence.',
    );
  const { sourceIdentity, conflictReason } = inspectDocumentHorseIdentity(document, horse);
  if (conflictReason) return fail('identity_mismatch', conflictReason);
  const nameMatches = Boolean(
    sourceIdentity.horseName &&
    [horse.name, horse.barnName].some((name) => normalize(name) === normalize(sourceIdentity.horseName)),
  );
  const registration = registrationKey(sourceIdentity.registrationNumber);
  const registrationMatches = Boolean(
    registration && registration === registrationKey(horse.registrationNumber || horse.aqhaNumber),
  );
  if (!nameMatches && !registrationMatches)
    return fail(
      'missing_identity',
      'No matching horse name or registration number was read from the source. Upload a document that identifies this horse.',
    );
  if (document.state !== 'Ready')
    return fail('review_needed', 'Review and approve the document in Documents → Review first.');
  if (documentDuplicateNeedsReview(document))
    return fail('review_needed', 'Resolve the duplicate warning in Documents → Review first.');
  return {
    ok: true,
    status: 'review_needed',
    message:
      'Content and horse identity checks passed. A person must inspect the original, parties, dates and signatures. XBAR does not verify legal ownership.',
  };
}

export function ownershipReviewBlockers(
  record: OwnershipRecord | undefined,
  horse: HorseRecord,
  documents: DocumentRecord[],
): string[] {
  if (!record?.proofRequirements?.length) return ['Ownership document checklist has not been reviewed.'];
  return record.proofRequirements.flatMap((requirement) => {
    const document = documents.find((item) => item.id === requirement.documentId);
    const assessment = assessOwnershipDocument(document, horse, requirement.kind);
    if (!assessment.ok) return [`${requirement.label}: ${assessment.message}`];
    if (!isOwnershipProofReviewed(requirement, document))
      return [`${requirement.label}: Human source review is still required.`];
    return [];
  });
}

export function ownershipDocumentReviewKey(document: DocumentRecord): string {
  return sha256(
    JSON.stringify([
      document.id,
      document.horseId ?? '',
      document.type,
      document.contentSha256 ?? '',
      document.storagePath ?? '',
      document.localFileKey ?? '',
      document.fileUrl ?? '',
      document.extractedTextPreview,
    ]),
  );
}

export function isOwnershipProofReviewed(requirement: OwnershipProofRequirement, document?: DocumentRecord): boolean {
  return (
    requirement.status === 'verified' &&
    Boolean(
      requirement.reviewAttestedAt &&
      requirement.verifiedBy?.trim() &&
      requirement.verifiedAt &&
      requirement.reviewedSourceKey,
    ) &&
    (!document || requirement.reviewedSourceKey === ownershipDocumentReviewKey(document))
  );
}

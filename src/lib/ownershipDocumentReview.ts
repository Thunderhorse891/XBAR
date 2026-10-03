import type {
  DocumentRecord,
  DocumentEntities,
  HorseRecord,
  OwnershipProofKind,
  OwnershipProofRequirement,
  OwnershipRecord,
} from '../types/xbar.js';
import { sha256 } from './sha256.js';
import {
  extractRegistrationFields,
  normalizePedigreeValue,
  registrationFieldLabelPattern,
} from './registrationExtraction.js';
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
    const sourceName = normalizePedigreeValue(entities?.[parent]);
    const sourceId = normalizePedigreeValue(entities?.[parent === 'sire' ? 'sireRegistration' : 'damRegistration']);
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

function sourceMicrochipKeys(value: string): string[] {
  const tokens = value.trim().split(/\s+/);
  while (tokens.length && !/^(?:AVID\*)?[a-f0-9.*-]+$/i.test(tokens[tokens.length - 1])) tokens.pop();
  // A bare year after a complete ISO identifier is metadata, not an extra
  // scanner group that can repartition that identifier into shorter chips.
  if (
    /^(?:19|20)\d{2}$/.test(tokens[tokens.length - 1] ?? '') &&
    microchipKey(tokens.slice(0, -1).join(' '))?.length === 15
  )
    tokens.pop();
  type Parsed = { keys: string[]; complete: boolean };
  const parsed: Parsed[] = Array.from({ length: tokens.length + 1 }, () => ({ keys: [], complete: true }));
  // Retain every complete scanner-group partition. If more than one identity
  // interpretation is possible, their union forces review instead of choosing
  // the most convenient first/last value or maximizing consumed characters.
  for (let start = tokens.length - 1; start >= 0; start -= 1) {
    const candidates: Parsed[] = [];
    let joined = '';
    let previousKey: string | undefined;
    for (let end = start; end < tokens.length; end += 1) {
      const token = tokens[end];
      if (!/^(?:AVID\*)?[a-f0-9.*-]+$/i.test(token)) break;
      // A trailing prose "A" must not turn a complete legacy ID into hex.
      if (previousKey?.length === 9 && /^[a-z]/i.test(token)) break;
      joined += token;
      const compact = joined.replace(/^AVID\*/i, '').replace(/[.*-]/g, '');
      if (compact.length > 16) break;
      const key = microchipKey(joined);
      previousKey = key;
      if (!key) continue;
      const next = tokens[end + 1];
      const malformedContinuation =
        key.length === 9 && next && /^\d/.test(next) && /[a-z_]/i.test(next) && !microchipKey(next);
      if (!malformedContinuation) {
        const remaining = parsed[end + 1];
        candidates.push({ keys: [key, ...remaining.keys], complete: remaining.complete });
      }
      if (key.length >= 15) break;
    }
    const complete = candidates.filter((candidate) => candidate.complete);
    if (complete.length) {
      parsed[start] = { keys: [...new Set(complete.flatMap((candidate) => candidate.keys))], complete: true };
    } else if (candidates.length) {
      // Preserve a complete leading identifier even when OCR appends an
      // unrelated date/count that is not another complete identifier.
      parsed[start] = candidates[candidates.length - 1];
    } else {
      const remaining = parsed[start + 1];
      parsed[start] = {
        keys: remaining.keys,
        complete: !/^(?:AVID\*)?[a-f0-9.*-]+$/i.test(tokens[start]) && remaining.complete,
      };
    }
  }
  return parsed[0].keys;
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
  // Read the whole labeled field independent of status wording or wrapping.
  // Only a paragraph break, another chip label, or an explicit neighboring
  // field ends it; unfamiliar/malformed continuation is evidence, not absence.
  const chipSpans: string[] = [];
  const neighboringField = `${registrationFieldLabelPattern}|date|dob|born|weight|batch|lot|invoice|phone|reg\\.?`;
  const text = document.extractedTextPreview;
  const labels = [...text.matchAll(/\bmicrochip\b/gi)];
  for (const [index, label] of labels.entries()) {
    const start = label.index + label[0].length;
    const limit = labels[index + 1]?.index ?? text.length;
    let span = text.slice(start, limit).split(/\r?\n[ \t]*\r?\n/)[0];
    // Flattened OCR can place another explicitly labeled field on this line.
    span = span.split(new RegExp(String.raw`\b(?:${neighboringField})\b[^:#=\r\n]{0,30}[:#=]`, 'i'))[0];
    // OCR may omit field punctuation. A named numeric field followed by its
    // value is still a boundary, including on a flattened single line.
    span = span.split(
      new RegExp(String.raw`\b(?:${neighboringField})(?:\s+(?:number|no\.?))?\s+(?=[+]?(?:[a-z]{0,5})\d)`, 'i'),
    )[0];
    chipSpans.push(span);
  }
  const sourceChips = chipSpans
    .flatMap((span) => span.split(/\s*(?:[,;:/|&()]|\band\b|\bor\b)\s*/i))
    .flatMap(sourceMicrochipKeys);
  // Unusual punctuation can prevent token attribution. Never turn a complete
  // identifier-shaped value in the chip field into silent absence.
  const unparsedChipEvidence = chipSpans.some((span) => {
    if (/\b\d{9}\s+\d+[a-z_][a-z0-9_]*/i.test(span)) return true;
    if (
      [...span.matchAll(/[a-z0-9_*.-]+/gi)].some(
        ([token]) => (token.match(/\d/g)?.length ?? 0) >= 9 && !microchipKey(token),
      )
    )
      return true;
    return [...span.matchAll(/\b(?:\d{15,16}|\d{9}|[a-f0-9]{10})\b/gi)].some((match) => {
      const key = microchipKey(match[0]);
      const continuation = span.slice(match.index + match[0].length).match(/^\s+(\d{6})\b/)?.[1];
      const grouped = key?.length === 9 && continuation ? microchipKey(`${key}${continuation}`) : undefined;
      return key && !sourceChips.includes(key) && !(grouped && sourceChips.includes(grouped));
    });
  });
  const storedChip = horse.microchipId && (microchipKey(horse.microchipId.trim()) ?? normalize(horse.microchipId));
  const conflictReason =
    document.identityReviewRequired || sourceIdentity.identityReviewRequired || unparsedChipEvidence
      ? 'The source contains ambiguous horse identities. Upload separate or corrected papers.'
      : ownershipIdentityConflicts(horse, document.entities) || ownershipIdentityConflicts(horse, sourceIdentity)
        ? 'The readable source or extracted identity conflicts with the selected horse. Choose the correct horse or upload corrected papers.'
        : new Set(sourceChips).size > 1 || (storedChip && sourceChips.some((chip) => chip !== storedChip))
          ? 'The source microchip conflicts with this horse. Review the original and correct the record.'
          : undefined;
  return { sourceIdentity, sourceChips, conflictReason };
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

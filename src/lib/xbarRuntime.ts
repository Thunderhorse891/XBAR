import type {
  DocumentRecord,
  DocumentEntities,
  DocumentSource,
  DocumentType,
  GalleryAsset,
  HorseRecord,
  SalesLead,
  WorkspaceInvitationRecord,
  WorkspaceMemberRecord,
  SharedListingRecord,
  SharedAccessSnapshot,
  SubscriptionProfile,
  SubscriptionTier,
} from '../types/xbar.js';
import { describeDocumentCoverage, fullCoverage, readDocumentWithCoverage } from './documentIntelligence.js';
import { fingerprintDocument, flagDocumentDuplicates } from './documentDuplicates.js';
import { extractRegistrationFields, normalizeDocumentIdentityText } from './registrationExtraction.js';

const GIGABYTE = 1024 * 1024 * 1024;
const BASE36_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const subscriptionTierConfig: Record<
  SubscriptionTier,
  Pick<SubscriptionProfile, 'monthlyRate' | 'sharedAccessEnabled' | 'featureFlags'> & {
    annualRate: number;
    limits: Pick<
      SubscriptionProfile['usage'],
      'horseLimit' | 'seatLimit' | 'documentLimit' | 'salePacketLimit' | 'storageLimitGb' | 'sharedAccessSeatLimit'
    >;
  }
> = {
  Starter: {
    monthlyRate: 12,
    annualRate: 120,
    sharedAccessEnabled: false,
    featureFlags: [
      'Keep clean records — horses, care, documents, expenses, reminders',
      'Documents with OCR intake and review',
      '1 seat — just you',
      '250 documents and 25 GB storage',
    ],
    limits: {
      horseLimit: 5,
      seatLimit: 1,
      documentLimit: 250,
      salePacketLimit: 2,
      storageLimitGb: 25,
      sharedAccessSeatLimit: 0,
    },
  },
  Professional: {
    monthlyRate: 29,
    annualRate: 290,
    sharedAccessEnabled: true,
    featureFlags: [
      'Everything in Starter',
      'Share approved sale packets and keep buyer follow-up in one place',
      'Sale listings for buyer-ready horse profiles',
      '5 team seats and 10 client seats',
      '1,000 documents and 100 GB storage',
    ],
    limits: {
      horseLimit: 30,
      seatLimit: 5,
      documentLimit: 1000,
      salePacketLimit: 30,
      storageLimitGb: 100,
      sharedAccessSeatLimit: 10,
    },
  },
  'Ranch Ops': {
    monthlyRate: 79,
    annualRate: 790,
    sharedAccessEnabled: true,
    featureFlags: [
      'Everything in Professional',
      'Run the operation: team roles, breeding, equipment, and supplies',
      '20 team seats and 40 client seats',
      '5,000 documents and 500 GB storage',
    ],
    limits: {
      horseLimit: 200,
      seatLimit: 20,
      documentLimit: 5000,
      salePacketLimit: 250,
      storageLimitGb: 500,
      sharedAccessSeatLimit: 40,
    },
  },
  Enterprise: {
    monthlyRate: 199,
    annualRate: 1990,
    sharedAccessEnabled: true,
    featureFlags: [
      'Everything in Ranch Ops',
      'Scale and control for large rosters and teams',
      '60 team seats and 200 client seats',
      '20,000 documents and 2,500 GB storage',
    ],
    limits: {
      horseLimit: 2000,
      seatLimit: 60,
      documentLimit: 20000,
      salePacketLimit: 2000,
      storageLimitGb: 2500,
      sharedAccessSeatLimit: 200,
    },
  },
};

export function buildSubscriptionForTier(
  current: SubscriptionProfile,
  tier: SubscriptionTier,
  options: { billingState?: SubscriptionProfile['billingState']; renewalDate?: string } = {},
): SubscriptionProfile {
  const config = subscriptionTierConfig[tier];
  return {
    ...current,
    tier,
    monthlyRate: config.monthlyRate,
    renewalDate: options.renewalDate ?? current.renewalDate,
    billingState: options.billingState ?? current.billingState,
    sharedAccessEnabled: config.sharedAccessEnabled,
    featureFlags: [...config.featureFlags],
    usage: {
      ...current.usage,
      horseLimit: config.limits.horseLimit,
      seatLimit: config.limits.seatLimit,
      documentLimit: config.limits.documentLimit,
      salePacketLimit: config.limits.salePacketLimit,
      storageLimitGb: config.limits.storageLimitGb,
      sharedAccessSeatLimit: config.limits.sharedAccessSeatLimit,
    },
  };
}

function getCryptoApi() {
  return typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
}

function createRandomBase36(length: number) {
  const cryptoApi = getCryptoApi();
  if (cryptoApi?.getRandomValues) {
    const values = cryptoApi.getRandomValues(new Uint8Array(length));
    return Array.from(values, (value) => BASE36_ALPHABET[value % BASE36_ALPHABET.length]).join('');
  }

  return Array.from({ length }, (_, index) => BASE36_ALPHABET[(Date.now() + index * 17) % BASE36_ALPHABET.length]).join(
    '',
  );
}

export function createId(prefix: string) {
  const cryptoApi = getCryptoApi();
  if (cryptoApi?.randomUUID) {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${createRandomBase36(8)}`;
}

export function createShareAccessToken(length = 18) {
  return createRandomBase36(length);
}

export function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * An absolute UTC instant, ISO 8601 (`2026-09-24T18:55:00.000Z`).
 *
 * These stamps are synced across workspace members and compared as instants —
 * `offerUpdatedAt` is ordered with `compareTimestampDesc` in
 * profitIntelligence.ts. That comparator parses the new ISO form directly
 * and interprets the legacy local `YYYY-MM-DD HH:mm` form a stale PWA tab
 * can still sync AS UTC — deterministic and identical on every client, where
 * a viewer-local parse made Chicago and Los Angeles order the same synced
 * data differently. An offset-free local wall clock is not globally
 * comparable on its own: during a DST fallback the same wall time happens
 * twice, and a later update from a western time zone sorts before an
 * earlier eastern one. UTC keeps lexicographic order identical to
 * chronological order everywhere.
 *
 * Display still reads the viewer's clock: every reader parses the stamp with
 * `new Date(...)` (see `parseDateValue` in format.ts) and formats it in local
 * time, so screens never show the raw UTC the way the old unlabeled-UTC
 * version did. Never slice these strings for display — parse them.
 */
export function nowStamp() {
  return new Date().toISOString();
}

export function normalizeStorage(value: number) {
  return Math.round(value * 1000) / 1000;
}

function normalizeToken(value: string) {
  return normalizeDocumentIdentityText(value);
}

function includesNormalized(haystack: string, needle: string) {
  const normalizedNeedle = normalizeToken(needle);
  return normalizedNeedle.length >= 3 && ` ${normalizeToken(haystack)} `.includes(` ${normalizedNeedle} `);
}

export function estimateStorageGb(files: File[]) {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return normalizeStorage(totalBytes / GIGABYTE);
}

export function guessDocumentType(fileName: string): DocumentType {
  const lower = fileName.toLowerCase();

  if (lower.includes('coggins')) return 'Coggins';
  if (lower.includes('insurance')) return 'Insurance';
  if (lower.includes('transfer')) return 'Transfer Packet';
  if (lower.includes('bill') || lower.includes('sale')) return 'Bill of Sale';
  if (lower.includes('breed') || lower.includes('stud') || lower.includes('mare')) return 'Breeding Contract';
  if (lower.includes('media') || lower.includes('photo') || lower.includes('packet')) return 'Media Kit';
  if (lower.includes('owner')) return 'Ownership Memo';
  if (lower.includes('vet') || lower.includes('exam') || lower.includes('medical')) return 'Vet Record';
  return 'Registration';
}

/** Only a source title or registry masthead establishes the paper's purpose. */
export function hasDocumentSourceHeading(text: string, cue: RegExp): boolean {
  return text.split(/[\r\n]+/).some((rawLine) => {
    const line = rawLine.trim().slice(0, 180);
    const match = line.match(cue);
    if (!match || match.index === undefined) return false;
    const prefix = line.slice(0, match.index).trim();
    return (
      !prefix ||
      /^(?:equine|AQHA|APHA|AMERICAN QUARTER HORSE ASSOCIATION|AMERICAN PAINT HORSE ASSOCIATION)$/i.test(prefix)
    );
  });
}

/** Prefer explicit source headings over camera/scanner filenames. */
export function inferDocumentType(fileName: string, text: string): { type: DocumentType; ambiguous: boolean } {
  const cues: Array<[DocumentType, RegExp]> = [
    ['Bill of Sale', /\bbill\s+of\s+sale\b|\bpurchase\s+(?:and\s+sale\s+)?agreement\b/i],
    ['Transfer Packet', /\btransfer\s+(?:of\s+ownership|report|form|application)\b|\bownership\s+transfer\b/i],
    ['Registration', /\bcertificate\s+of\s+registration\b|\bregistration\s+certificate\b/i],
    ['Coggins', /\bcoggins\b|\bequine\s+infectious\s+anemia\b/i],
    [
      'Vet Record',
      /\bvaccination\s+record\b|\bhealth\s+certificate\b|\bveterinary\s+(?:record|examination|certificate)\b/i,
    ],
  ];
  const matches = cues.filter(([, cue]) => hasDocumentSourceHeading(text, cue));
  return { type: matches.length === 1 ? matches[0][0] : guessDocumentType(fileName), ambiguous: matches.length > 1 };
}

export function guessGalleryKind(fileName: string): GalleryAsset['kind'] {
  const lower = fileName.toLowerCase();

  if (lower.includes('pedigree')) return 'Pedigree';
  if (lower.includes('cover') || lower.includes('packet')) return 'Document Cover';
  if (lower.includes('conformation')) return 'Conformation';
  if (lower.includes('sale')) return 'Sale Still';
  return 'Hero';
}

export function deriveSharedAccessSnapshot(
  sharedAccess: SharedAccessSnapshot,
  sharedListings: SharedListingRecord[],
  salesLeads: SalesLead[],
  workspaceInvitations: WorkspaceInvitationRecord[] = [],
  workspaceMembers: WorkspaceMemberRecord[] = [],
) {
  const activeListings = sharedListings.filter((listing) => listing.state !== 'Archived');
  const listedHorseIds = new Set(activeListings.map((listing) => listing.horseId));
  const openInquiries = salesLeads.filter((lead) => lead.stage !== 'Closed' && listedHorseIds.has(lead.horseId)).length;
  const invitedOwners = workspaceInvitations.filter(
    (invite) => invite.status === 'Pending' && invite.role === 'Owner',
  ).length;
  const activeOwners = workspaceMembers.filter(
    (member) => member.status === 'Active' && member.role === 'Owner',
  ).length;
  return {
    ...sharedAccess,
    invitedOwners,
    activeOwners,
    savedHorses: activeListings.length,
    openInquiries,
  };
}

export function buildSharePath(horseId: string) {
  return `/profiles/${horseId}`;
}

async function readFileTextSnippet(file: File) {
  try {
    return await readDocumentWithCoverage(file);
  } catch {
    return { text: '', coverage: { ...fullCoverage(), readFailed: true } };
  }
}

function extractLabeledText(haystack: string, labels: string[]) {
  const stopLabels = [
    'registration',
    'reg',
    'breed',
    'color',
    'colour',
    'sex',
    'gender',
    'sire',
    'dam',
    'foaled',
    'foaling',
    'birth',
    'owner',
    'breeder',
    'microchip',
    'markings',
    'registry',
  ].join('|');

  for (const label of labels) {
    const pattern = new RegExp(
      `\\b${label}\\s*[:#-]?\\s*([A-Z][A-Z0-9 .,'&-]{1,72}?)(?=\\s+(?:${stopLabels})\\b|$)`,
      'i',
    );
    const match = haystack.match(pattern);
    const value = match?.[1]
      ?.replace(/\s+/g, ' ')
      .replace(/[|;,:-]+$/g, '')
      .trim();
    if (value && value.length >= 2) {
      return value;
    }
  }

  return undefined;
}

function extractOwnerName(haystack: string) {
  return extractLabeledText(haystack, ['current\\s+owner', 'recorded\\s+owner', 'owner(?:\\s+name)?']);
}

function extractExamDate(haystack: string) {
  return haystack.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
}

function extractVeterinarian(haystack: string) {
  return haystack.match(/\bDr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/)?.[0];
}

function extractTransferStatus(haystack: string, type: DocumentType) {
  const normalized = normalizeToken(haystack);
  if (type !== 'Transfer Packet') {
    return undefined;
  }

  if (normalized.includes('aqha review')) return 'AQHA Review';
  if (normalized.includes('attention required') || normalized.includes('missing signature'))
    return 'Attention Required';
  if (normalized.includes('pending signatures') || normalized.includes('signature')) return 'Pending Signatures';
  return 'Pending Signatures';
}

export const documentIdentityReviewNote =
  'Conflicting horse identities were read from this file. Upload separate papers for each horse before approving.';

export function extractDocumentEntities(params: { fileName: string; previewText: string; inferredType: DocumentType }) {
  const { fileName, previewText, inferredType } = params;
  const haystack = `${fileName} ${previewText}`;
  // Only a subject field can supply horse identity. A known name mentioned
  // in an owner, parent, veterinarian or filename is not the paper's subject.
  // Coggins forms also use a plain "Horse:" label; route that explicit label
  // through the existing field-boundary parser rather than scanning for names.
  const registration = extractRegistrationFields(previewText.replace(/(^|\n)\s*horse\s*[:#]\s*/gi, '$1Horse Name: '));

  return {
    identityReviewRequired: registration.identityReviewRequired,
    horseName: registration.horseName,
    registrationNumber: registration.registrationNumber,
    registry: registration.registry,
    sex: registration.sex,
    color: registration.color,
    breed: registration.breed,
    foaledOn: registration.foaledOn,
    sire: registration.sire,
    sireRegistration: registration.sireRegistration,
    dam: registration.dam,
    damRegistration: registration.damRegistration,
    ownerName: registration.ownerName ?? extractOwnerName(previewText),
    examDate: inferredType === 'Vet Record' || inferredType === 'Coggins' ? extractExamDate(haystack) : undefined,
    veterinarian:
      inferredType === 'Vet Record' || inferredType === 'Coggins' ? extractVeterinarian(haystack) : undefined,
    transferStatus: extractTransferStatus(haystack, inferredType),
  } satisfies DocumentEntities & { identityReviewRequired?: boolean };
}

export type HorseMatchResult = {
  horse: HorseRecord;
  confidence: number;
  reason: string;
};

function registrationIdentity(value: string | undefined) {
  const compact = (value ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!compact) return { number: '', registry: '' };
  const parsed = extractRegistrationFields(`Registration Number: ${compact}`);
  // The field parser can recognize a prefix of an unfamiliar identifier. It
  // may normalize a stored id only when it consumed that id in full.
  if (`${parsed.registry ?? ''}${parsed.registrationNumber ?? ''}` === compact) {
    return { number: parsed.registrationNumber ?? compact, registry: parsed.registry ?? '' };
  }
  return { number: compact, registry: '' };
}

export function registrationKey(value: string | undefined) {
  return registrationIdentity(value).number;
}

export function conflictingDocumentIdentities(entities: DocumentEntities[]) {
  const names = new Set(entities.map((entry) => normalizeToken(entry.horseName ?? '')).filter(Boolean));
  const registrations = new Set(entities.map((entry) => registrationKey(entry.registrationNumber)).filter(Boolean));
  const registries = new Set(
    entities
      .map((entry) => normalizeToken(entry.registry || registrationIdentity(entry.registrationNumber).registry))
      .filter(Boolean),
  );
  return names.size > 1 || registrations.size > 1 || registries.size > 1;
}

export function horseIdentityConflicts(horse: HorseRecord, entities?: DocumentEntities) {
  const name = entities?.horseName && normalizeToken(entities.horseName);
  const registration = registrationKey(entities?.registrationNumber);
  const storedRegistration = registrationKey(horse.registrationNumber || horse.aqhaNumber);
  const storedRegistry =
    horse.registry ||
    registrationIdentity(horse.registrationNumber).registry ||
    registrationIdentity(horse.aqhaNumber).registry;
  return Boolean(
    (name && horse.name && name !== normalizeToken(horse.name) && name !== normalizeToken(horse.barnName || '')) ||
    (registration && storedRegistration && registration !== storedRegistration) ||
    (entities?.registry && storedRegistry && normalizeToken(entities.registry) !== normalizeToken(storedRegistry)),
  );
}

function scoreHorseMatch(horse: HorseRecord, search: string, entities?: DocumentEntities) {
  if (horseIdentityConflicts(horse, entities)) return null;
  let confidence = 0;
  let reason = '';

  const exactChecks: Array<[string | undefined, number, string]> = [
    [
      entities?.horseName && normalizeToken(entities.horseName) === normalizeToken(horse.name) ? horse.name : undefined,
      0.97,
      'Extracted horse name matches profile',
    ],
    [
      entities?.horseName && normalizeToken(entities.horseName) === normalizeToken(horse.barnName || '')
        ? horse.barnName
        : undefined,
      0.83,
      'Extracted horse name matches barn name',
    ],
    [
      entities?.registrationNumber &&
      registrationKey(entities.registrationNumber) === registrationKey(horse.registrationNumber || horse.aqhaNumber)
        ? entities.registrationNumber
        : undefined,
      0.99,
      'Extracted registration number matches profile',
    ],
  ];

  exactChecks.forEach(([value, nextConfidence, nextReason]) => {
    if (value && nextConfidence > confidence) {
      confidence = nextConfidence;
      reason = nextReason;
    }
  });

  const searchChecks: Array<[string, number, string]> = [
    [horse.name, 0.97, 'Horse name appears in the document'],
    [horse.registrationNumber, 0.95, 'Registration number appears in the document'],
    [horse.aqhaNumber, 0.94, 'Registry number appears in the document'],
    [horse.barnName, 0.83, 'Barn name appears in the document'],
  ];

  searchChecks.forEach(([value, nextConfidence, nextReason]) => {
    // Legacy callers without extracted fields can still request suggestions.
    // Actual intake/review supplies entities and must never turn a raw mention
    // into automatic identity after the structured parser refused it.
    if (!entities && includesNormalized(search, value) && nextConfidence > confidence) {
      confidence = nextConfidence;
      reason = nextReason;
    }
  });

  return confidence > 0 ? { horse, confidence, reason } : null;
}

export function rankHorseMatches(horses: HorseRecord[], haystack: string, entities?: DocumentEntities) {
  const normalizedSearch = normalizeToken(haystack);

  return horses
    .map((horse) => scoreHorseMatch(horse, normalizedSearch, entities))
    .filter((match): match is HorseMatchResult => Boolean(match))
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3);
}

/** Use the same identity decision during intake and the review-stage retry. */
export function resolveDocumentHorseMatch(horses: HorseRecord[], haystack: string, entities: DocumentEntities) {
  const candidates = rankHorseMatches(horses, haystack, entities);
  const registrationMatches = candidates.filter((candidate) => candidate.confidence === 0.99);
  // Registered names and barn aliases are different namespaces. Their score
  // must not decide which of two viable horses the paper belongs to.
  const match =
    registrationMatches.length === 1 ? registrationMatches[0] : candidates.length === 1 ? candidates[0] : undefined;
  const conflictingIdentity = horses.some((horse) => {
    const sameName =
      entities.horseName &&
      [horse.name, horse.barnName].some((name) => name && normalizeToken(entities.horseName!) === normalizeToken(name));
    const sameRegistration =
      entities.registrationNumber &&
      registrationKey(entities.registrationNumber) === registrationKey(horse.registrationNumber || horse.aqhaNumber);
    return (sameName || sameRegistration) && horseIdentityConflicts(horse, entities);
  });
  return { match, needsReview: !match && (candidates.length > 0 || conflictingIdentity) };
}

export async function buildDocumentRecord(params: {
  file: File;
  uploadedBy: string;
  source: DocumentSource;
  selectedHorse?: HorseRecord;
  horses: HorseRecord[];
  existingDocuments: DocumentRecord[];
}) {
  const { file, uploadedBy, source, selectedHorse, horses, existingDocuments } = params;
  const { text: previewText, coverage } = await readFileTextSnippet(file);
  const typeReview = inferDocumentType(file.name, previewText);
  const inferredType = typeReview.type;
  const { identityReviewRequired, ...extractedEntities } = extractDocumentEntities({
    fileName: file.name,
    previewText,
    inferredType,
  });
  const bestMatch = selectedHorse
    ? { horse: selectedHorse, confidence: 0.99, reason: 'Document was manually attached during upload' }
    : identityReviewRequired
      ? undefined
      : resolveDocumentHorseMatch(horses, `${file.name} ${previewText}`, extractedEntities).match;
  const matchedHorse = bestMatch?.horse;
  const identityConflict = matchedHorse && horseIdentityConflicts(matchedHorse, extractedEntities);
  const duplicateRisk = 'Low' as DocumentRecord['duplicateRisk'];
  const contentSha256 = await fingerprintDocument(file);

  // These are facts read from this document. Copying missing fields from the
  // matched profile made review claim the scan contained facts it never read.
  const entities: DocumentEntities = extractedEntities;
  const entityCount = Object.values(entities).filter(Boolean).length;

  let confidence = bestMatch?.confidence ?? 0.54;
  confidence = Math.max(confidence, 0.48 + entityCount * 0.07);
  if (duplicateRisk === 'Review') {
    confidence -= 0.08;
  }
  if (duplicateRisk === 'Possible Duplicate') {
    confidence -= 0.18;
  }
  confidence = Math.max(0.42, Math.min(0.99, Math.round(confidence * 100) / 100));

  let state: DocumentRecord['state'] = 'Needs Review';
  if (duplicateRisk === 'Possible Duplicate') {
    state = 'Needs Review';
  } else if (confidence >= 0.8 && matchedHorse && !identityConflict && !identityReviewRequired) {
    state = 'Matched';
  }

  const matchReason = bestMatch?.reason?.toLowerCase() ?? 'the upload engine found a weak candidate match';
  const trustLabel = `${Math.round(confidence * 100)}% match`;

  const document: DocumentRecord = {
    id: createId('doc'),
    contentSha256,
    title: file.name.replace(/\.[^.]+$/, ''),
    type: inferredType,
    horseId: matchedHorse?.id,
    uploadedBy,
    uploadedAt: todayStamp(),
    source,
    state,
    confidence,
    duplicateRisk,
    extractedTextPreview: previewText,
    // Empty unless the reader stopped short of the whole file.
    identityReviewRequired,
    processingNote: [
      describeDocumentCoverage(coverage),
      typeReview.ambiguous ? 'Multiple document types were read. Upload separate sources for each requirement.' : '',
      identityReviewRequired ? documentIdentityReviewNote : '',
    ]
      .filter(Boolean)
      .join(' '),
    summary: identityConflict
      ? `${inferredType} was manually attached to ${matchedHorse?.name}, but the extracted identity conflicts. Compare the source before approving.`
      : matchedHorse
        ? `${inferredType} matched to ${matchedHorse.name} with ${trustLabel} based on ${matchReason}.`
        : `${inferredType} added to the queue and needs manual assignment before it can be attached to a horse profile.`,
    entities,
  } satisfies DocumentRecord;
  return flagDocumentDuplicates([document], existingDocuments)[0];
}

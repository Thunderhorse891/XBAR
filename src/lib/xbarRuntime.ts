import type {
  AssetCondition,
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
import { readDocumentText } from './documentIntelligence.js';

const GIGABYTE = 1024 * 1024 * 1024;
const BASE36_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const subscriptionTierConfig: Record<
  SubscriptionTier,
  Pick<SubscriptionProfile, 'monthlyRate' | 'sharedAccessEnabled' | 'featureFlags'> & {
    limits: Pick<SubscriptionProfile['usage'], 'seatLimit' | 'documentLimit' | 'storageLimitGb' | 'sharedAccessSeatLimit'>;
  }
> = {
  Starter: {
    monthlyRate: 29,
    sharedAccessEnabled: false,
    featureFlags: [
      'Full operations toolkit — horses, care, medical, breeding, expenses, reminders, ranch assets, documents, weather',
      '1 team seat',
      '250 document capacity · 25 GB storage',
    ],
    limits: {
      seatLimit: 1,
      documentLimit: 250,
      storageLimitGb: 25,
      sharedAccessSeatLimit: 0,
    },
  },
  Professional: {
    monthlyRate: 79,
    sharedAccessEnabled: true,
    featureFlags: [
      'Everything in Starter',
      'Sale listings — publish buyer-ready horse profiles to shared access',
      '5 team seats · 10 shared-access seats',
      '1,000 document capacity · 100 GB storage',
    ],
    limits: {
      seatLimit: 5,
      documentLimit: 1000,
      storageLimitGb: 100,
      sharedAccessSeatLimit: 10,
    },
  },
  'Ranch Ops': {
    monthlyRate: 199,
    sharedAccessEnabled: true,
    featureFlags: [
      'Everything in Professional',
      'Built for larger, multi-person operations',
      '20 team seats · 40 shared-access seats',
      '5,000 document capacity · 500 GB storage',
    ],
    limits: {
      seatLimit: 20,
      documentLimit: 5000,
      storageLimitGb: 500,
      sharedAccessSeatLimit: 40,
    },
  },
  Enterprise: {
    monthlyRate: 499,
    sharedAccessEnabled: true,
    featureFlags: [
      'Everything in Ranch Ops',
      'Highest-capacity tier for large rosters and teams',
      '60 team seats · 200 shared-access seats',
      '20,000 document capacity · 2,500 GB storage',
    ],
    limits: {
      seatLimit: 60,
      documentLimit: 20000,
      storageLimitGb: 2500,
      sharedAccessSeatLimit: 200,
    },
  },
};

function getCryptoApi() {
  return typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
}

function createRandomBase36(length: number) {
  const cryptoApi = getCryptoApi();
  if (cryptoApi?.getRandomValues) {
    const values = cryptoApi.getRandomValues(new Uint8Array(length));
    return Array.from(values, (value) => BASE36_ALPHABET[value % BASE36_ALPHABET.length]).join('');
  }

  return Array.from({ length }, (_, index) => BASE36_ALPHABET[(Date.now() + index * 17) % BASE36_ALPHABET.length]).join('');
}

export function createId(prefix: string) {
  const cryptoApi = getCryptoApi();
  if (cryptoApi?.randomUUID) {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${createRandomBase36(8)}`;
}

export function createNumericToken(length: number) {
  const cryptoApi = getCryptoApi();
  if (cryptoApi?.getRandomValues) {
    const values = cryptoApi.getRandomValues(new Uint8Array(length));
    return Array.from(values, (value) => String(value % 10)).join('');
  }

  return Array.from({ length }, (_, index) => String((Date.now() + index) % 10)).join('');
}

export function createShareAccessToken(length = 18) {
  return createRandomBase36(length);
}

export function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function nowStamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 16);
}

export function normalizeStorage(value: number) {
  return Math.round(value * 1000) / 1000;
}

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesNormalized(haystack: string, needle: string) {
  const normalizedNeedle = normalizeToken(needle);
  return normalizedNeedle.length >= 3 && haystack.includes(normalizedNeedle);
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

export function guessGalleryKind(fileName: string): GalleryAsset['kind'] {
  const lower = fileName.toLowerCase();

  if (lower.includes('pedigree')) return 'Pedigree';
  if (lower.includes('cover') || lower.includes('packet')) return 'Document Cover';
  if (lower.includes('conformation')) return 'Conformation';
  if (lower.includes('sale')) return 'Sale Still';
  return 'Hero';
}

export function conditionTone(condition: AssetCondition) {
  if (condition === 'Attention Required') return 'rose';
  if (condition === 'Service Soon') return 'amber';
  return 'emerald';
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
  const invitedOwners = workspaceInvitations.filter((invite) => invite.status === 'Pending' && invite.role === 'Owner').length;
  const activeOwners = workspaceMembers.filter((member) => member.status === 'Active' && member.role === 'Owner').length;
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

export async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

async function readFileTextSnippet(file: File) {
  try {
    return await readDocumentText(file);
  } catch {
    return '';
  }
}

function extractFirstMatch(haystack: string, candidates: string[]) {
  return [...candidates]
    .filter((candidate) => Boolean(candidate))
    .sort((left, right) => right.length - left.length)
    .find((candidate) => includesNormalized(haystack, candidate));
}

function extractRegistrationNumber(haystack: string) {
  return haystack.match(/\b[A-Z]{2,5}-[A-Z0-9-]{3,}\b/i)?.[0]?.toUpperCase();
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
  if (normalized.includes('attention required') || normalized.includes('missing signature')) return 'Attention Required';
  if (normalized.includes('pending signatures') || normalized.includes('signature')) return 'Pending Signatures';
  return 'Pending Signatures';
}

function buildKnownOwners(horses: HorseRecord[]) {
  return Array.from(new Set(horses.flatMap((horse) => [horse.owner, horse.ownerEntity]).filter(Boolean)));
}

function extractDocumentEntities(params: {
  fileName: string;
  previewText: string;
  inferredType: DocumentType;
  horses: HorseRecord[];
}) {
  const { fileName, previewText, inferredType, horses } = params;
  const haystack = `${fileName} ${previewText}`;

  return {
    horseName: extractFirstMatch(haystack, horses.flatMap((horse) => [horse.name, horse.barnName])),
    registrationNumber: extractRegistrationNumber(haystack),
    ownerName: extractFirstMatch(haystack, buildKnownOwners(horses)),
    examDate: inferredType === 'Vet Record' || inferredType === 'Coggins' ? extractExamDate(haystack) : undefined,
    veterinarian: inferredType === 'Vet Record' || inferredType === 'Coggins' ? extractVeterinarian(haystack) : undefined,
    transferStatus: extractTransferStatus(haystack, inferredType),
  } satisfies DocumentEntities;
}

export type HorseMatchResult = {
  horse: HorseRecord;
  confidence: number;
  reason: string;
};

function scoreHorseMatch(horse: HorseRecord, search: string, entities?: DocumentEntities) {
  let confidence = 0;
  let reason = '';

  const exactChecks: Array<[string | undefined, number, string]> = [
    [entities?.horseName && normalizeToken(entities.horseName) === normalizeToken(horse.name) ? horse.name : undefined, 0.99, 'Extracted horse name matches profile'],
    [entities?.registrationNumber && normalizeToken(entities.registrationNumber) === normalizeToken(horse.registrationNumber) ? horse.registrationNumber : undefined, 0.98, 'Extracted registration number matches profile'],
    [entities?.ownerName && normalizeToken(entities.ownerName) === normalizeToken(horse.owner) ? horse.owner : undefined, 0.91, 'Extracted owner name matches profile'],
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
    [horse.owner, 0.78, 'Owner reference appears in the document'],
    [horse.ownerEntity, 0.73, 'Owner entity appears in the document'],
  ];

  searchChecks.forEach(([value, nextConfidence, nextReason]) => {
    if (includesNormalized(search, value) && nextConfidence > confidence) {
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

export function findHorseMatch(horses: HorseRecord[], haystack: string) {
  const [bestMatch] = rankHorseMatches(horses, haystack);
  return {
    horse: bestMatch?.horse,
    confidence: bestMatch?.confidence ?? 0,
  };
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
  const previewText = await readFileTextSnippet(file);
  const inferredType = guessDocumentType(file.name);
  const extractedEntities = extractDocumentEntities({
    fileName: file.name,
    previewText,
    inferredType,
    horses,
  });
  const candidateMatches = selectedHorse
    ? [{ horse: selectedHorse, confidence: 0.99, reason: 'Document was manually attached during upload' }]
    : rankHorseMatches(horses, `${file.name} ${previewText}`, extractedEntities);

  const matchedHorse = candidateMatches[0]?.horse;
  const exactTitleDuplicate = existingDocuments.some((document) => normalizeToken(document.title) === normalizeToken(file.name.replace(/\.[^.]+$/, '')));
  const sameHorseDuplicate = existingDocuments.some(
    (document) =>
      document.horseId &&
      document.horseId === matchedHorse?.id &&
      document.type === inferredType &&
      (document.entities.registrationNumber === extractedEntities.registrationNumber || normalizeToken(document.title) === normalizeToken(file.name)),
  );
  const duplicateRisk = exactTitleDuplicate ? 'Possible Duplicate' : sameHorseDuplicate ? 'Review' : 'Low';

  const entities: DocumentEntities = {
    horseName: extractedEntities.horseName ?? matchedHorse?.name,
    registrationNumber: extractedEntities.registrationNumber ?? matchedHorse?.registrationNumber,
    ownerName: extractedEntities.ownerName ?? matchedHorse?.owner,
    examDate: extractedEntities.examDate,
    veterinarian: extractedEntities.veterinarian,
    transferStatus: extractedEntities.transferStatus,
  };
  const entityCount = Object.values(entities).filter(Boolean).length;

  let confidence = candidateMatches[0]?.confidence ?? 0.54;
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
  } else if (confidence >= 0.8 && matchedHorse) {
    state = 'Matched';
  }

  const matchReason = candidateMatches[0]?.reason?.toLowerCase() ?? 'the upload engine found a weak candidate match';
  const trustLabel = `${Math.round(confidence * 100)}% match`;

  return {
    id: createId('doc'),
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
    summary: matchedHorse
      ? `${inferredType} matched to ${matchedHorse.name} with ${trustLabel} based on ${matchReason}.`
      : `${inferredType} added to the queue and needs manual assignment before it can be attached to a horse profile.`,
    entities,
  } satisfies DocumentRecord;
}

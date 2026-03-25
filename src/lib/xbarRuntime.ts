import type {
  AssetCondition,
  DocumentRecord,
  DocumentEntities,
  DocumentSource,
  DocumentType,
  GalleryAsset,
  HorseRecord,
  PortalSnapshot,
  SalesLead,
  SubscriptionProfile,
  SubscriptionTier,
} from '../types/xbar.js';

const GIGABYTE = 1024 * 1024 * 1024;

export const subscriptionTierConfig: Record<
  SubscriptionTier,
  Pick<SubscriptionProfile, 'monthlyRate' | 'ownerPortalEnabled' | 'brandedListings' | 'featureFlags'> & {
    limits: Pick<SubscriptionProfile['usage'], 'seatLimit' | 'ocrLimit' | 'storageLimitGb' | 'portalSeatLimit'>;
  }
> = {
  Starter: {
    monthlyRate: 390,
    ownerPortalEnabled: false,
    brandedListings: false,
    featureFlags: ['Horse records', 'Basic listings', 'Local document vault'],
    limits: {
      seatLimit: 2,
      ocrLimit: 250,
      storageLimitGb: 25,
      portalSeatLimit: 0,
    },
  },
  Professional: {
    monthlyRate: 1290,
    ownerPortalEnabled: true,
    brandedListings: true,
    featureFlags: [
      'Role-aware dashboards',
      'Owner portal access',
      'Branded sale packets',
      'OCR review queue',
      'Weather operations layer',
    ],
    limits: {
      seatLimit: 8,
      ocrLimit: 1800,
      storageLimitGb: 200,
      portalSeatLimit: 10,
    },
  },
  'Ranch Ops': {
    monthlyRate: 2490,
    ownerPortalEnabled: true,
    brandedListings: true,
    featureFlags: [
      'Expanded OCR throughput',
      'Branded sale packets',
      'Role-aware dashboards',
      'Owner portal access',
      'Ranch asset operations',
      'Lead intelligence',
    ],
    limits: {
      seatLimit: 20,
      ocrLimit: 6000,
      storageLimitGb: 750,
      portalSeatLimit: 40,
    },
  },
  Enterprise: {
    monthlyRate: 4990,
    ownerPortalEnabled: true,
    brandedListings: true,
    featureFlags: [
      'Custom auth providers',
      'Expanded OCR throughput',
      'Dedicated portal branding',
      'Priority operations support',
      'Custom integrations',
      'Advanced audit controls',
    ],
    limits: {
      seatLimit: 60,
      ocrLimit: 20000,
      storageLimitGb: 2500,
      portalSeatLimit: 200,
    },
  },
};

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

export function estimateOcrPages(files: File[]) {
  return files.reduce((sum, file) => sum + Math.max(1, Math.round(file.size / 240000)), 0);
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

export function derivePortalSnapshot(
  portal: PortalSnapshot,
  savedHorseIds: string[],
  salesLeads: SalesLead[],
) {
  const openInquiries = salesLeads.filter((lead) => lead.stage !== 'Closed').length;
  return {
    ...portal,
    savedHorses: savedHorseIds.length,
    openInquiries,
  };
}

export async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

async function readFileTextPreview(file: File) {
  const fileIsTextLike =
    file.type.startsWith('text/') ||
    /\.(txt|csv|json|md)$/i.test(file.name);

  if (!fileIsTextLike) {
    return `${file.name} uploaded through the local intake engine. External OCR is not connected yet, so image and PDF extraction is limited in this public preview.`;
  }

  try {
    const text = await file.text();
    return text.slice(0, 320) || `${file.name} uploaded through the local intake engine.`;
  } catch {
    return `${file.name} uploaded through the local intake engine.`;
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
  const previewText = await readFileTextPreview(file);
  const inferredType = guessDocumentType(file.name);
  const extractedEntities = extractDocumentEntities({
    fileName: file.name,
    previewText,
    inferredType,
    horses,
  });
  const candidateMatches = selectedHorse
    ? [{ horse: selectedHorse, confidence: 0.99, reason: 'Document was manually attached during intake' }]
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
    examDate: extractedEntities.examDate ?? (inferredType === 'Vet Record' || inferredType === 'Coggins' ? todayStamp() : undefined),
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
  } else if (confidence >= 0.94 && matchedHorse) {
    state = 'Ready';
  } else if (confidence >= 0.8 && matchedHorse) {
    state = 'Matched';
  } else if (matchedHorse) {
    state = 'Extracting';
  }

  const matchReason = candidateMatches[0]?.reason?.toLowerCase() ?? 'the intake engine found a weak candidate match';
  const trustLabel = `${Math.round(confidence * 100)}% trust`;

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
      ? `${inferredType} staged for ${matchedHorse.name} with ${trustLabel} based on ${matchReason}.`
      : `${inferredType} intake needs review before it can be attached to a horse profile.`,
    entities,
  } satisfies DocumentRecord;
}

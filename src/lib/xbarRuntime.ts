import type {
  AssetCondition,
  DocumentRecord,
  DocumentSource,
  DocumentType,
  GalleryAsset,
  HorseRecord,
  OCRBatch,
  PortalSnapshot,
  SalesLead,
  SubscriptionProfile,
  SubscriptionTier,
} from '@/types/xbar';

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
      'Owner portal foundation',
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
    return `${file.name} uploaded through the local intake engine. Cloud OCR can replace this preview when a provider is attached.`;
  }

  try {
    const text = await file.text();
    return text.slice(0, 320) || `${file.name} uploaded through the local intake engine.`;
  } catch {
    return `${file.name} uploaded through the local intake engine.`;
  }
}

function getHorseSearchTokens(horse: HorseRecord) {
  return [
    horse.name,
    horse.barnName,
    horse.aqhaNumber,
    horse.registrationNumber,
    horse.owner,
    horse.ownerEntity,
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
}

export function findHorseMatch(horses: HorseRecord[], haystack: string) {
  const search = haystack.toLowerCase();
  let bestMatch: HorseRecord | undefined;
  let confidence = 0;

  horses.forEach((horse) => {
    const tokens = getHorseSearchTokens(horse);
    if (tokens.some((token) => token.length > 6 && search.includes(token))) {
      bestMatch = horse;
      confidence = 0.93;
      return;
    }

    if (search.includes(horse.barnName.toLowerCase())) {
      bestMatch = horse;
      confidence = Math.max(confidence, 0.82);
    }
  });

  return { horse: bestMatch, confidence };
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
  const match = selectedHorse
    ? { horse: selectedHorse, confidence: 0.99 }
    : findHorseMatch(horses, `${file.name} ${previewText}`);

  const matchedHorse = match.horse;
  const duplicateRisk = existingDocuments.some((document) => document.title === file.name)
    ? 'Possible Duplicate'
    : existingDocuments.some((document) => document.horseId && document.horseId === matchedHorse?.id && document.type === inferredType)
      ? 'Review'
      : 'Low';

  let state: DocumentRecord['state'] = 'Needs Review';
  if (match.confidence >= 0.96 && duplicateRisk === 'Low') {
    state = 'Ready';
  } else if (match.confidence >= 0.8 && duplicateRisk !== 'Possible Duplicate') {
    state = 'Matched';
  } else if (!matchedHorse) {
    state = 'Needs Review';
  } else {
    state = 'Extracting';
  }

  const registrationNumber = matchedHorse?.registrationNumber;
  const ownerName = matchedHorse?.owner;

  return {
    id: createId('doc'),
    title: file.name.replace(/\.[^.]+$/, ''),
    type: inferredType,
    horseId: matchedHorse?.id,
    uploadedBy,
    uploadedAt: todayStamp(),
    source,
    state,
    confidence: match.confidence || 0.58,
    duplicateRisk,
    extractedTextPreview: previewText,
    summary: matchedHorse
      ? `${inferredType} intake staged for ${matchedHorse.name}.`
      : `${inferredType} intake needs review before it can be attached to a horse profile.`,
    entities: {
      horseName: matchedHorse?.name,
      registrationNumber,
      ownerName,
      examDate: inferredType === 'Vet Record' || inferredType === 'Coggins' ? todayStamp() : undefined,
      transferStatus: inferredType === 'Transfer Packet' ? 'Pending Signatures' : undefined,
    },
  } satisfies DocumentRecord;
}

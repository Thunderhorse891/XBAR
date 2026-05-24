import { getSupabaseClient } from '@/lib/supabaseClient';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import type { DocumentRecord, HorseAlert, HorseRecord, OwnershipRecord, SharedListingRecord } from '@/types/xbar';

export type PublicHorseDTO = Pick<
  HorseRecord,
  | 'id'
  | 'name'
  | 'barnName'
  | 'summary'
  | 'segment'
  | 'status'
  | 'breed'
  | 'registry'
  | 'aqhaNumber'
  | 'registrationNumber'
  | 'registered'
  | 'age'
  | 'foaledOn'
  | 'sex'
  | 'color'
  | 'markings'
  | 'insuredValue'
  | 'profileImage'
  | 'bloodline'
  | 'gallery'
  | 'sale'
  | 'readiness'
> & {
  alerts: Array<Pick<HorseAlert, 'severity' | 'module'>>;
};

export type PublicDocumentDTO = Pick<
  DocumentRecord,
  | 'id'
  | 'title'
  | 'type'
  | 'horseId'
  | 'uploadedAt'
  | 'source'
  | 'state'
  | 'confidence'
  | 'duplicateRisk'
  | 'extractedTextPreview'
  | 'summary'
  | 'entities'
  | 'fileName'
  | 'mimeType'
  | 'fileSizeBytes'
>;

export type PublicOwnershipDTO = Pick<OwnershipRecord, 'id' | 'horseId' | 'transferStatus' | 'confidence'>;

export type PublicSharedListingDTO = Pick<SharedListingRecord, 'id' | 'horseId' | 'sharePath' | 'accessMode' | 'state' | 'channels' | 'updatedAt'> & {
  shareToken?: string;
};

export type PublicBuyerProfilePayload = {
  horse: PublicHorseDTO;
  documents: PublicDocumentDTO[];
  ownershipRecord?: PublicOwnershipDTO;
  sharedListing?: PublicSharedListingDTO;
};

type PublicBuyerProfileResult =
  | {
      ok: true;
      payload: PublicBuyerProfilePayload;
      source: 'rpc';
    }
  | {
      ok: false;
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsePublicBuyerProfilePayload(value: unknown): PublicBuyerProfilePayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const horse = value.horse;
  if (!isRecord(horse)) {
    return null;
  }

  return {
    horse: sanitizePublicHorse(horse as unknown as HorseRecord),
    documents: Array.isArray(value.documents) ? value.documents.map(sanitizePublicDocument).filter((document): document is PublicDocumentDTO => Boolean(document)) : [],
    ownershipRecord: sanitizePublicOwnership(value.ownershipRecord),
    sharedListing: sanitizePublicSharedListing(value.sharedListing),
  };
}

function sanitizePublicHorse(horse: HorseRecord): PublicHorseDTO {
  return {
    id: horse.id,
    name: horse.name,
    barnName: horse.barnName,
    summary: horse.summary,
    segment: horse.segment,
    status: horse.status,
    breed: horse.breed,
    registry: horse.registry,
    aqhaNumber: horse.aqhaNumber,
    registrationNumber: horse.registrationNumber,
    registered: horse.registered,
    age: horse.age,
    foaledOn: horse.foaledOn,
    sex: horse.sex,
    color: horse.color,
    markings: horse.markings,
    insuredValue: horse.insuredValue,
    profileImage: horse.profileImage,
    bloodline: horse.bloodline,
    gallery: horse.gallery.filter((asset) => asset.status === 'Approved'),
    sale: horse.sale,
    readiness: {
      ...horse.readiness,
      blockers: [],
    },
    alerts: horse.alerts
      .filter((alert) => alert.severity === 'high' && ['Medical', 'Ownership', 'Documents'].includes(alert.module))
      .map((alert) => ({
        severity: alert.severity,
        module: alert.module,
      })),
  };
}

function sanitizePublicDocument(value: unknown): PublicDocumentDTO | null {
  if (!isRecord(value)) {
    return null;
  }

  const document = value as unknown as DocumentRecord;
  return {
    id: document.id,
    title: document.title,
    type: document.type,
    horseId: document.horseId,
    uploadedAt: document.uploadedAt,
    source: document.source,
    state: document.state,
    confidence: document.confidence,
    duplicateRisk: document.duplicateRisk,
    extractedTextPreview: '',
    summary: document.summary,
    entities: document.entities ?? {},
    fileName: document.fileName,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
  };
}

function sanitizePublicOwnership(value: unknown): PublicOwnershipDTO | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const record = value as unknown as OwnershipRecord;
  return {
    id: record.id,
    horseId: record.horseId,
    transferStatus: record.transferStatus,
    confidence: record.confidence,
  };
}

function sanitizePublicSharedListing(value: unknown): PublicSharedListingDTO | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const listing = value as unknown as SharedListingRecord;
  return {
    id: listing.id,
    horseId: listing.horseId,
    sharePath: listing.sharePath,
    accessMode: listing.accessMode,
    state: listing.state,
    channels: listing.channels,
    updatedAt: listing.updatedAt,
    shareToken: listing.accessMode === 'Private Token' ? listing.shareToken : undefined,
  };
}

export async function loadPublicBuyerProfile(params: {
  sharePath: string;
  shareToken?: string;
}): Promise<PublicBuyerProfileResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      message: 'Cloud share access is not configured for this build.',
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      message: 'Cloud share access is not available in this build.',
    };
  }

  const { data, error } = await client.rpc('xbar_resolve_public_listing', {
    p_share_path: params.sharePath,
    p_share_token: params.shareToken?.trim() || null,
  });

  if (error) {
    return {
      ok: false,
      message: error.message,
    };
  }

  const payload = parsePublicBuyerProfilePayload(data);
  if (!payload) {
    return {
      ok: false,
      message: 'Buyer share data is unavailable for this link.',
    };
  }

  return {
    ok: true,
    payload,
    source: 'rpc',
  };
}

export async function trackPublicBuyerProfileView(params: {
  sharePath: string;
  shareToken?: string;
}) {
  if (!isSupabaseConfigured()) {
    return;
  }

  const client = getSupabaseClient();
  if (!client) {
    return;
  }

  try {
    await client.rpc('xbar_track_public_share_view', {
      p_share_path: params.sharePath,
      p_share_token: params.shareToken?.trim() || null,
    });
  } catch {
    // Ignore analytics failures on public buyer views.
  }
}

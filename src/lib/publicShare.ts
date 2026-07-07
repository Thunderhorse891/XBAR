import { getSupabaseClient } from '@/lib/supabaseClient';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import type { DocumentRecord, HorseRecord, OwnershipRecord, SharedListingRecord } from '@/types/xbar';

// insuredValue, summary, segment, status, ownership, medicalNotes, and full alerts are
// intentionally omitted — they are internal fields that must not reach the public buyer view.
export type PublicHorseDTO = Pick<
  HorseRecord,
  | 'id'
  | 'name'
  | 'barnName'
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
  | 'profileImage'
  | 'bloodline'
  | 'gallery'
  | 'sale'
  | 'readiness'
>;

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

export type PublicSharedListingDTO = Pick<
  SharedListingRecord,
  'id' | 'horseId' | 'sharePath' | 'accessMode' | 'state' | 'channels' | 'updatedAt'
> & {
  shareToken?: string;
};

export type PublicBuyerProfilePayload = {
  horse: PublicHorseDTO;
  documents: PublicDocumentDTO[];
  ownershipRecord?: PublicOwnershipDTO;
  sharedListing?: PublicSharedListingDTO;
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

  // Sanitize RPC response — treat incoming data as untrusted HorseRecord shape
  // and strip any sensitive fields before use.
  return {
    horse: sanitizePublicHorse(horse as unknown as HorseRecord),
    documents: Array.isArray(value.documents)
      ? value.documents
          .map(sanitizePublicDocument)
          .filter((document): document is PublicDocumentDTO => Boolean(document))
      : [],
    ownershipRecord: sanitizePublicOwnership(value.ownershipRecord),
    sharedListing: sanitizePublicSharedListing(value.sharedListing),
  };
}

function sanitizePublicHorse(horse: HorseRecord): PublicHorseDTO {
  return {
    id: horse.id,
    name: horse.name,
    barnName: horse.barnName,
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
    profileImage: horse.profileImage,
    bloodline: horse.bloodline,
    gallery: horse.gallery.filter((asset) => asset.status === 'Approved'),
    // Only expose the listing state and asking price — not internal confidence or inquiry counts.
    sale: {
      listingState: horse.sale.listingState,
      askPrice: horse.sale.askPrice,
      buyerConfidence: 0,
      inquiryCount: 0,
      watchlistCount: 0,
      socialReady: horse.sale.socialReady,
    },
    readiness: {
      ...horse.readiness,
      blockers: [],
    },
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

export function sanitizeHorseForBuyerView(horse: HorseRecord): PublicHorseDTO {
  return sanitizePublicHorse(horse);
}

export function sanitizeDocumentForBuyerView(doc: DocumentRecord): PublicDocumentDTO {
  return (
    sanitizePublicDocument(doc) ?? {
      id: doc.id,
      title: doc.title,
      type: doc.type,
      horseId: doc.horseId,
      uploadedAt: doc.uploadedAt,
      source: doc.source,
      state: doc.state,
      confidence: doc.confidence,
      duplicateRisk: doc.duplicateRisk,
      extractedTextPreview: '',
      summary: doc.summary,
      entities: doc.entities ?? {},
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes,
    }
  );
}

export function sanitizeSharedListingForBuyerView(listing: SharedListingRecord): PublicSharedListingDTO {
  return (
    sanitizePublicSharedListing(listing) ?? {
      id: listing.id,
      horseId: listing.horseId,
      sharePath: listing.sharePath,
      accessMode: listing.accessMode,
      state: listing.state,
      channels: listing.channels,
      updatedAt: listing.updatedAt,
    }
  );
}

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
      message: 'Sale listing data is unavailable for this link.',
    };
  }

  return {
    ok: true,
    payload,
    source: 'rpc',
  };
}

export async function trackPublicBuyerProfileView(params: { sharePath: string; shareToken?: string }) {
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

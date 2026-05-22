import { getSupabaseClient } from '@/lib/supabaseClient';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import type { DocumentRecord, HorseRecord, OwnershipRecord, SharedListingRecord } from '@/types/xbar';

export type PublicHorseDTO = HorseRecord;
export type PublicDocumentDTO = DocumentRecord;

export type PublicBuyerProfilePayload = {
  horse: PublicHorseDTO;
  documents: PublicDocumentDTO[];
  ownershipRecord?: OwnershipRecord;
  sharedListing?: SharedListingRecord;
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
    ownershipRecord: isRecord(value.ownershipRecord) ? (value.ownershipRecord as unknown as OwnershipRecord) : undefined,
    sharedListing: isRecord(value.sharedListing) ? (value.sharedListing as unknown as SharedListingRecord) : undefined,
  };
}

function sanitizePublicHorse(horse: HorseRecord): PublicHorseDTO {
  return {
    ...horse,
    medicalNotes: '',
    lastVetVisit: '',
    ownership: [],
    documentFacts: [],
    alerts: [],
    notes: [],
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
    uploadedBy: '',
    uploadedAt: document.uploadedAt,
    source: document.source,
    state: document.state,
    confidence: document.confidence,
    duplicateRisk: document.duplicateRisk,
    extractedTextPreview: '',
    summary: document.summary,
    entities: document.entities ?? {},
    fileUrl: undefined,
    storagePath: undefined,
    fileName: document.fileName,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
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

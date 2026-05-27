import { getSupabaseClient } from '@/lib/supabaseClient';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import type { DocumentRecord, GalleryAsset, HorseRecord, SharedListingRecord } from '@/types/xbar';

// Buyer-safe subsets — only these fields leave the private workspace.
export type PublicHorseDTO = {
  id: string;
  name: string;
  barnName: string;
  breed: string;
  registry: string;
  aqhaNumber: string;
  registrationNumber: string;
  registered: boolean;
  age: number;
  foaledOn: string;
  sex: string;
  color: string;
  markings: string;
  profileImage: string;
  bloodline: { sire: string; dam: string; family: string };
  gallery: Pick<GalleryAsset, 'id' | 'url' | 'kind' | 'label' | 'status'>[];
  sale: { listingState: string; askPrice: number };
  readiness: { packetStatus: string };
};

export type PublicDocumentDTO = {
  id: string;
  title: string;
  type: string;
  summary: string;
};

export type PublicSharedListingDTO = {
  id: string;
  horseId: string;
  sharePath: string;
  accessMode: string;
  shareToken: string;
  state: string;
  channels: string[];
};

export type PublicBuyerProfilePayload = {
  horse: PublicHorseDTO;
  documents: PublicDocumentDTO[];
  sharedListing?: PublicSharedListingDTO;
};

function sanitizeHorse(horse: HorseRecord): PublicHorseDTO {
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
    bloodline: {
      sire: horse.bloodline.sire,
      dam: horse.bloodline.dam,
      family: horse.bloodline.family,
    },
    gallery: horse.gallery
      .filter((a) => a.status === 'Approved')
      .map(({ id, url, kind, label, status }) => ({ id, url, kind, label, status })),
    sale: {
      listingState: horse.sale.listingState,
      askPrice: horse.sale.askPrice,
    },
    readiness: {
      packetStatus: horse.readiness.packetStatus,
    },
  };
}

function sanitizeDocument(doc: DocumentRecord): PublicDocumentDTO {
  return {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    summary: doc.summary,
  };
}

function sanitizeSharedListing(listing: SharedListingRecord): PublicSharedListingDTO {
  return {
    id: listing.id,
    horseId: listing.horseId,
    sharePath: listing.sharePath,
    accessMode: listing.accessMode,
    shareToken: listing.shareToken,
    state: listing.state,
    channels: listing.channels,
  };
}

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
    horse: sanitizeHorse(horse as unknown as HorseRecord),
    documents: Array.isArray(value.documents)
      ? (value.documents as DocumentRecord[]).map(sanitizeDocument)
      : [],
    sharedListing: isRecord(value.sharedListing)
      ? sanitizeSharedListing(value.sharedListing as unknown as SharedListingRecord)
      : undefined,
  };
}

export function sanitizeHorseForBuyerView(horse: HorseRecord): PublicHorseDTO {
  return sanitizeHorse(horse);
}

export function sanitizeDocumentForBuyerView(doc: DocumentRecord): PublicDocumentDTO {
  return sanitizeDocument(doc);
}

export function sanitizeSharedListingForBuyerView(listing: SharedListingRecord): PublicSharedListingDTO {
  return sanitizeSharedListing(listing);
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

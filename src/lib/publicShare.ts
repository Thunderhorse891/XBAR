import { getSupabaseClient } from '@/lib/supabaseClient';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import type { DocumentRecord, HorseRecord, OwnershipRecord, SharedListingRecord } from '@/types/xbar';

export type PublicBuyerProfilePayload = {
  horse: HorseRecord;
  documents: DocumentRecord[];
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
    horse: horse as unknown as HorseRecord,
    documents: Array.isArray(value.documents) ? (value.documents as DocumentRecord[]) : [],
    ownershipRecord: isRecord(value.ownershipRecord) ? (value.ownershipRecord as unknown as OwnershipRecord) : undefined,
    sharedListing: isRecord(value.sharedListing) ? (value.sharedListing as unknown as SharedListingRecord) : undefined,
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

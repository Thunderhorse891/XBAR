import { apiConfig } from './platformConfig.js';
import type { GalleryAsset } from '../types/xbar.js';

export type PrimaryHorseMedia = {
  /** Legacy public URL, external URL, or local object URL -- used when no signed URL resolves. */
  src: string | null;
  /** Cloud storage path; when present the render layer mints a signed URL for it. */
  storagePath: string | null;
};

/**
 * Pick the horse's primary display image as a (src, storagePath) pair.
 *
 * profileImage is a bare URL string with no storage path of its own, so it is
 * matched back to the gallery asset it was promoted from; that asset carries
 * the storagePath the signed-URL flow needs. A profileImage that matches no
 * gallery asset (a legacy public URL, or an external link) keeps its src and
 * gets no storagePath, so it renders exactly as before. Without a profileImage
 * the fallback picker chooses (default: the first gallery asset).
 */
export function primaryHorseMedia(
  horse: {
    profileImage: string;
    gallery?: GalleryAsset[] | null;
  },
  fallbackPicker?: (gallery: GalleryAsset[]) => GalleryAsset | undefined,
): PrimaryHorseMedia {
  const gallery = horse.gallery ?? [];
  if (horse.profileImage) {
    const match = gallery.find((asset) => asset.url === horse.profileImage);
    return { src: horse.profileImage, storagePath: match?.storagePath ?? null };
  }
  const picked = fallbackPicker ? fallbackPicker(gallery) : gallery[0];
  return { src: picked?.url ?? null, storagePath: picked?.storagePath ?? null };
}

function buyerMediaApiBase(): string {
  return apiConfig.baseUrl ? apiConfig.baseUrl.replace(/\/$/, '') : '';
}

/**
 * Resolve a buyer-visible signed URL for one horse-media object.
 *
 * Anonymous buyers cannot mint signed URLs themselves (the bucket's storage
 * policies grant them nothing), so the token-gated server endpoint
 * `POST /api/buyer/media` signs on their behalf after validating the share
 * token against the listing. Returns null when the endpoint refuses or fails;
 * the caller falls back to whatever src it already had.
 */
export async function fetchBuyerHorseMediaUrl(params: {
  sharePath: string;
  shareToken?: string;
  storagePath: string;
}): Promise<string | null> {
  try {
    const response = await fetch(`${buyerMediaApiBase()}/api/buyer/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sharePath: params.sharePath,
        shareToken: params.shareToken ?? '',
        storagePath: params.storagePath,
      }),
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { ok?: boolean; url?: unknown };
    return payload?.ok === true && typeof payload.url === 'string' ? payload.url : null;
  } catch {
    return null;
  }
}

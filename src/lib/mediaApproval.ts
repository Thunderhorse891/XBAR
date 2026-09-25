import type { GalleryAsset, UserRole } from '../types/xbar.js';
import { hasRoleCapability } from './permissions.js';

export function reviewMedia(gallery: GalleryAsset[], assetId: string, role: UserRole, approved: boolean) {
  if (!hasRoleCapability(role, 'manageSales'))
    return { ok: false, message: 'Only an Admin or Sales Lead can approve sale media.' };
  const asset = gallery.find((item) => item.id === assetId);
  if (!asset || (!asset.storagePath && !asset.url))
    return { ok: false, message: 'A stored image is required before review.' };
  return {
    ok: true,
    message: approved ? 'Image approved for sale presentation.' : 'Image returned to pending review.',
    gallery: gallery.map((item) =>
      item.id === assetId ? { ...item, status: approved ? ('Approved' as const) : ('Pending' as const) } : item,
    ),
  };
}

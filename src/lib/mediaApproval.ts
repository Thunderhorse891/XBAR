import type { GalleryAsset, WorkspaceAccessRole } from '../types/xbar.js';
import { hasRoleCapability } from './permissions.js';

export function reviewMedia(gallery: GalleryAsset[], assetId: string, role: WorkspaceAccessRole, approved: boolean) {
  if (!hasRoleCapability(role, 'manageSales'))
    return { ok: false, message: 'Only an Admin or Sales Lead can approve sale media.' };
  const matches = gallery.filter((item) => item.id === assetId);
  const asset = matches.length === 1 ? matches[0] : undefined;
  if (!asset || asset.status === 'Archived' || (!asset.storagePath && !asset.url))
    return { ok: false, message: 'A stored image is required before review.' };
  return {
    ok: true,
    message: approved ? 'Image approved for sale presentation.' : 'Image returned to pending review.',
    gallery: gallery.map((item) =>
      item.id === assetId ? { ...item, status: approved ? ('Approved' as const) : ('Pending' as const) } : item,
    ),
  };
}

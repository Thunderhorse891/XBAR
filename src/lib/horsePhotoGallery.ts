import { hasHorsePhoto, isHorsePhotoAsset } from './animalPassport.js';
import { buildSaleReadinessScore } from './saleReadinessScore.js';
import { isDocumentReady } from './documentCurrency.js';
import type { DocumentRecord, ExpenseReceipt, GalleryAsset, HorseRecord, OwnershipRecord } from '../types/xbar.js';

export type HorsePhotoAction = 'primary' | 'remove' | 'restore';

/** Remove only from the active gallery. Originals and their storage references remain recoverable. */
export function changeHorsePhoto(
  horse: HorseRecord,
  assetId: string,
  action: HorsePhotoAction,
): { ok: true; gallery: GalleryAsset[]; profileImage: string } | { ok: false; message: string } {
  if (!['primary', 'remove', 'restore'].includes(action)) return { ok: false, message: 'Unknown photo action.' };
  const matches = horse.gallery.filter((item) => item.id === assetId);
  const asset = matches.length === 1 ? matches[0] : undefined;
  if (!asset || !isHorsePhotoAsset({ kind: asset.kind, url: asset.url, storagePath: asset.storagePath }))
    return { ok: false, message: 'This horse photo is no longer available.' };
  if (action === 'primary') {
    if (asset.status === 'Archived') return { ok: false, message: 'Restore this photo before making it primary.' };
    return {
      ok: true,
      gallery: horse.gallery.map((item) => ({ ...item, isPrimary: item.id === assetId })),
      profileImage: asset.url,
    };
  }
  if (action === 'restore') {
    if (asset.status !== 'Archived') return { ok: false, message: 'This photo is already in the gallery.' };
    const status: GalleryAsset['status'] =
      asset.previousStatus === 'Approved' || asset.previousStatus === 'Pending' ? asset.previousStatus : 'Draft';
    const makePrimary = !horse.profileImage && !horse.gallery.some(isHorsePhotoAsset);
    const gallery = horse.gallery.map((item) =>
      item.id === assetId ? { ...item, status, previousStatus: undefined, isPrimary: makePrimary } : item,
    );
    return { ok: true, gallery, profileImage: makePrimary ? asset.url : horse.profileImage };
  }
  if (asset.status === 'Archived') return { ok: false, message: 'This photo is already removed from the gallery.' };
  const gallery = horse.gallery.map((item) =>
    item.id === assetId
      ? {
          ...item,
          previousStatus: item.status as Exclude<GalleryAsset['status'], 'Archived'>,
          status: 'Archived' as const,
        }
      : item,
  );
  const removingPrimary = asset.isPrimary === true || Boolean(horse.profileImage && horse.profileImage === asset.url);
  const replacement = removingPrimary ? gallery.find(isHorsePhotoAsset) : undefined;
  const profileImage = removingPrimary ? (replacement?.url ?? '') : horse.profileImage;
  return {
    ok: true,
    gallery: gallery.map((item) => ({
      ...item,
      isPrimary: item.id === assetId ? false : removingPrimary ? item.id === replacement?.id : item.isPrimary,
    })),
    profileImage,
  };
}

/** Recompute photo transitions from current evidence, never guess a capped historical bonus. */
export function reconcileHorsePhotoReadiness(
  previous: HorseRecord,
  next: HorseRecord,
  context: { documents: DocumentRecord[]; expenseReceipts: ExpenseReceipt[]; ownershipRecords: OwnershipRecord[] },
): HorseRecord {
  const hasPhoto = hasHorsePhoto(next);
  if (hasHorsePhoto(previous) === hasPhoto) return next;
  const hasReadyMediaKit = context.documents.some(
    (document) => document.horseId === next.id && document.type === 'Media Kit' && isDocumentReady(document),
  );
  const blockers = next.readiness.blockers.filter(
    (blocker) => blocker !== 'Hero image missing' && blocker !== 'Sale photos missing',
  );
  if (!hasPhoto) blockers.push('Sale photos missing');
  const score = buildSaleReadinessScore({
    horse: next,
    documents: context.documents,
    receipts: context.expenseReceipts,
    ownershipRecord: context.ownershipRecords.find((record) => record.horseId === next.id),
    // This helper consumes only the evidence score. It never grants sale release.
    releaseGate: { allowed: false, nextAction: '' },
  }).score;
  return {
    ...next,
    readiness: {
      ...next.readiness,
      score,
      blockers,
      packetStatus: hasPhoto
        ? next.readiness.packetStatus === 'Needs Photos'
          ? 'Ready'
          : next.readiness.packetStatus
        : !hasReadyMediaKit && next.readiness.packetStatus === 'Ready'
          ? 'Needs Photos'
          : next.readiness.packetStatus,
    },
    sale: { ...next.sale, socialReady: hasPhoto || hasReadyMediaKit },
  };
}

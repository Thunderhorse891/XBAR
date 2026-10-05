import { buildHorsePacketCompleteness, salePacketDocumentTypes } from './xbarPhaseTwo.js';
import type { SalePacketSlot } from './xbarPhaseTwo.js';
import type { DocumentRecord, HorseRecord, OwnershipRecord } from '../types/xbar.js';

export type HorseDocumentAction = SalePacketSlot & {
  horseId: string;
  horseName: string;
  path: string;
  uploadPath: string;
  action: string;
  intent: 'upload' | 'review' | 'view' | 'processing';
};

/** Present the existing sale-packet checklist. This does not add requirements or approve documents. */
export function buildHorseDocumentActions(
  horse: HorseRecord,
  documents: DocumentRecord[],
  ownershipRecord?: OwnershipRecord,
): HorseDocumentAction[] {
  const packet = buildHorsePacketCompleteness(
    horse,
    documents.filter((document) => document.horseId === horse.id),
    ownershipRecord,
  );
  return packet.saleSlots
    .filter(
      (slot): slot is SalePacketSlot & { key: keyof typeof salePacketDocumentTypes } =>
        slot.key !== 'aqha-photos' && slot.status !== 'ready',
    )
    .map((slot) => {
      const params = new URLSearchParams({ horse: horse.id, from: 'profile', requirement: slot.key });
      const originals = documents.filter(
        (document) =>
          document.horseId === horse.id &&
          document.state !== 'Archived' &&
          salePacketDocumentTypes[slot.key].includes(document.type),
      );
      const uploadParams = new URLSearchParams(params);
      uploadParams.set('upload', '1');
      const intent = !originals.length
        ? 'upload'
        : originals.every((document) => document.state === 'Queued')
          ? 'processing'
          : originals.some((document) => document.state === 'Needs Review' || document.state === 'Matched')
            ? 'review'
            : 'view';
      if (intent === 'upload') params.set('upload', '1');
      else params.set('stage', intent === 'processing' ? 'Processing' : 'Library');
      const verb =
        intent === 'upload'
          ? 'Upload'
          : intent === 'review'
            ? 'Review'
            : intent === 'processing'
              ? 'Check processing for'
              : 'View';
      return {
        ...slot,
        horseId: horse.id,
        horseName: horse.name,
        path: `/documents?${params}`,
        intent,
        uploadPath: `/documents?${uploadParams}`,
        action: `${verb} ${slot.label}`,
      };
    });
}

export function horseAgeLabel(horse: Pick<HorseRecord, 'age'>): string {
  return Number.isFinite(horse.age) && horse.age > 0
    ? `${horse.age} ${horse.age === 1 ? 'year' : 'years'} old`
    : 'Age not recorded';
}

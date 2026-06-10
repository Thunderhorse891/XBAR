import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import type { DocumentRecord, HorseRecord, OwnershipRecord } from '@/types/xbar';

export type BuyerPacketReleaseGate = {
  allowed: boolean;
  score: number;
  status: 'Release Clear' | 'Release Blocked';
  tone: 'emerald' | 'amber' | 'rose';
  blockers: string[];
  warnings: string[];
  summary: string;
  nextAction: string;
};

const CORE_RELEASE_SLOT_KEYS = new Set(['aqha-papers', 'transfer-papers', 'coggins', 'health-cert']);

export function buildBuyerPacketReleaseGate(params: {
  horse: HorseRecord;
  documents: DocumentRecord[];
  ownershipRecord?: OwnershipRecord;
}): BuyerPacketReleaseGate {
  const packet = buildHorsePacketCompleteness(params.horse, params.documents, params.ownershipRecord);
  const blockers: string[] = [];
  const warnings: string[] = [];

  packet.saleSlots.forEach((slot) => {
    if (!CORE_RELEASE_SLOT_KEYS.has(slot.key)) {
      if (slot.status !== 'ready') warnings.push(`${slot.label}: ${slot.detail}`);
      return;
    }

    if (slot.status !== 'ready') blockers.push(`${slot.label}: ${slot.detail}`);
  });

  packet.requirements.forEach((requirement) => {
    if (requirement.status === 'missing') blockers.push(`${requirement.label}: ${requirement.detail}`);
    if (requirement.status === 'review') warnings.push(`${requirement.label}: ${requirement.detail}`);
  });

  if (params.horse.status === 'Medical Review') {
    blockers.push('Care Status: medical review is still open.');
  }

  if (params.ownershipRecord && params.ownershipRecord.transferStatus !== 'Clear') {
    blockers.push(`Title & Transfer: transfer status is ${params.ownershipRecord.transferStatus}.`);
  }

  params.horse.alerts
    .filter((alert) => alert.severity === 'high')
    .forEach((alert) => blockers.push(`${alert.module}: ${alert.title}`));

  if (packet.score < 84) {
    blockers.push(`Buyer packet score is ${packet.score}; release requires 84 or higher.`);
  }

  const uniqueBlockers = [...new Set(blockers)];
  const uniqueWarnings = [...new Set(warnings)].filter((warning) => !uniqueBlockers.includes(warning));
  const allowed = uniqueBlockers.length === 0 && packet.buyerProfileStatus === 'Live';
  const nextAction = uniqueBlockers[0] ?? uniqueWarnings[0] ?? 'Release buyer packet.';

  return {
    allowed,
    score: packet.score,
    status: allowed ? 'Release Clear' : 'Release Blocked',
    tone: allowed ? 'emerald' : uniqueBlockers.length ? 'rose' : 'amber',
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    summary: allowed
      ? 'Buyer packet release is clear. Title, proof, care, and packet readiness meet the release standard.'
      : `${uniqueBlockers.length} blocker${uniqueBlockers.length === 1 ? '' : 's'} must clear before buyer packet release.`,
    nextAction,
  };
}

import { buildHorsePacketCompleteness } from './xbarPhaseTwo.js';
import { buildSaleHold } from './saleTrustEngine.js';
import { packetHoldAction, packetRequirementAction, type PacketRemediation } from './salePacketGuidance.js';
import type { DocumentRecord, HorseRecord, OwnershipRecord } from '../types/xbar.js';

export type BuyerPacketReleaseGate = {
  allowed: boolean;
  score: number;
  status: 'Release Clear' | 'Release Blocked';
  tone: 'emerald' | 'amber' | 'rose';
  blockers: string[];
  warnings: string[];
  remediations: PacketRemediation[];
  summary: string;
  nextAction: string;
};

export const PRIVATE_LISTING_BLOCKER =
  'Listing: Not listed for sale — set an asking price before releasing a buyer packet.';

const CORE_RELEASE_SLOT_KEYS = new Set(['aqha-papers', 'transfer-papers', 'coggins', 'health-cert']);

export function buildBuyerPacketReleaseGate(params: {
  horse: HorseRecord;
  documents: DocumentRecord[];
  ownershipRecord?: OwnershipRecord;
}): BuyerPacketReleaseGate {
  const packet = buildHorsePacketCompleteness(params.horse, params.documents, params.ownershipRecord);
  const saleHold = buildSaleHold(params.horse, params.documents, params.ownershipRecord);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const remediations: PacketRemediation[] = [];
  const addRemediation = (reason: string, key: string) =>
    remediations.push({ reason, ...packetRequirementAction(key, params.horse, params.documents) });

  packet.saleSlots.forEach((slot) => {
    if (slot.status !== 'ready') addRemediation(`${slot.label}: ${slot.detail}`, slot.key);
    if (!CORE_RELEASE_SLOT_KEYS.has(slot.key)) {
      if (slot.status !== 'ready') warnings.push(`${slot.label}: ${slot.detail}`);
      return;
    }

    if (slot.status !== 'ready') blockers.push(`${slot.label}: ${slot.detail}`);
  });

  packet.requirements.forEach((requirement) => {
    if (requirement.status !== 'ready') addRemediation(`${requirement.label}: ${requirement.detail}`, requirement.key);
    if (requirement.status === 'missing') blockers.push(`${requirement.label}: ${requirement.detail}`);
    if (requirement.status === 'review') warnings.push(`${requirement.label}: ${requirement.detail}`);
  });

  blockers.push(...saleHold.reasons.map((reason) => `Sale hold: ${reason}`));
  saleHold.reasons.forEach((reason) =>
    remediations.push({ reason: `Sale hold: ${reason}`, ...packetHoldAction(reason, params.horse, params.documents) }),
  );

  params.horse.alerts
    .filter((alert) => alert.severity === 'high')
    .forEach((alert) => {
      const reason = `${alert.module}: ${alert.title}`;
      blockers.push(reason);
      remediations.push({ reason, ...packetHoldAction(reason, params.horse, params.documents) });
    });

  if (packet.score < 84) {
    const reason = `Buyer packet score is ${packet.score}; release requires 84 or higher.`;
    blockers.push(reason);
    remediations.push({
      ...(remediations[0] ?? packetRequirementAction('record', params.horse, params.documents)),
      reason,
    });
  }

  // A horse that is not listed for sale is never released. Say so, rather than
  // blocking with no blocker and a next action of "Release buyer packet."
  if (packet.buyerProfileStatus === 'Private') {
    blockers.push(PRIVATE_LISTING_BLOCKER);
    addRemediation(PRIVATE_LISTING_BLOCKER, 'listing');
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
    remediations: remediations.filter(
      (item, index, all) => all.findIndex((other) => other.reason === item.reason) === index,
    ),
    summary: allowed
      ? 'Buyer packet release is clear. Title, documents, care, and packet readiness meet the release standard.'
      : !uniqueBlockers.length
        ? 'Complete the remaining review checks before buyer packet release.'
        : `${uniqueBlockers.length} blocker${uniqueBlockers.length === 1 ? '' : 's'} must clear before buyer packet release.`,
    nextAction,
  };
}

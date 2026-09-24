import type { DocumentRecord, ExpenseCategory, ExpenseReceipt, HorseRecord, OwnershipRecord } from '../types/xbar.js';
import { hasHorsePhoto, identityCompleteness } from './animalPassport.js';
import { buildCareBoardRows } from './dashboardOps.js';
import {
  CURRENT_COGGINS_DAYS,
  hasCurrentReadyDocument,
  hasResolvedDocumentMissingCurrentDate,
  isCurrentDatedDocument,
  isDocumentReady,
} from './documentCurrency.js';
import { normalizeOwnershipRecord } from '../store/xbarStoreLogic.js';

/*
 * Sale readiness, 0–100, computed from the records rather than stored.
 *
 * The horse record carries a `readiness.score` that is nudged up a few points
 * whenever certain documents arrive and never comes back down — a Coggins can
 * lapse and the number stays. This score is recomputed from what is on file
 * every time, from the same rules the rest of XBAR already applies:
 *
 *   identity        20  animalPassport identity fields (the photo is scored under media)
 *   Coggins         20  a reviewed Coggins inside CURRENT_COGGINS_DAYS (documentCurrency)
 *   transfer file   15  a reviewed transfer packet or bill of sale (as the transfer gap board)
 *   media           15  a real photograph of the horse (animalPassport.hasHorsePhoto)
 *   care current    15  wormer and dental float not overdue on the care board (dashboardOps)
 *   ownership       15  transfer Clear with every ownership proof verified
 *
 * Each gap comes back as an action with the score it would reach, so the
 * profile can say "Add a current Coggins to reach 85" and mean it.
 */

export const PROOF_PACKET_THRESHOLD = 85;

export type ReadinessComponentKey = 'identity' | 'coggins' | 'transfer' | 'media' | 'care' | 'ownership';

export type ReadinessActionTarget =
  'edit-horse' | 'upload-document' | 'review-documents' | 'add-photo' | 'care' | 'ownership';

export type ReadinessComponent = {
  key: ReadinessComponentKey;
  label: string;
  earned: number;
  max: number;
  detail: string;
};

export type ReadinessAction = {
  key: ReadinessComponentKey;
  /** What to do, in the rancher's words: "Add a current Coggins". */
  label: string;
  target: ReadinessActionTarget;
  /** For a care action: the receipt category that clears it on the care board. */
  logCategory?: Extract<ExpenseCategory, 'Wormer' | 'Dental Float'>;
  /** Points this action recovers. */
  gain: number;
  /** The score once it is done. */
  reach: number;
};

export type SaleReadinessScore = {
  score: number;
  components: ReadinessComponent[];
  /** Every open gap, biggest gain first. */
  actions: ReadinessAction[];
  /** The three the profile leads with. */
  topActions: ReadinessAction[];
  cogginsCurrent: boolean;
  transferClear: boolean;
  /**
   * Whether the proof packet can be generated from here: the score has
   * crossed the threshold AND the buyer-packet release gate is clear. The gate
   * is the verdict the generated packet prints for the buyer ("Release Clear"
   * or "Release Blocked"), so "ready" here can never produce a packet that
   * says it was not.
   */
  proofPacketReady: boolean;
  /** Why the packet is not ready yet, or null when it is. */
  proofPacketBlocker: string | null;
};

const WEIGHTS: Record<ReadinessComponentKey, number> = {
  identity: 20,
  coggins: 20,
  transfer: 15,
  media: 15,
  care: 15,
  ownership: 15,
};

/**
 * The buyer-packet release gate's verdict (lib/buyerPacketReleaseGate.ts).
 *
 * Passed in rather than computed here: that module is reached through the
 * Vite `@/` alias, which the node test runner cannot load, and this one must
 * stay testable. Every caller passes the real gate for the same horse.
 */
export type ReleaseGateVerdict = { allowed: boolean; nextAction: string };

/** Credit for an ownership chain whose proofs are verified but not yet marked Clear. */
const OWNERSHIP_UNCLEARED_CAP = 12;

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function buildSaleReadinessScore(params: {
  horse: HorseRecord;
  documents: DocumentRecord[];
  receipts: ExpenseReceipt[];
  ownershipRecord?: OwnershipRecord;
  releaseGate: ReleaseGateVerdict;
  now?: Date;
}): SaleReadinessScore {
  const { horse } = params;
  const now = params.now ?? new Date();
  const documents = params.documents.filter(
    (document) => document.horseId === horse.id && document.state !== 'Archived',
  );
  const components: ReadinessComponent[] = [];
  const actions: Omit<ReadinessAction, 'reach'>[] = [];

  // Identity — the passport fields, less the photo (scored under media).
  const identityFields = identityCompleteness(horse).fields.filter((field) => field.key !== 'photo');
  const missingIdentity = identityFields.filter((field) => !field.present);
  const identityEarned = WEIGHTS.identity * ((identityFields.length - missingIdentity.length) / identityFields.length);
  components.push({
    key: 'identity',
    label: 'Identity',
    earned: identityEarned,
    max: WEIGHTS.identity,
    detail: missingIdentity.length
      ? `Missing ${missingIdentity.map((field) => field.label.toLowerCase()).join(', ')}.`
      : 'Every identity field is on file.',
  });
  if (missingIdentity.length) {
    const named = missingIdentity.slice(0, 2).map((field) => field.label.toLowerCase());
    actions.push({
      key: 'identity',
      label:
        missingIdentity.length > 2
          ? `Add ${named.join(', ')} and ${missingIdentity.length - 2} more identity detail${missingIdentity.length - 2 === 1 ? '' : 's'}`
          : `Add ${named.join(' and ')}`,
      target: 'edit-horse',
      gain: WEIGHTS.identity - identityEarned,
    });
  }

  // Coggins — the same currency rule as the sale-packet gate.
  const coggins = documents.filter((document) => document.type === 'Coggins');
  const cogginsCurrent = hasCurrentReadyDocument(coggins, CURRENT_COGGINS_DAYS, now);
  /*
   * The annual renewal: last year's reviewed Coggins is still on the record
   * and this year's is waiting in review. The pending one decides the action —
   * approving it is the fix, and asking for another upload creates a
   * duplicate. Only a pending Coggins whose exam date is itself current
   * counts; approving one with no date or an old date would not help.
   */
  const cogginsInReview =
    !cogginsCurrent &&
    coggins.some(
      (document) => !isDocumentReady(document) && isCurrentDatedDocument(document, CURRENT_COGGINS_DAYS, now),
    );
  const cogginsStale =
    !cogginsCurrent && !cogginsInReview && hasResolvedDocumentMissingCurrentDate(coggins, CURRENT_COGGINS_DAYS, now);
  components.push({
    key: 'coggins',
    label: 'Coggins',
    earned: cogginsCurrent ? WEIGHTS.coggins : 0,
    max: WEIGHTS.coggins,
    detail: cogginsCurrent
      ? 'A reviewed Coggins inside 12 months is on file.'
      : cogginsStale
        ? 'The Coggins on file is past 12 months or has no exam date.'
        : cogginsInReview
          ? 'A current Coggins is on file but still waiting in review.'
          : coggins.length
            ? 'The Coggins on file has no exam date XBAR can use.'
            : 'No Coggins on file.',
  });
  if (!cogginsCurrent) {
    actions.push({
      key: 'coggins',
      label: cogginsInReview ? 'Approve the Coggins in review' : 'Add a current Coggins',
      target: cogginsInReview ? 'review-documents' : 'upload-document',
      gain: WEIGHTS.coggins,
    });
  }

  // Transfer file — what the transfer gap board looks for.
  const transferDocs = documents.filter(
    (document) => document.type === 'Transfer Packet' || document.type === 'Bill of Sale',
  );
  const transferPresent = transferDocs.some(isDocumentReady);
  components.push({
    key: 'transfer',
    label: 'Transfer file',
    earned: transferPresent ? WEIGHTS.transfer : 0,
    max: WEIGHTS.transfer,
    detail: transferPresent
      ? 'A reviewed transfer packet or bill of sale is on file.'
      : transferDocs.length
        ? 'A transfer file is on file but still waiting in review.'
        : 'No transfer packet or bill of sale on file.',
  });
  if (!transferPresent) {
    actions.push({
      key: 'transfer',
      label: transferDocs.length ? 'Approve the transfer file in review' : 'Add the transfer file',
      target: transferDocs.length ? 'review-documents' : 'upload-document',
      gain: WEIGHTS.transfer,
    });
  }

  // Media — a real photograph, not a pedigree scan.
  const hasPhoto = hasHorsePhoto(horse);
  components.push({
    key: 'media',
    label: 'Photos',
    earned: hasPhoto ? WEIGHTS.media : 0,
    max: WEIGHTS.media,
    detail: hasPhoto ? 'A photo of the horse is on file.' : 'No photo of the horse yet.',
  });
  if (!hasPhoto) {
    actions.push({ key: 'media', label: 'Add a photo', target: 'add-photo', gain: WEIGHTS.media });
  }

  // Care — wormer and dental float on the care board. Coggins is scored above.
  const careSignals = (buildCareBoardRows([horse], params.documents, params.receipts, now)[0]?.signals ?? []).filter(
    (signal) => signal.key !== 'coggins',
  );
  const careDue = careSignals.filter((signal) => signal.status === 'due');
  const careEarned = WEIGHTS.care * ((2 - careDue.length) / 2);
  components.push({
    key: 'care',
    label: 'Care records',
    earned: careEarned,
    max: WEIGHTS.care,
    detail: careDue.length
      ? `${careDue.map((signal) => signal.detail).join('; ')}.`
      : 'Deworming and dental float are current.',
  });
  if (careDue.length) {
    actions.push({
      key: 'care',
      label:
        careDue.length === 2
          ? 'Log a deworming and a dental float'
          : `Log a ${careDue[0]!.key === 'wormer' ? 'deworming' : 'dental float'}`,
      target: 'care',
      logCategory: careDue[0]!.key === 'wormer' ? 'Wormer' : 'Dental Float',
      gain: WEIGHTS.care - careEarned,
    });
  }

  // Ownership — every proof verified and the transfer marked Clear.
  const ownership = params.ownershipRecord ? normalizeOwnershipRecord(params.ownershipRecord) : undefined;
  const proofs = ownership?.proofRequirements ?? [];
  const verified = proofs.filter((proof) => proof.status === 'verified').length;
  const transferClear = ownership?.transferStatus === 'Clear';
  const allVerified = proofs.length > 0 && verified === proofs.length;
  const ownershipEarned = !ownership
    ? 0
    : transferClear && allVerified
      ? WEIGHTS.ownership
      : Math.min(OWNERSHIP_UNCLEARED_CAP, WEIGHTS.ownership * (proofs.length ? verified / proofs.length : 0));
  components.push({
    key: 'ownership',
    label: 'Ownership chain',
    earned: ownershipEarned,
    max: WEIGHTS.ownership,
    detail: !ownership
      ? 'No ownership record yet.'
      : transferClear && allVerified
        ? 'Every ownership proof is verified and the transfer is Clear.'
        : `${verified} of ${proofs.length} ownership proofs verified · transfer ${ownership.transferStatus}.`,
  });
  if (ownershipEarned < WEIGHTS.ownership) {
    /*
     * Each action claims only what its own step earns. Verifying proofs on a
     * transfer that is not Clear stops at the uncleared cap, so clearing it is
     * a separate step; when verifying alone would earn nothing more, or there
     * is no record yet, the action names the whole path to the full 15.
     */
    const unverified = proofs.length - verified;
    const proofsLabel = `${unverified} ownership proof${unverified === 1 ? '' : 's'}`;
    const verifyGain = (transferClear ? WEIGHTS.ownership : OWNERSHIP_UNCLEARED_CAP) - ownershipEarned;
    const step = !ownership
      ? { label: 'Record ownership, verify its proofs and clear the transfer', gain: WEIGHTS.ownership }
      : allVerified
        ? { label: 'Mark the transfer Clear', gain: WEIGHTS.ownership - ownershipEarned }
        : verifyGain > 0
          ? { label: `Verify ${proofsLabel}`, gain: verifyGain }
          : {
              label: `Verify ${proofsLabel} and mark the transfer Clear`,
              gain: WEIGHTS.ownership - ownershipEarned,
            };
    actions.push({ key: 'ownership', target: 'ownership', ...step });
  }

  const raw = components.reduce((sum, component) => sum + component.earned, 0);
  const score = Math.round(raw);
  const sorted = actions
    .map((action) => ({ ...action, gain: round1(action.gain), reach: Math.min(100, Math.round(raw + action.gain)) }))
    .sort((left, right) => right.gain - left.gain);

  const proofPacketReady = score >= PROOF_PACKET_THRESHOLD && params.releaseGate.allowed;
  const proofPacketBlocker = proofPacketReady
    ? null
    : score < PROOF_PACKET_THRESHOLD
      ? `Reach ${PROOF_PACKET_THRESHOLD} to generate a proof packet.`
      : `Release gate: ${params.releaseGate.nextAction}`;

  return {
    score,
    components: components.map((component) => ({ ...component, earned: round1(component.earned) })),
    actions: sorted,
    topActions: sorted.slice(0, 3),
    cogginsCurrent,
    transferClear,
    proofPacketReady,
    proofPacketBlocker,
  };
}

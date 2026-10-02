import type { DocumentRecord, HorseRecord } from '../types/xbar.js';
import { hasStoredFile } from './storedFiles.js';
import type { ReadinessAction } from './saleReadinessScore.js';
import { billingPathForTier } from './billingRoutes.js';

export type PacketRepairAction = { label: string; to: string };
export type PacketRemediation = PacketRepairAction & { reason: string };

export function packetDocumentAction(
  horseId: string,
  documents: DocumentRecord[],
  types: DocumentRecord['type'][],
  label: string,
): PacketRepairAction {
  const matching = documents.filter(
    (document) => document.horseId === horseId && document.state !== 'Archived' && types.includes(document.type),
  );
  const needsReview = matching.some((document) => document.state === 'Needs Review' || document.state === 'Matched');
  const processing = matching.some((document) => document.state === 'Queued');
  // Ready documents aren't rendered in the Review queue. Stale approved health
  // records need a new current source; sending them to that empty queue was
  // another dead end. Other approved source files live under Ownership/Proof.
  const healthSource = types.includes('Coggins') || types.includes('Vet Record');
  const stage = needsReview
    ? 'Review'
    : processing
      ? 'Processing'
      : matching.some((document) => document.state === 'Ready' && hasStoredFile(document)) && !healthSource
        ? 'Proof'
        : 'Upload';
  return {
    label:
      stage === 'Processing'
        ? `Check ${label} processing`
        : `${stage === 'Upload' ? 'Upload' : 'Review'} ${stage === 'Upload' && healthSource && matching.length ? 'current ' : ''}${label}`,
    to: `/documents?horse=${encodeURIComponent(horseId)}&stage=${stage}`,
  };
}

export function packetRequirementAction(
  key: string,
  horse: HorseRecord,
  documents: DocumentRecord[],
): PacketRepairAction {
  const id = encodeURIComponent(horse.id);
  switch (key) {
    case 'aqha-papers':
    case 'identity':
      return packetDocumentAction(horse.id, documents, ['Registration', 'Bill of Sale'], 'registration proof');
    case 'transfer-papers':
    case 'ownership':
      return { label: 'Review ownership requirements', to: `/ownership?horse=${id}` };
    case 'coggins':
      return packetDocumentAction(horse.id, documents, ['Coggins'], 'Coggins');
    case 'health-cert':
    case 'medical':
      return horse.status === 'Medical Review'
        ? { label: 'Review medical hold', to: `/medical?horse=${id}` }
        : packetDocumentAction(horse.id, documents, ['Vet Record'], 'health support');
    case 'buyer-packet':
      if (horse.alerts.some((alert) => alert.severity === 'high'))
        return { label: 'Review blocking alerts on horse record', to: `/horses/${id}` };
      if (
        !horse.sale.socialReady &&
        documents.some(
          (document) => document.horseId === horse.id && document.type === 'Media Kit' && document.state === 'Ready',
        )
      )
        return { label: 'Add approved horse photos', to: `/horses/${id}` };
      return packetDocumentAction(horse.id, documents, ['Media Kit'], 'sale media packet');
    case 'media':
    case 'aqha-photos':
      return { label: 'Add or review horse photos', to: `/horses/${id}` };
    case 'listing':
      return { label: 'Set asking price on horse record', to: `/horses/${id}` };
    default:
      return { label: 'Review horse record', to: `/horses/${id}` };
  }
}

// This maps existing hold reasons to a repair destination; it never changes
// whether the hold applies. Unknown reasons keep the actual message visible.
export function packetHoldAction(reason: string, horse: HorseRecord, documents: DocumentRecord[]): PacketRepairAction {
  const horseQuery = encodeURIComponent(horse.id);
  if (/Documents [→>] Review|duplicate warning|assignment|extracted identity conflicts/i.test(reason)) {
    return { label: 'Correct document review', to: `/documents?horse=${horseQuery}&stage=Review` };
  }
  if (
    /upload (?:the original|a clearer|a complete|a document)|filename alone|readable contents do not match/i.test(
      reason,
    )
  ) {
    return { label: 'Upload correct source document', to: `/documents?horse=${horseQuery}&stage=Upload` };
  }
  if (/ownership|transfer|registry|legal.owner|title|proof|signature/i.test(reason)) {
    return packetRequirementAction('ownership', horse, documents);
  }
  if (/coggins/i.test(reason)) return packetRequirementAction('coggins', horse, documents);
  if (/medical|health|care hold/i.test(reason)) return packetRequirementAction('medical', horse, documents);
  if (/document/i.test(reason)) {
    return { label: 'Review documents', to: `/documents?horse=${encodeURIComponent(horse.id)}&stage=Review` };
  }
  return packetRequirementAction('record', horse, documents);
}

export type PacketFailureGuidance = { message: string; help: string; action?: PacketRepairAction };

export function packetFailureGuidance(
  failure: { message: string; status?: number; code?: string; tierBlock?: { requiredPlan: string } },
  canPresentPurchaseFlow: () => boolean,
): PacketFailureGuidance {
  const canPurchase = canPresentPurchaseFlow();
  if (
    failure.tierBlock ||
    ['tier_required', 'sale_packet_limit_reached', 'storage_limit_reached'].includes(failure.code ?? '')
  ) {
    return {
      message: failure.message,
      help: canPurchase
        ? 'Review your current plan and usage in Billing. If a plan you already have is missing, refresh the cloud connection before trying again. Your packet details are kept while you stay in XBAR.'
        : 'Ask your workspace administrator to review the plan and usage. Your packet details are kept here.',
      ...(canPurchase
        ? { action: { label: 'Review plan and usage', to: billingPathForTier(failure.tierBlock?.requiredPlan) } }
        : {}),
    };
  }
  if (failure.status === 401) {
    return {
      message: failure.message,
      help: 'Your cloud session needs attention. Sign in again, then return to this packet.',
      action: { label: 'Open sign in', to: '/login' },
    };
  }
  if (failure.status === 403) {
    return {
      message: failure.message,
      help: 'Ask a workspace administrator to confirm your access to this workspace. Your packet details are kept here.',
    };
  }
  if (failure.status === 404) {
    return {
      message: failure.message,
      help: 'The horse may have been removed or changed in the cloud. Review the current horse roster before trying again.',
      action: { label: 'Review horses', to: '/horses' },
    };
  }
  return {
    message: failure.message,
    help:
      failure.status === 429
        ? 'Too many requests were made. Wait a moment, then retry with the same packet details.'
        : 'Your packet details are kept here. Check your connection and retry. If it still fails, use Settings to check cloud sync or contact support.',
    action: { label: 'Check cloud connection', to: '/settings' },
  };
}

export function packetReadinessAction(action: ReadinessAction, horseId: string): PacketRepairAction {
  const id = encodeURIComponent(horseId);
  switch (action.target) {
    case 'upload-document':
      return { label: 'Upload document', to: `/documents?horse=${id}&stage=Upload` };
    case 'review-documents':
      return { label: 'Review documents', to: `/documents?horse=${id}&stage=Review` };
    case 'processing-documents':
      return { label: 'Check document processing', to: `/documents?horse=${id}&stage=Processing` };
    case 'ownership':
      return { label: 'Review ownership requirements', to: `/ownership?horse=${id}` };
    case 'care':
      return {
        label: 'Log care receipt',
        to: `/expenses?log=${encodeURIComponent(action.logCategory ?? 'Wormer')}&horse=${id}`,
      };
    case 'add-photo':
      return { label: 'Add horse photos', to: `/horses/${id}` };
    default:
      return { label: 'Edit horse details', to: `/horses/${id}` };
  }
}

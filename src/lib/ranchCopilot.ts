import type { DocumentRecord, HorseRecord, OwnershipRecord } from '../types/xbar.js';
import { buildSaleReadinessScore } from './saleReadinessScore.js';
import { documentDuplicateNeedsReview } from './documentDuplicates.js';
import { buildExpiryRadar } from './documentExpiry.js';
import { documentIdentityCacheNeedsReview, inspectDocumentHorseIdentity } from './ownershipDocumentReview.js';

export type CopilotAction = {
  id: string;
  priority: 'Review first' | 'Upcoming' | 'Missing evidence';
  title: string;
  reason: string;
  sources: string[];
};
export type CopilotSource = { id: string; title: string; facts: string[] };
export type RanchPlan = {
  horseId: string;
  horseName: string;
  asOf: string;
  actions: CopilotAction[];
  sources: CopilotSource[];
};

/** Pure read-only planning over the caller's current authorized workspace snapshot.
 * No retrieval, model, tools, storage, or interpretation of document text as commands.
 */
export function buildRanchPlan(
  horse: HorseRecord,
  input: DocumentRecord[],
  ownership?: OwnershipRecord,
  now = new Date(),
): RanchPlan {
  const horseSource = `horse:${horse.id}`;
  const scoped = input.filter((d) => d.horseId === horse.id && d.state !== 'Archived');
  const documents = scoped.map((d) => {
    const inspection = inspectDocumentHorseIdentity(d, horse);
    const fresh = {
      ...d,
      entities: inspection.sourceEntities,
      identityReviewRequired: inspection.sourceIdentityReviewRequired,
    };
    const held =
      Boolean(inspection.conflictReason || inspection.missingIdentityReason) ||
      d.identityReviewRequired ||
      fresh.identityReviewRequired ||
      documentIdentityCacheNeedsReview(d, horse) ||
      documentIdentityCacheNeedsReview(fresh, horse) ||
      Boolean(d.batchReviewNote) ||
      documentDuplicateNeedsReview(d);
    return { ...fresh, state: held ? ('Needs Review' as const) : d.state, identityReviewRequired: Boolean(held) };
  });
  const owner = ownership?.horseId === horse.id ? ownership : undefined;
  const sources: CopilotSource[] = [
    {
      id: horseSource,
      title: `Horse record: ${horse.name}`,
      facts: [
        `Registration: ${horse.registrationNumber || horse.aqhaNumber || 'not recorded'}`,
        `Owner: ${horse.owner || 'not recorded'}`,
        `Linked active documents examined: ${documents.length}. Unlinked and archived documents excluded.`,
      ],
    },
  ];
  if (owner)
    sources.push({
      id: `ownership:${owner.id}`,
      title: 'Ownership record',
      facts: [`Transfer status: ${owner.transferStatus}`, `Legal owner: ${owner.legalOwner || 'not recorded'}`],
    });
  for (const d of documents)
    sources.push({
      id: `document:${d.id}`,
      title: d.title || 'Untitled document',
      facts: [
        `Document ID: ${d.id}`,
        `Type: ${d.type}; review state: ${d.state}`,
        `Source registration: ${d.entities.registrationNumber || 'not extracted'}`,
        `Source exam date: ${d.entities.examDate || 'not extracted'}`,
        ...(d.identityReviewRequired ? ['Identity conflict or intake hold: human review required.'] : []),
        ...(d.processingNote ? [`Reading limitation: ${d.processingNote}`] : []),
      ],
    });
  const actions: CopilotAction[] = [];
  for (const d of documents) {
    if (d.identityReviewRequired || d.processingNote || d.state !== 'Ready')
      actions.push({
        id: `review:${d.id}`,
        priority: 'Review first',
        title: d.identityReviewRequired
          ? 'Resolve conflicting horse evidence'
          : d.processingNote
            ? 'Check incomplete document reading'
            : 'Review document before relying on it',
        reason: d.identityReviewRequired
          ? 'A linked paper conflicts with the horse identity or has an intake hold. Do not treat it as verified evidence.'
          : d.processingNote
            ? 'The intake reader reported a limitation; inspect the original before making a decision.'
            : `This paper is ${d.state}; extracted fields have not established reviewed evidence.`,
        sources: [horseSource, `document:${d.id}`],
      });
  }
  // Reuse existing currency rules; a document under an identity hold cannot support a date claim.
  const radar = buildExpiryRadar(
    documents.filter((d) => !d.identityReviewRequired && !d.processingNote),
    [horse],
    now,
  );
  for (const item of [...radar.expired, ...radar.under30].filter((i) => i.reviewed))
    actions.push({
      id: `date:${item.documentId}`,
      priority: item.urgency === 'expired' ? 'Review first' : 'Upcoming',
      title: `${item.kind}: ${item.urgency === 'expired' ? 'review lapsed evidence' : 'plan renewal'}`,
      reason: `${item.expiresOn} (${item.daysLeft} days from this review). ${item.basis} This is XBAR's planning window; confirm requirements for the intended use.`,
      sources: [`document:${item.documentId}`],
    });
  const score = buildSaleReadinessScore({
    horse,
    documents: documents.filter((d) => !d.identityReviewRequired && !d.processingNote),
    receipts: [],
    ownershipRecord: owner,
    releaseGate: { allowed: false, nextAction: 'Separate packet approval is required.' },
    now,
  });
  for (const gap of score.actions) {
    // Care requires the separate care workflow's full history. Never infer care from this document-only plan.
    if (gap.key === 'care') continue;
    const related = documents.filter((d) =>
      gap.key === 'coggins'
        ? d.type === 'Coggins'
        : gap.key === 'transfer'
          ? ['Transfer Packet', 'Bill of Sale'].includes(d.type)
          : false,
    );
    actions.push({
      id: `gap:${gap.key}`,
      priority: 'Missing evidence',
      title: gap.label,
      reason: score.components.find((c) => c.key === gap.key)?.detail || 'Review the horse record.',
      sources: [
        horseSource,
        ...related.map((d) => `document:${d.id}`),
        ...(gap.key === 'ownership' && owner ? [`ownership:${owner.id}`] : []),
      ],
    });
  }
  const order = { 'Review first': 0, Upcoming: 1, 'Missing evidence': 2 };
  actions.sort((a, b) => order[a.priority] - order[b.priority] || a.id.localeCompare(b.id));
  return {
    horseId: horse.id,
    horseName: horse.name,
    asOf: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    actions,
    sources,
  };
}

export function ranchChecklist(plan: RanchPlan): string {
  return [
    `DRAFT — XBAR Ranch Copilot checklist`,
    `${plan.horseName} — reviewed ${plan.asOf}`,
    'Rule-based planning, not veterinary, legal or registry verification. No tasks saved, messages sent or packets shared.',
    ...plan.actions.flatMap((a, i) => [
      ``,
      `${i + 1}. [ ] ${a.title} (${a.priority})`,
      a.reason,
      `Evidence: ${a.sources.map((id) => plan.sources.find((s) => s.id === id)?.title || id).join('; ')}`,
    ]),
    '',
    'Scope: this horse and its linked active documents only. Care history and unlinked intake need separate review. Missing evidence does not prove a document does not exist.',
  ].join('\n');
}

import type { DocumentRecord } from '../types/xbar.js';

const groups = [
  { label: 'Registration', types: ['Registration'] },
  { label: 'Transfer', types: ['Transfer Packet', 'Bill of Sale', 'Ownership Memo'] },
  { label: 'Health', types: ['Vet Record', 'Coggins'] },
];

/** File inventory only. Presence never establishes ownership, validity or readiness. */
export function documentOverview(documents: DocumentRecord[], horseId?: string) {
  const active = documents.filter((doc) => doc.state !== 'Archived' && (!horseId || doc.horseId === horseId));
  return groups.map((group) => {
    const files = active.filter((doc) => group.types.includes(doc.type));
    const review = files.filter((doc) => doc.state === 'Needs Review' || doc.state === 'Matched');
    const processing = files.filter((doc) => doc.state === 'Queued');
    return {
      label: group.label,
      count: files.length,
      status: !files.length
        ? 'Not on file'
        : review.length
          ? 'Needs review'
          : processing.length
            ? 'Reading file'
            : 'On file',
    };
  });
}

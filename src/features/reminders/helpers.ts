export function kindCopy(kind: string): string {
  if (kind === 'Care') return 'Health, Coggins, dental, wormer, and care work.';
  if (kind === 'Ownership') return 'Transfer papers, owner records, and legal gaps.';
  if (kind === 'Documents') return 'Files waiting on match, review, or approval.';
  return 'Sale leads, follow-ups, and inquiry movement.';
}

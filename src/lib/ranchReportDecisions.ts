import type { HorseEconomicsRow, RanchReport } from './ranchReport.js';

export const reportDollars = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);

/** Presentation only: preserve the report's accounting and sale-gate predicates. */
export function reportException(horse: HorseEconomicsRow) {
  const ownership = horse.blockers.find((s) => s.startsWith('No ownership') || s.startsWith('Transfer'));
  const coggins = horse.blockers.find((s) => s.includes('Coggins'));
  const other = horse.blockers.filter((s) => s !== ownership && s !== coggins);
  return {
    ownership: !ownership
      ? 'Clear'
      : ownership.startsWith('No ownership')
        ? 'Not started'
        : ownership.replace(/^Transfer /, ''),
    coggins: !coggins
      ? 'Current / reviewed'
      : coggins.startsWith('No Coggins')
        ? 'Missing'
        : coggins.includes('exam date')
          ? 'Date not current'
          : 'Review required',
    other: other.length ? other.join('; ') : 'None',
    action:
      [
        ownership ? (ownership.startsWith('No ownership') ? 'Start ownership' : 'Resolve transfer') : '',
        coggins ? (coggins.startsWith('No Coggins') ? 'Record Coggins' : 'Review Coggins') : '',
        other.length ? 'Resolve care hold' : '',
      ]
        .filter(Boolean)
        .join('; ') || 'No recorded sale blockers',
  };
}

export function reportDecisions(report: RanchReport) {
  const listed = report.horses.filter((h) => h.saleInventory);
  const blocked = listed.filter((h) => h.blockers.length);
  const missingOwnership = blocked.filter((h) => h.blockers.some((s) => s.startsWith('No ownership')));
  const missingCoggins = blocked.filter((h) => h.blockers.includes('No Coggins on file'));
  const ranked = [...report.horses].sort(
    (a, b) =>
      Number(b.saleInventory) - Number(a.saleInventory) ||
      b.projectedMargin - a.projectedMargin ||
      b.investedToDate - a.investedToDate ||
      a.horseName.localeCompare(b.horseName),
  );
  const priced = listed.filter((h) => h.askPrice > 0);
  const potentialMargin = priced.reduce((n, h) => n + h.projectedMargin, 0);
  const bands = [
    { label: 'High >=30%', count: priced.filter((h) => h.marginPercent >= 30).length },
    { label: 'Medium 15-29%', count: priced.filter((h) => h.marginPercent >= 15 && h.marginPercent < 30).length },
    { label: 'Low <15%', count: priced.filter((h) => h.marginPercent < 15).length },
  ];
  const actions: string[] = [];
  if (missingOwnership.length)
    actions.push(
      `Start ownership records for ${missingOwnership.length} horses covering ${reportDollars(missingOwnership.reduce((n, h) => n + h.askPrice, 0))} in asking value. Other sale gates must also clear.`,
    );
  const transferCount = blocked.filter((h) => h.blockers.some((s) => s.startsWith('Transfer'))).length;
  if (transferCount > 0) actions.push(`Resolve transfer requirements for ${transferCount} horses before sale release.`);
  if (missingCoggins.length)
    actions.push(
      `Obtain or record Coggins for ${missingCoggins.length} horses; verify the exam date and review the file.`,
    );
  const reviewCoggins = blocked.filter((h) => h.blockers.some((s) => s.startsWith('Coggins'))).length;
  if (reviewCoggins) actions.push(`Review Coggins currency or approval for ${reviewCoggins} horses.`);
  const medical = blocked.filter((h) => h.blockers.some((s) => s.startsWith('Active medical'))).length;
  if (medical) actions.push(`Resolve medical review and buyer disclosure for ${medical} horses.`);
  if (report.documentsToReview)
    actions.push(`Review ${report.documentsToReview} existing files in the document queue.`);
  if (report.money.unallocatedThisMonth > 0)
    actions.push(
      `Review ${reportDollars(report.money.unallocatedThisMonth)} of current-month unallocated overhead before assessing horse profitability.`,
    );
  const best = ranked.find((h) => h.saleInventory && h.askPrice > 0 && h.projectedMargin > 0);
  if (best)
    actions.push(
      `Review the highest projected-profit horse first: ${best.horseName} (${reportDollars(best.projectedMargin)} before unallocated overhead).`,
    );
  if (!actions.length)
    actions.push(
      'No recorded sale blockers or review tasks. Confirm records are complete before relying on these estimates.',
    );
  return { listed, blocked, missingOwnership, missingCoggins, ranked, potentialMargin, bands, actions };
}

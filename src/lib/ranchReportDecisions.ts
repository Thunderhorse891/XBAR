import type { HorseEconomicsRow, RanchReport } from './ranchReport.js';

export const reportDollars = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);

/**
 * "1 horse" / "2 horses" — the singular case is the common case on a small
 * ranch, and "1 horses" on a document handed to a banker reads as careless.
 */
export function reportCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/** The blocker's core noun phrase, as the blocker itself states it: "Active medical review". */
function otherCore(blocker: string): string {
  const core = blocker.split('—')[0].trim();
  return core.charAt(0).toLowerCase() + core.slice(1);
}

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
        // Mirrors the blocker's own language ("Active medical review", not the
        // workspace's internal "care hold") — the rancher acts on this line.
        other.length ? `Resolve ${otherCore(other[0])}${other.length > 1 ? ` and ${other.length - 1} more` : ''}` : '',
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
      Number(b.saleInventory && b.askPrice > 0) - Number(a.saleInventory && a.askPrice > 0) ||
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
      `Start ownership records for ${reportCount(missingOwnership.length, 'horse')} covering ${reportDollars(missingOwnership.reduce((n, h) => n + h.askPrice, 0))} in asking value. Other sale gates must also clear.`,
    );
  const transferCount = blocked.filter((h) => h.blockers.some((s) => s.startsWith('Transfer'))).length;
  if (transferCount > 0)
    actions.push(`Resolve transfer requirements for ${reportCount(transferCount, 'horse')} before sale release.`);
  if (missingCoggins.length)
    actions.push(
      `Obtain or record Coggins for ${reportCount(missingCoggins.length, 'horse')}; verify the exam date and review the file.`,
    );
  const reviewCoggins = blocked.filter((h) => h.blockers.some((s) => s.startsWith('Coggins'))).length;
  if (reviewCoggins)
    actions.push(`Review the Coggins test date and approval status for ${reportCount(reviewCoggins, 'horse')}.`);
  const medical = blocked.filter((h) => h.blockers.some((s) => s.startsWith('Active medical'))).length;
  if (medical) actions.push(`Resolve medical review and buyer disclosure for ${reportCount(medical, 'horse')}.`);
  if (report.documentsToReview)
    actions.push(`Review ${reportCount(report.documentsToReview, 'existing file')} in the document queue.`);
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

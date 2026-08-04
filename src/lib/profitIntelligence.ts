import type { ExpenseCategory, ExpenseReceipt, HorseRecord, SalesLead } from '../types/xbar.js';

export type OfferDecisionStatus = 'no-offer' | 'missing-costs' | 'loss' | 'thin-margin' | 'protected-margin';

export type OfferDecision = {
  status: OfferDecisionStatus;
  effectiveOffer: number;
  breakEven: number;
  safeSalePrice: number;
  expectedProfit: number;
  marginPercent: number;
  acceptanceBlocked: boolean;
  overrideRequired: boolean;
  label: string;
  recommendation: string;
};

export function buildHorseProfitProfile(horse: HorseRecord, receipts: ExpenseReceipt[], leads: SalesLead[]) {
  const horseReceipts = receipts.filter((receipt) => receipt.horseId === horse.id);
  const spend = horseReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const costBasis = Math.max(0, horse.costBasis ?? 0);
  const breakEven = costBasis + spend;
  const acceptedOffer = leads
    .filter(
      (lead) =>
        lead.horseId === horse.id && ['Accepted', 'Deposit Due', 'Deposit Paid'].includes(lead.offerStatus ?? ''),
    )
    .sort((left, right) => (right.offerUpdatedAt ?? '').localeCompare(left.offerUpdatedAt ?? ''))[0];
  const salePrice = acceptedOffer?.counterOfferAmount ?? acceptedOffer?.offerAmount ?? horse.sale.askPrice;
  const profitLoss = salePrice - breakEven;
  const categorySpend = Array.from(
    horseReceipts.reduce<Map<ExpenseCategory, number>>((totals, receipt) => {
      totals.set(receipt.category, (totals.get(receipt.category) ?? 0) + receipt.amount);
      return totals;
    }, new Map()),
  )
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount);

  return {
    horseId: horse.id,
    horseName: horse.name,
    costBasis,
    spend,
    breakEven,
    safeSalePrice: Math.ceil((breakEven * 1.15) / 100) * 100,
    salePrice,
    profitLoss,
    marginPercent: salePrice > 0 ? (profitLoss / salePrice) * 100 : 0,
    categorySpend,
  };
}

export function buildOfferDecision(
  horse: HorseRecord,
  receipts: ExpenseReceipt[],
  offerAmount = 0,
  counterOfferAmount = 0,
): OfferDecision {
  const profile = buildHorseProfitProfile(horse, receipts, []);
  const effectiveOffer = Math.max(0, counterOfferAmount || offerAmount);
  const expectedProfit = effectiveOffer - profile.breakEven;
  const marginPercent = effectiveOffer > 0 ? (expectedProfit / effectiveOffer) * 100 : 0;

  if (effectiveOffer <= 0) {
    return {
      status: 'no-offer',
      effectiveOffer,
      breakEven: profile.breakEven,
      safeSalePrice: profile.safeSalePrice,
      expectedProfit,
      marginPercent,
      acceptanceBlocked: true,
      overrideRequired: false,
      label: 'Offer required',
      recommendation: 'Enter the buyer offer or seller counteroffer before accepting the deal.',
    };
  }

  if (profile.breakEven <= 0) {
    return {
      status: 'missing-costs',
      effectiveOffer,
      breakEven: profile.breakEven,
      safeSalePrice: profile.safeSalePrice,
      expectedProfit,
      marginPercent,
      acceptanceBlocked: false,
      overrideRequired: true,
      label: 'Cost proof missing',
      recommendation:
        'Add cost basis or linked expenses before relying on this margin, or explicitly approve the incomplete-cost override.',
    };
  }

  if (effectiveOffer < profile.breakEven) {
    return {
      status: 'loss',
      effectiveOffer,
      breakEven: profile.breakEven,
      safeSalePrice: profile.safeSalePrice,
      expectedProfit,
      marginPercent,
      acceptanceBlocked: true,
      overrideRequired: false,
      label: 'Loss-making offer',
      recommendation: `Counter at $${profile.safeSalePrice.toLocaleString()} or higher. Acceptance is blocked below break-even.`,
    };
  }

  if (effectiveOffer < profile.safeSalePrice) {
    return {
      status: 'thin-margin',
      effectiveOffer,
      breakEven: profile.breakEven,
      safeSalePrice: profile.safeSalePrice,
      expectedProfit,
      marginPercent,
      acceptanceBlocked: false,
      overrideRequired: true,
      label: 'Below protected margin',
      recommendation: `Counter at $${profile.safeSalePrice.toLocaleString()} to preserve the protected margin, or explicitly approve the thinner margin.`,
    };
  }

  return {
    status: 'protected-margin',
    effectiveOffer,
    breakEven: profile.breakEven,
    safeSalePrice: profile.safeSalePrice,
    expectedProfit,
    marginPercent,
    acceptanceBlocked: false,
    overrideRequired: false,
    label: 'Protected margin',
    recommendation: 'The offer clears break-even and the protected sale floor. Prepare the deposit handoff.',
  };
}

export function buildProfitPortfolio(horses: HorseRecord[], receipts: ExpenseReceipt[], leads: SalesLead[]) {
  return horses
    .map((horse) => buildHorseProfitProfile(horse, receipts, leads))
    .sort((left, right) => right.profitLoss - left.profitLoss);
}

// ---------------------------------------------------------------------------
// Ranch-wide financial intelligence.
//
// Everything below is derived deterministically from records the rancher
// already keeps — cost basis, logged expense receipts, and real buyer offers.
// Nothing is invented or projected by a model. The point is to turn "clean
// records" into a money answer: what have I actually made, what is at stake in
// the herd right now, and what one move protects the most margin.
//
// The one distinction the per-horse profile does not make, and this does, is
// REALIZED vs. UNREALIZED. A horse is realized only when a buyer lead for it is
// marked Won — that is money in. Everything else is capital still tied up, valued
// at the live offer (pipeline) or the asking price (held), never counted as
// profit until the deal actually closes.
// ---------------------------------------------------------------------------

export type AnimalFinancialStatus = 'sold' | 'pipeline' | 'held';

export type AnimalFinancialRow = {
  horseId: string;
  horseName: string;
  status: AnimalFinancialStatus;
  /** Capital in the animal: cost basis + linked expenses (its break-even). */
  invested: number;
  /** Realized proceeds (sold), live offer (pipeline), or asking price (held). 0 means unpriced. */
  value: number;
  /** value − invested. Realized for sold animals; projected otherwise. */
  profit: number;
  marginPercent: number;
  /** Held/listed below break-even — selling now would lock in a loss. */
  underwater: boolean;
  /** Price that protects the standard margin over break-even (from the profile). */
  safeSalePrice: number;
  /** No cost basis and no linked expenses — true profit is unknown until costs are entered. */
  costBlindSpot: boolean;
  /** Sold (Won) but no sale amount was recorded — proceeds are unknown, never assumed. */
  saleValueUnknown: boolean;
};

export type FinancialInsightTone = 'win' | 'risk' | 'opportunity' | 'info';

export type FinancialInsight = {
  id: string;
  tone: FinancialInsightTone;
  title: string;
  detail: string;
  horseId?: string;
  amount?: number;
};

export type RanchFinancials = {
  // Realized — money already made on closed (Won) deals with a RECORDED sale amount.
  // A Won deal with no amount is never assumed; it is an integrity gap (see below).
  realizedProceeds: number;
  realizedCost: number;
  /** Gross profit on sold animals: recorded proceeds − their break-even. */
  grossProfitOnSales: number;
  /** Bottom line: gross profit on sales − operating overhead. What's actually banked. */
  netProfit: number;
  realizedMarginPercent: number;
  soldCount: number;

  // Unrealized — capital still working in the herd, valued but not yet banked.
  investedInHerd: number;
  projectedValue: number;
  projectedProfit: number;
  pipelineCount: number;
  heldCount: number;

  // Whole-operation totals.
  totalInvested: number;
  overheadSpend: number;

  // Integrity signals — where the numbers can't yet be trusted.
  underwaterCount: number;
  costBlindSpotCount: number;
  unpricedHeldCount: number;
  /** Sold horses whose sale price was never recorded — excluded from banked profit. */
  soldMissingPriceCount: number;

  perAnimal: AnimalFinancialRow[];
  topCostCategories: { category: ExpenseCategory; amount: number }[];
  insights: FinancialInsight[];
};

function latestByOfferDate(leads: SalesLead[]): SalesLead | undefined {
  return [...leads].sort((left, right) => (right.offerUpdatedAt ?? '').localeCompare(left.offerUpdatedAt ?? ''))[0];
}

const ACTIVE_OFFER_STATUSES = new Set(['Accepted', 'Deposit Due', 'Deposit Paid']);

export function buildRanchFinancials(
  horses: HorseRecord[],
  receipts: ExpenseReceipt[],
  leads: SalesLead[],
): RanchFinancials {
  const rows: AnimalFinancialRow[] = horses.map((horse) => {
    const profile = buildHorseProfitProfile(horse, receipts, []);
    const invested = profile.breakEven;
    const costBlindSpot = profile.costBasis <= 0 && profile.spend <= 0;
    const horseLeads = leads.filter((lead) => lead.horseId === horse.id);

    const wonLead = latestByOfferDate(horseLeads.filter((lead) => lead.outcome === 'Won'));
    if (wonLead) {
      // The recorded deal amount only — NEVER the asking price. A Won deal with no
      // amount means the sale price was never captured, so proceeds are unknown and
      // must not be invented; the horse becomes an integrity gap, not banked revenue.
      const value = wonLead.counterOfferAmount || wonLead.offerAmount || 0;
      const saleValueUnknown = value <= 0;
      const profit = saleValueUnknown ? 0 : value - invested;
      return {
        horseId: horse.id,
        horseName: horse.name,
        status: 'sold',
        invested,
        value,
        profit,
        marginPercent: value > 0 ? (profit / value) * 100 : 0,
        underwater: false,
        safeSalePrice: profile.safeSalePrice,
        costBlindSpot,
        saleValueUnknown,
      };
    }

    const activeLead = latestByOfferDate(
      horseLeads.filter(
        (lead) =>
          lead.outcome !== 'Lost' &&
          (ACTIVE_OFFER_STATUSES.has(lead.offerStatus ?? '') ||
            (lead.stage === 'Offer' && (lead.offerAmount ?? 0) > 0)),
      ),
    );
    const liveOffer = activeLead ? activeLead.counterOfferAmount || activeLead.offerAmount || 0 : 0;
    const isPipeline = liveOffer > 0;
    const value = isPipeline ? liveOffer : Math.max(0, horse.sale.askPrice || 0);
    const profit = value - invested;

    return {
      horseId: horse.id,
      horseName: horse.name,
      status: isPipeline ? 'pipeline' : 'held',
      invested,
      value,
      profit,
      marginPercent: value > 0 ? (profit / value) * 100 : 0,
      underwater: value > 0 && value < invested,
      safeSalePrice: profile.safeSalePrice,
      costBlindSpot,
      saleValueUnknown: false,
    };
  });

  const sold = rows.filter((row) => row.status === 'sold');
  // Only sales with a recorded amount contribute to banked profit; the rest are
  // integrity gaps, not revenue.
  const soldPriced = sold.filter((row) => !row.saleValueUnknown);
  const pipeline = rows.filter((row) => row.status === 'pipeline');
  const held = rows.filter((row) => row.status === 'held');
  const unrealized = [...pipeline, ...held];

  const realizedProceeds = soldPriced.reduce((sum, row) => sum + row.value, 0);
  const realizedCost = soldPriced.reduce((sum, row) => sum + row.invested, 0);
  const grossProfitOnSales = realizedProceeds - realizedCost;

  const investedInHerd = unrealized.reduce((sum, row) => sum + row.invested, 0);
  const projectedValue = unrealized.reduce((sum, row) => sum + row.value, 0);
  // Only count animals that actually carry a price toward projected profit.
  const projectedProfit = unrealized.filter((row) => row.value > 0).reduce((sum, row) => sum + row.profit, 0);

  // Receipts not linked to any current horse are operating overhead, not part of
  // any single animal's break-even.
  const horseIds = new Set(horses.map((horse) => horse.id));
  const overheadSpend = receipts
    .filter((receipt) => !receipt.horseId || !horseIds.has(receipt.horseId))
    .reduce((sum, receipt) => sum + receipt.amount, 0);
  const totalInvested = rows.reduce((sum, row) => sum + row.invested, 0) + overheadSpend;

  // The bottom line: gross profit on sold animals, less operating overhead. This is
  // what the operation actually banked — a real P&L nets overhead out.
  const netProfit = grossProfitOnSales - overheadSpend;

  const categoryTotals = receipts.reduce<Map<ExpenseCategory, number>>((totals, receipt) => {
    totals.set(receipt.category, (totals.get(receipt.category) ?? 0) + receipt.amount);
    return totals;
  }, new Map());
  const topCostCategories = [...categoryTotals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount);

  const underwaterCount = rows.filter((row) => row.underwater).length;
  const costBlindSpotCount = rows.filter((row) => row.costBlindSpot).length;
  const unpricedHeldCount = held.filter((row) => row.value <= 0).length;
  const soldMissingPriceCount = sold.length - soldPriced.length;

  return {
    realizedProceeds,
    realizedCost,
    grossProfitOnSales,
    netProfit,
    realizedMarginPercent: realizedProceeds > 0 ? (grossProfitOnSales / realizedProceeds) * 100 : 0,
    soldCount: sold.length,
    investedInHerd,
    projectedValue,
    projectedProfit,
    pipelineCount: pipeline.length,
    heldCount: held.length,
    totalInvested,
    overheadSpend,
    underwaterCount,
    costBlindSpotCount,
    unpricedHeldCount,
    soldMissingPriceCount,
    perAnimal: sortAnimalRows(rows),
    topCostCategories,
    insights: buildFinancialInsights(soldPriced, held, topCostCategories, {
      costBlindSpotCount,
      unpricedHeldCount,
      soldMissingPriceCount,
      overheadSpend,
    }),
  };
}

// Sold first (by realized profit), then active pipeline, then held — the order a
// rancher reads them: what closed, what's in play, what's still sitting.
function sortAnimalRows(rows: AnimalFinancialRow[]): AnimalFinancialRow[] {
  const rank: Record<AnimalFinancialStatus, number> = { sold: 0, pipeline: 1, held: 2 };
  return [...rows].sort((left, right) => rank[left.status] - rank[right.status] || right.profit - left.profit);
}

function buildFinancialInsights(
  soldPriced: AnimalFinancialRow[],
  held: AnimalFinancialRow[],
  topCostCategories: { category: ExpenseCategory; amount: number }[],
  integrity: {
    costBlindSpotCount: number;
    unpricedHeldCount: number;
    soldMissingPriceCount: number;
    overheadSpend: number;
  },
): FinancialInsight[] {
  const insights: FinancialInsight[] = [];
  const money = (value: number) => `$${Math.round(value).toLocaleString()}`;

  const bestSale = [...soldPriced].sort((left, right) => right.profit - left.profit)[0];
  if (bestSale && bestSale.profit > 0) {
    insights.push({
      id: `win-${bestSale.horseId}`,
      tone: 'win',
      title: `${bestSale.horseName} was your best sale`,
      detail: `Sold for ${money(bestSale.value)} — ${money(bestSale.profit)} profit at ${bestSale.marginPercent.toFixed(0)}% margin.`,
      horseId: bestSale.horseId,
      amount: bestSale.profit,
    });
  }

  const worstSale = [...soldPriced].sort((left, right) => left.profit - right.profit)[0];
  if (worstSale && worstSale.profit < 0) {
    insights.push({
      id: `loss-${worstSale.horseId}`,
      tone: 'risk',
      title: `${worstSale.horseName} sold below break-even`,
      detail: `Proceeds of ${money(worstSale.value)} came in ${money(-worstSale.profit)} under the ${money(worstSale.invested)} it cost to get there.`,
      horseId: worstSale.horseId,
      amount: worstSale.profit,
    });
  }

  const underwater = held.filter((row) => row.underwater).sort((left, right) => left.profit - right.profit)[0];
  if (underwater) {
    insights.push({
      id: `underwater-${underwater.horseId}`,
      tone: 'risk',
      title: `${underwater.horseName} is priced to lose money`,
      detail: `Listed at ${money(underwater.value)} — ${money(underwater.invested - underwater.value)} below break-even. Raise the ask to ${money(underwater.safeSalePrice)} to protect your margin.`,
      horseId: underwater.horseId,
      amount: underwater.profit,
    });
  }

  const bestOpportunity = held
    .filter((row) => row.value > 0 && row.profit > 0)
    .sort((left, right) => right.profit - left.profit)[0];
  if (bestOpportunity) {
    insights.push({
      id: `opportunity-${bestOpportunity.horseId}`,
      tone: 'opportunity',
      title: `${bestOpportunity.horseName} is your biggest upside`,
      detail: `Clears ${money(bestOpportunity.profit)} profit at the current ${money(bestOpportunity.value)} ask. Move it to keep the margin.`,
      horseId: bestOpportunity.horseId,
      amount: bestOpportunity.profit,
    });
  }

  const topCost = topCostCategories[0];
  if (topCost && topCost.amount > 0) {
    insights.push({
      id: `cost-${topCost.category}`,
      tone: 'info',
      title: `${topCost.category} is your biggest cost`,
      detail: `${money(topCost.amount)} across the herd. Trimming it lifts the margin on every animal you sell.`,
      amount: topCost.amount,
    });
  }

  // Overhead can turn a positive gross into a negative bottom line — surface it so
  // "am I actually making money?" is answered honestly, not just per-sale.
  const grossFromSales = soldPriced.reduce((sum, row) => sum + row.profit, 0);
  if (integrity.overheadSpend > 0 && grossFromSales > 0 && grossFromSales - integrity.overheadSpend < 0) {
    insights.push({
      id: 'overhead-drag',
      tone: 'risk',
      title: 'Overhead is outrunning your sales profit',
      detail: `${money(grossFromSales)} gross on sold horses, but ${money(integrity.overheadSpend)} of operating overhead puts the operation ${money(integrity.overheadSpend - grossFromSales)} in the red. Sell more margin or cut overhead.`,
      amount: grossFromSales - integrity.overheadSpend,
    });
  }

  if (integrity.soldMissingPriceCount > 0) {
    const n = integrity.soldMissingPriceCount;
    insights.push({
      id: 'blindspot-sale-price',
      tone: 'info',
      title: `${n} sold ${n === 1 ? 'horse has' : 'horses have'} no recorded sale price`,
      detail: `Record what ${n === 1 ? 'it' : 'they'} sold for so your banked profit is accurate — until then ${n === 1 ? "it's" : "they're"} left out of the total.`,
    });
  }

  if (integrity.costBlindSpotCount > 0) {
    const n = integrity.costBlindSpotCount;
    insights.push({
      id: 'blindspot-cost',
      tone: 'info',
      title: `${n} ${n === 1 ? 'horse has' : 'horses have'} no recorded cost`,
      detail: `Add a cost basis or log expenses so XBAR can show ${n === 1 ? 'its' : 'their'} real profit instead of guessing.`,
    });
  }

  if (integrity.unpricedHeldCount > 0) {
    const n = integrity.unpricedHeldCount;
    insights.push({
      id: 'blindspot-price',
      tone: 'opportunity',
      title: `${n} held ${n === 1 ? 'horse has' : 'horses have'} no asking price`,
      detail: `Set a price to see the projected profit and put ${n === 1 ? 'it' : 'them'} to work in your pipeline.`,
    });
  }

  const tonePriority: Record<FinancialInsightTone, number> = { risk: 0, win: 1, opportunity: 2, info: 3 };
  return insights.sort(
    (left, right) => tonePriority[left.tone] - tonePriority[right.tone] || (right.amount ?? 0) - (left.amount ?? 0),
  );
}

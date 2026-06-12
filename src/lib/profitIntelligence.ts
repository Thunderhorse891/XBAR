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
    .filter((lead) => lead.horseId === horse.id && ['Accepted', 'Deposit Due', 'Deposit Paid'].includes(lead.offerStatus ?? ''))
    .sort((left, right) => (right.offerUpdatedAt ?? '').localeCompare(left.offerUpdatedAt ?? ''))[0];
  const salePrice = acceptedOffer?.counterOfferAmount ?? acceptedOffer?.offerAmount ?? horse.sale.askPrice;
  const profitLoss = salePrice - breakEven;
  const categorySpend = Array.from(horseReceipts.reduce<Map<ExpenseCategory, number>>((totals, receipt) => {
    totals.set(receipt.category, (totals.get(receipt.category) ?? 0) + receipt.amount);
    return totals;
  }, new Map())).map(([category, amount]) => ({ category, amount })).sort((left, right) => right.amount - left.amount);

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
      recommendation: 'Add cost basis or linked expenses before relying on this margin, or explicitly approve the incomplete-cost override.',
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
  return horses.map((horse) => buildHorseProfitProfile(horse, receipts, leads)).sort((left, right) => right.profitLoss - left.profitLoss);
}

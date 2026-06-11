import type { ExpenseCategory, ExpenseReceipt, HorseRecord, SalesLead } from '../types/xbar.js';

export type HorseProfitProfile = {
  horseId: string;
  horseName: string;
  costBasis: number;
  spend: number;
  breakEven: number;
  safeSalePrice: number;
  salePrice: number;
  profitLoss: number;
  marginPercent: number;
  categorySpend: Array<{ category: ExpenseCategory; amount: number }>;
};

export function buildHorseProfitProfile(horse: HorseRecord, receipts: ExpenseReceipt[], leads: SalesLead[]): HorseProfitProfile {
  const horseReceipts = receipts.filter((receipt) => receipt.horseId === horse.id);
  const spend = horseReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const costBasis = Math.max(0, horse.costBasis ?? 0);
  const breakEven = costBasis + spend;
  const acceptedOffer = leads
    .filter((lead) => lead.horseId === horse.id && (lead.offerStatus === 'Accepted' || lead.offerStatus === 'Deposit Due' || lead.offerStatus === 'Deposit Paid'))
    .sort((left, right) => (right.offerUpdatedAt ?? '').localeCompare(left.offerUpdatedAt ?? ''))[0];
  const salePrice = acceptedOffer?.counterOfferAmount ?? acceptedOffer?.offerAmount ?? horse.sale.askPrice;
  const profitLoss = salePrice - breakEven;
  const marginPercent = salePrice > 0 ? (profitLoss / salePrice) * 100 : 0;
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
    marginPercent,
    categorySpend,
  };
}

export function buildProfitPortfolio(horses: HorseRecord[], receipts: ExpenseReceipt[], leads: SalesLead[]) {
  return horses.map((horse) => buildHorseProfitProfile(horse, receipts, leads)).sort((left, right) => right.profitLoss - left.profitLoss);
}

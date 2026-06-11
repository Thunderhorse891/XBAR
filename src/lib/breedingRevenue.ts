import type { BreedingEconomics, ExpenseReceipt, HorseRecord } from '../types/xbar.js';

export const emptyBreedingEconomics: BreedingEconomics = {
  studFee: 0,
  bookedMares: 0,
  breedingCosts: 0,
  mareProductionValue: 0,
  foalProjectedValue: 0,
};

export function buildBreedingRevenueProfile(horse: HorseRecord, receipts: ExpenseReceipt[]) {
  const economics = { ...emptyBreedingEconomics, ...horse.breedingEconomics };
  const linkedCosts = receipts.filter((receipt) => receipt.horseId === horse.id).reduce((sum, receipt) => sum + receipt.amount, 0);
  const totalCosts = economics.breedingCosts + linkedCosts;
  const stallionRevenue = horse.segment === 'Stud' ? economics.studFee * economics.bookedMares : 0;
  const projectedValue = stallionRevenue + economics.mareProductionValue + economics.foalProjectedValue;
  const roi = totalCosts > 0 ? ((projectedValue - totalCosts) / totalCosts) * 100 : 0;
  return { economics, linkedCosts, totalCosts, stallionRevenue, projectedValue, roi };
}

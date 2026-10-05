export type UpgradeFeature =
  | 'buyerDealRoom'
  | 'packetExport'
  | 'teamInvites'
  | 'profitIntelligence'
  | 'breedingRevenue'
  | 'ranchOps'
  | 'reportPresentation'
  | 'reportWhiteLabel';
export const UPGRADE_FEATURES: Readonly<
  Record<UpgradeFeature, { tier: 'Professional' | 'Ranch Ops' | 'Enterprise'; label: string; detail: string }>
>;

/** Shared by the offer API and browser. Existing capabilities keep their tiers. */
export const UPGRADE_FEATURES = Object.freeze({
  buyerDealRoom: {
    tier: 'Professional',
    label: 'Buyer follow-up',
    detail: 'Keep buyer conversations and shared records connected to each horse.',
  },
  packetExport: {
    tier: 'Professional',
    label: 'Branded sale packets',
    detail: 'Prepare buyer-ready records with your ranch identity and verifiable document history.',
  },
  teamInvites: {
    tier: 'Professional',
    label: 'Team invitations',
    detail: 'Bring your team into the same working record with role-based access.',
  },
  profitIntelligence: {
    tier: 'Ranch Ops',
    label: 'Executive ranch reports',
    detail: 'See horse economics, sale readiness, cost trends and action priorities in a printable report.',
  },
  breedingRevenue: {
    tier: 'Ranch Ops',
    label: 'Breeding revenue workflows',
    detail: 'Keep breeding revenue and operating costs together.',
  },
  ranchOps: {
    tier: 'Ranch Ops',
    label: 'Ranch operations',
    detail: 'Coordinate the records, people and costs behind the operation.',
  },
  reportPresentation: {
    tier: 'Ranch Ops',
    label: 'Report presentation studio',
    detail: 'Choose report accents and an executive cover without changing your underlying figures.',
  },
  reportWhiteLabel: {
    tier: 'Enterprise',
    label: 'Ranch-first report styling',
    detail: 'Remove decorative platform artwork while retaining source attribution and verification identity.',
  },
});

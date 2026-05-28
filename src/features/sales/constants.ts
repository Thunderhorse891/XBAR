export const LEAD_STAGES = ['New', 'Qualified', 'Offer', 'Closed'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_OUTCOMES = ['Won', 'Lost'] as const;
export type LeadOutcome = (typeof LEAD_OUTCOMES)[number];

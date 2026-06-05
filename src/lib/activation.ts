export type ActivationInput = { horses: number; documents: number; receipts: number; members: number; invitations: number; sharedListings: number; monthlyRate: number; billingState: string };
export type ActivationStep = { id: string; title: string; description: string; action: string; path: string; complete: boolean; value: string };

export function buildActivationSteps(input: ActivationInput): ActivationStep[] {
  const teamCount = input.members + input.invitations;
  const planActive = input.monthlyRate > 0 && !/manual/i.test(input.billingState);
  return [
    { id: 'horse', title: 'Create the first horse record', description: 'Give the command center a real horse to organize around.', action: 'Add horse', path: '/horses?new=1', complete: input.horses > 0, value: `${input.horses} horse${input.horses === 1 ? '' : 's'}` },
    { id: 'documents', title: 'Secure the first source document', description: 'Upload registration, Coggins, health, or ownership proof.', action: 'Upload document', path: '/documents?upload=1', complete: input.documents > 0, value: `${input.documents} document${input.documents === 1 ? '' : 's'}` },
    { id: 'receipt', title: 'Start the operating ledger', description: 'Log one real receipt so spend begins telling a useful story.', action: 'Log receipt', path: '/expenses', complete: input.receipts > 0, value: `${input.receipts} receipt${input.receipts === 1 ? '' : 's'}` },
    { id: 'team', title: 'Connect the operating team', description: 'Invite a teammate or prepare a protected sale listing.', action: 'Open team settings', path: '/settings', complete: teamCount > 0 || input.sharedListings > 0, value: teamCount > 0 ? `${teamCount} team access` : `${input.sharedListings} listing${input.sharedListings === 1 ? '' : 's'}` },
    { id: 'plan', title: 'Confirm the operating plan', description: 'Choose the capacity that fits the ranch before limits become blockers.', action: 'Review plans', path: '/subscriptions', complete: planActive, value: planActive ? 'Plan active' : 'Plan not confirmed' },
  ];
}

export function summarizeActivation(input: ActivationInput) {
  const steps = buildActivationSteps(input); const completed = steps.filter((step) => step.complete).length;
  return { steps, completed, total: steps.length, percent: Math.round((completed / steps.length) * 100), next: steps.find((step) => !step.complete), complete: completed === steps.length };
}

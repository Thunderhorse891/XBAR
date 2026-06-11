export type ActivationInput = { horses: number; documents: number; receipts: number; members: number; invitations: number; sharedListings: number; monthlyRate: number; billingState: string };
export type ActivationStep = { id: string; title: string; description: string; action: string; path: string; complete: boolean; value: string };

export function buildActivationSteps(input: ActivationInput): ActivationStep[] {
  const teamCount = input.members + input.invitations;
  const planActive = input.monthlyRate > 0 && !/manual/i.test(input.billingState);
  return [
    { id: 'horse', title: 'Anchor the first horse', description: 'Create the horse record the rest of the operation can organize around.', action: 'Add horse', path: '/horses?new=1', complete: input.horses > 0, value: `${input.horses} horse${input.horses === 1 ? '' : 's'} anchored` },
    { id: 'documents', title: 'Attach the first proof record', description: 'Connect registration, Coggins, health, or ownership proof to the operation.', action: 'Upload proof', path: '/documents?upload=1', complete: input.documents > 0, value: `${input.documents} source document${input.documents === 1 ? '' : 's'}` },
    { id: 'receipt', title: 'Capture one real operating cost', description: 'Add a receipt so the record begins connecting decisions to spend.', action: 'Log a cost', path: '/expenses', complete: input.receipts > 0, value: `${input.receipts} cost record${input.receipts === 1 ? '' : 's'}` },
    { id: 'team', title: 'Put a workflow in motion', description: 'Invite a teammate or prepare a controlled listing for a real next step.', action: 'Open access controls', path: '/settings', complete: teamCount > 0 || input.sharedListings > 0, value: teamCount > 0 ? `${teamCount} team access` : `${input.sharedListings} controlled listing${input.sharedListings === 1 ? '' : 's'}` },
    { id: 'plan', title: 'Confirm operating capacity', description: 'Choose the plan that protects the workflow before capacity becomes a blocker.', action: 'Review capacity', path: '/subscriptions', complete: planActive, value: planActive ? 'Operating plan active' : 'Capacity not confirmed' },
  ];
}

export function summarizeActivation(input: ActivationInput) {
  const steps = buildActivationSteps(input);
  const completed = steps.filter((step) => step.complete).length;
  const firstValueAchieved = input.horses > 0 && input.documents > 0;
  return {
    steps,
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    next: steps.find((step) => !step.complete),
    complete: completed === steps.length,
    firstValueAchieved,
    valueStatement: firstValueAchieved
      ? 'A horse and its first source record now live in the same command system.'
      : 'The first useful outcome arrives when one horse and one source document are connected.',
  };
}

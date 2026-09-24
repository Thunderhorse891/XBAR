import { billingPath } from './billingRoutes.js';

export type ActivationInput = {
  horses: number;
  documents: number;
  receipts: number;
  members: number;
  invitations: number;
  sharedListings: number;
  monthlyRate: number;
  billingState: string;
};
export type ActivationStep = {
  id: string;
  title: string;
  description: string;
  action: string;
  path: string;
  complete: boolean;
  value: string;
};

export function buildActivationSteps(input: ActivationInput): ActivationStep[] {
  const teamCount = input.members + input.invitations;
  // Entitled states only. The previous test was "not manual", which counted
  // 'Inactive' (canceled, paused, never paid) as an active plan.
  const planActive = input.billingState === 'Active';
  return [
    {
      id: 'horse',
      title: 'Add the first horse',
      description: 'Start a record for one of your horses.',
      action: 'Add Horse',
      path: '/horses?new=1',
      complete: input.horses > 0,
      value: `${input.horses} horse${input.horses === 1 ? '' : 's'} added`,
    },
    {
      id: 'documents',
      title: 'Attach the first document',
      description: 'Keep registration, Coggins, care, or ownership papers with your horse.',
      action: 'Upload Documents',
      path: '/documents?upload=1',
      complete: input.documents > 0,
      value: `${input.documents} source document${input.documents === 1 ? '' : 's'}`,
    },
    {
      id: 'receipt',
      title: 'Add your first expense',
      description: 'Save a receipt to start tracking what you spend.',
      action: 'Log a cost',
      path: '/expenses',
      complete: input.receipts > 0,
      value: `${input.receipts} cost record${input.receipts === 1 ? '' : 's'}`,
    },
    {
      id: 'team',
      title: 'Invite your team or share a listing',
      description: 'Invite someone to help, or choose what a buyer can see.',
      action: 'Manage sharing',
      path: '/settings',
      complete: teamCount > 0 || input.sharedListings > 0,
      value:
        teamCount > 0
          ? `${teamCount} team access`
          : `${input.sharedListings} controlled listing${input.sharedListings === 1 ? '' : 's'}`,
    },
    {
      id: 'plan',
      title: 'Check your plan',
      description: 'Check that your plan has room for your horses and records.',
      action: 'Review billing',
      path: billingPath,
      complete: planActive,
      value: planActive ? 'Paid billing active' : 'Billing not confirmed',
    },
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
      ? 'Your first horse and its papers are together.'
      : 'Add a horse, then attach its first paper.',
  };
}

export type OperationalValuePulseTone = 'clear' | 'watch' | 'risk';
export type OperationalValueSignalState = 'positive' | 'neutral' | 'risk';

export type OperationalValuePulseInput = {
  horseCount: number;
  linkedDocumentHorseCount: number;
  reviewQueueCount: number;
  transferGapCount: number;
  careDueCount: number;
  currentMonthReceiptCount: number;
  activeLeadCount: number;
};

export type OperationalValueSignal = {
  label: string;
  value: string;
  detail: string;
  state: OperationalValueSignalState;
  path: string;
};

export type OperationalValuePulse = {
  score: number;
  tone: OperationalValuePulseTone;
  headline: string;
  summary: string;
  signals: OperationalValueSignal[];
  nextAction: {
    label: string;
    detail: string;
    path: string;
  };
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function issueScore(count: number, maximum: number, penalty: number) {
  return clamp(maximum - count * penalty, 0, maximum);
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

export function buildOperationalValuePulse(input: OperationalValuePulseInput): OperationalValuePulse {
  if (!input.horseCount) {
    return {
      score: 0,
      tone: 'risk',
      headline: 'Add the first horse record.',
      summary: 'Start with one horse and its first paper.',
      signals: [],
      nextAction: {
        label: 'Create the first horse',
        detail: 'Keep papers, care, ownership, and buyer details together for each horse.',
        path: '/horses?new=1',
      },
    };
  }

  const linkedHorseCount = clamp(input.linkedDocumentHorseCount, 0, input.horseCount);
  const coveragePercent = Math.round((linkedHorseCount / input.horseCount) * 100);
  const coverageScore = Math.round((coveragePercent / 100) * 30);
  const score = clamp(
    coverageScore +
      issueScore(input.reviewQueueCount, 15, 3) +
      issueScore(input.transferGapCount, 20, 4) +
      issueScore(input.careDueCount, 20, 4) +
      (input.currentMonthReceiptCount > 0 ? 10 : 0) +
      (input.activeLeadCount > 0 ? 5 : 0),
    0,
    100,
  );
  const tone: OperationalValuePulseTone = score >= 80 ? 'clear' : score >= 55 ? 'watch' : 'risk';

  const signals: OperationalValueSignal[] = [
    {
      label: 'Horses with papers',
      value: `${coveragePercent}%`,
      detail: `${linkedHorseCount} of ${input.horseCount} horses have a paper attached`,
      state: coveragePercent === 100 ? 'positive' : coveragePercent >= 60 ? 'neutral' : 'risk',
      path: '/documents',
    },
    {
      label: 'Ownership papers',
      value: input.transferGapCount ? plural(input.transferGapCount, 'gap') : 'Clear',
      detail: input.transferGapCount
        ? 'Ownership or transfer papers need attention'
        : 'No ownership or transfer gaps detected',
      state: input.transferGapCount ? 'risk' : 'positive',
      path: '/ownership',
    },
    {
      label: 'Care due',
      value: input.careDueCount ? plural(input.careDueCount, 'horse') : 'Current',
      detail: input.careDueCount ? 'At least one tracked care item is due' : 'Tracked care items are current',
      state: input.careDueCount ? 'risk' : 'positive',
      path: '/medical',
    },
    {
      label: 'Papers to review',
      value: input.reviewQueueCount ? plural(input.reviewQueueCount, 'review') : 'None waiting',
      detail: input.currentMonthReceiptCount
        ? `${plural(input.currentMonthReceiptCount, 'receipt')} logged this month`
        : 'No expense receipts logged this month',
      state: input.reviewQueueCount ? 'neutral' : input.currentMonthReceiptCount ? 'positive' : 'neutral',
      path: input.reviewQueueCount ? '/documents' : '/expenses',
    },
  ];

  let nextAction = {
    label: 'Open horse records',
    detail: 'Check horse records, papers, care, and ownership.',
    path: '/horses',
  };

  if (coveragePercent < 100) {
    nextAction = {
      label: 'Add missing papers',
      detail: `${input.horseCount - linkedHorseCount} horse${input.horseCount - linkedHorseCount === 1 ? '' : 's'} still need a paper attached.`,
      path: '/documents?upload=1',
    };
  } else if (input.transferGapCount > 0) {
    nextAction = {
      label: 'Finish ownership papers',
      detail: `${plural(input.transferGapCount, 'record')} need ownership or transfer papers.`,
      path: '/ownership',
    };
  } else if (input.careDueCount > 0) {
    nextAction = {
      label: 'Catch up on care',
      detail: `${plural(input.careDueCount, 'horse')} have tracked care items due.`,
      path: '/medical',
    };
  } else if (input.reviewQueueCount > 0) {
    nextAction = {
      label: 'Review waiting papers',
      detail: `${plural(input.reviewQueueCount, 'document')} are waiting for someone to check them.`,
      path: '/documents',
    };
  } else if (!input.currentMonthReceiptCount) {
    nextAction = {
      label: 'Add this month’s expenses',
      detail: 'Add a receipt to start tracking what you spend this month.',
      path: '/expenses',
    };
  } else if (!input.activeLeadCount) {
    nextAction = {
      label: 'Check buyers and offers',
      detail: 'Create or review buyer activity when a horse is ready for market.',
      path: '/sales',
    };
  }

  const headline =
    tone === 'clear'
      ? 'Your record keeping is on track.'
      : tone === 'watch'
        ? 'Your records are taking shape.'
        : 'Your ranch records need attention.';
  const summary =
    tone === 'clear'
      ? 'Check the details below for any remaining papers, care, or ownership tasks.'
      : tone === 'watch'
        ? 'Some records still need attention. Start with the next step below.'
        : 'Fill the largest gaps first so your home page can show what needs attention.';

  return { score, tone, headline, summary, signals, nextAction };
}

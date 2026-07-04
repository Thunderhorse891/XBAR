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
      summary: 'XBAR becomes useful once the first horse and source document are connected.',
      signals: [],
      nextAction: {
        label: 'Create the first horse',
        detail: 'Start the operating record that documents, care, ownership, and buyer activity connect to.',
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
      label: 'Source coverage',
      value: `${coveragePercent}%`,
      detail: `${linkedHorseCount} of ${input.horseCount} horses have a linked source document`,
      state: coveragePercent === 100 ? 'positive' : coveragePercent >= 60 ? 'neutral' : 'risk',
      path: '/documents',
    },
    {
      label: 'Transfer control',
      value: input.transferGapCount ? plural(input.transferGapCount, 'gap') : 'Clear',
      detail: input.transferGapCount ? 'Ownership or transfer support needs resolution' : 'No ownership or transfer gaps detected',
      state: input.transferGapCount ? 'risk' : 'positive',
      path: '/ownership',
    },
    {
      label: 'Care control',
      value: input.careDueCount ? plural(input.careDueCount, 'horse') : 'Current',
      detail: input.careDueCount ? 'At least one tracked care item is due' : 'Tracked care items are current',
      state: input.careDueCount ? 'risk' : 'positive',
      path: '/medical',
    },
    {
      label: 'Decision records',
      value: input.reviewQueueCount ? plural(input.reviewQueueCount, 'review') : 'Queue clear',
      detail: input.currentMonthReceiptCount
        ? `${plural(input.currentMonthReceiptCount, 'receipt')} logged this month`
        : 'No expense receipts logged this month',
      state: input.reviewQueueCount ? 'neutral' : input.currentMonthReceiptCount ? 'positive' : 'neutral',
      path: input.reviewQueueCount ? '/documents' : '/expenses',
    },
  ];

  let nextAction = {
    label: 'Open horse records',
    detail: 'Review the operation from horse records, source documents, care, and ownership.',
    path: '/horses',
  };

  if (coveragePercent < 100) {
    nextAction = {
      label: 'Complete source coverage',
      detail: `${input.horseCount - linkedHorseCount} horse${input.horseCount - linkedHorseCount === 1 ? '' : 's'} still need a linked source document.`,
      path: '/documents?upload=1',
    };
  } else if (input.transferGapCount > 0) {
    nextAction = {
      label: 'Resolve transfer gaps',
      detail: `${plural(input.transferGapCount, 'record')} need ownership or transfer support.`,
      path: '/ownership',
    };
  } else if (input.careDueCount > 0) {
    nextAction = {
      label: 'Bring care current',
      detail: `${plural(input.careDueCount, 'horse')} have tracked care items due.`,
      path: '/medical',
    };
  } else if (input.reviewQueueCount > 0) {
    nextAction = {
      label: 'Clear document review',
      detail: `${plural(input.reviewQueueCount, 'document')} are waiting for a team decision.`,
      path: '/documents',
    };
  } else if (!input.currentMonthReceiptCount) {
    nextAction = {
      label: 'Start this month’s ledger',
      detail: 'Log a receipt so current operating spend is visible beside care and ownership work.',
      path: '/expenses',
    };
  } else if (!input.activeLeadCount) {
    nextAction = {
      label: 'Open buyer operations',
      detail: 'Create or review buyer activity when a horse is ready for market.',
      path: '/sales',
    };
  }

  const headline =
    tone === 'clear'
      ? 'The operation is under control.'
      : tone === 'watch'
        ? 'XBAR is carrying useful operating context.'
        : 'The workspace needs attention.';
  const summary =
    tone === 'clear'
      ? 'Core records are connected and the highest-risk operating queues are clear.'
      : tone === 'watch'
        ? 'The operating record is working, with a small number of gaps limiting confidence.'
        : 'Resolve the largest record gaps first so the dashboard can become a dependable operating brief.';

  return { score, tone, headline, summary, signals, nextAction };
}

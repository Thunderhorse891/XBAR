import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMareBreedingState, buildBreedingProgram } from '../src/lib/breedingIntelligence.js';
import type { HorseRecord, TimelineEvent } from '../src/types/xbar.js';

const now = new Date('2026-10-09T12:00:00Z');
function event(daysAgo: number, title: string, summary = '', details?: object, state?: string): TimelineEvent {
  return {
    id: `${daysAgo}-${title}-${summary}`,
    date: new Date(now.getTime() - daysAgo * 86400000).toISOString().slice(0, 10),
    title,
    summary,
    category: 'Breeding',
    owner: 'Owner',
    details,
    completionState: state,
  } as TimelineEvent;
}
function mare(events: TimelineEvent[]): HorseRecord {
  return {
    id: 'mare',
    name: 'Glory',
    sex: 'Mare',
    breedingTimeline: events,
    breedingEconomics: { foalProjectedValue: 20000, breedingCosts: 3000 },
  } as HorseRecord;
}
const cover = () => event(320, 'Bred to Thunder', '', { recordType: 'breeding' });
const check = (days: number, result: string) =>
  event(days, 'Pregnancy check', '', { recordType: 'pregnancy-check', result });

test('RP03: foaling prep is not a recorded birth', () => {
  const state = buildMareBreedingState(mare([event(1, 'Foaling prep', 'Buy foaling kit'), cover()]), now);
  assert.equal(state.status, 'bred-awaiting-check');
  assert.doesNotMatch(state.actionLabel, /register|rebreed/i);
});
test('RP03: a future planned foaling is not completed evidence', () => {
  const state = buildMareBreedingState(
    mare([event(-10, 'Foaling', 'planned live birth', { recordType: 'foaling', result: 'live' }, 'planned'), cover()]),
    now,
  );
  assert.equal(state.status, 'bred-awaiting-check');
});
test('RP03: elapsed 320 days cannot confirm or value a pregnancy', () => {
  const program = buildBreedingProgram([mare([cover()])], now);
  assert.equal(program.mares[0]!.status, 'bred-awaiting-check');
  assert.equal(program.inFoal, 0);
  assert.equal(program.projectedProgramValue, 0);
});
test('RP03: a later positive supersedes an earlier negative', () => {
  const state = buildMareBreedingState(mare([check(290, 'in-foal'), check(305, 'open'), cover()]), now);
  assert.equal(state.status, 'near-term');
});
test('RP03: future and cancelled positive checks cannot confirm pregnancy', () => {
  for (const checkEvent of [check(-1, 'in-foal'), { ...check(5, 'in-foal'), status: 'Cancelled' }]) {
    assert.equal(buildMareBreedingState(mare([checkEvent, cover()]), now).status, 'bred-awaiting-check');
  }
});
test('RP03: conflicting checks on the same day stay uncertain in either array order', () => {
  for (const checks of [
    [check(290, 'in-foal'), check(290, 'open')],
    [check(290, 'open'), check(290, 'in-foal')],
  ]) {
    assert.equal(buildMareBreedingState(mare([...checks, cover()]), now).status, 'bred-awaiting-check');
  }
});
test('RP03: contradictory heartbeat prose is not positive evidence', () => {
  const state = buildMareBreedingState(
    mare([event(20, 'Pregnancy check', 'Confirmed positive, no heartbeat detected'), cover()]),
    now,
  );
  assert.equal(state.status, 'bred-awaiting-check');
});
test('RP03: an actual birth without an earlier cover is still recorded', () => {
  assert.equal(
    buildMareBreedingState(mare([event(2, 'Foaled a live filly', '', { recordType: 'foaling', result: 'live' })]), now)
      .status,
    'foaled-live',
  );
});
test('RP04: a breeding without a guarantee is never covered', () => {
  assert.equal(buildMareBreedingState(mare([cover()]), now).guarantee, 'not-recorded');
});
test('RP04: a recorded loss without a contract creates no rebreed obligation', () => {
  const state = buildMareBreedingState(
    mare([event(2, 'Foaling loss', '', { recordType: 'foaling', result: 'loss' }), cover()]),
    now,
  );
  assert.equal(state.guarantee, 'not-recorded');
  assert.doesNotMatch(state.actionLabel, /rebreed/i);
});

for (const [title, summary] of [
  ['Foaling prep', 'Buy foaling kit'],
  ['Foaling', 'Planned for next week'],
  ['Foaling appointment', 'Scheduled'],
  ['Foaling cancelled', 'No birth recorded'],
  ['Stud booking', 'Booked to breed next month'],
  ['Semen delivered', 'AI supplies received'],
  ['Foaling note', 'Has not foaled yet'],
  ['Breed planning', 'Order AI shipment'],
  ['Not bred yet', 'No cover occurred'],
  ['Will be bred next week', 'Future cover'],
]) {
  test(`RP03: ${title} cannot terminate or restart an established pregnancy`, () => {
    const program = buildBreedingProgram([mare([event(1, title, summary), check(290, 'in-foal'), cover()])], now);
    assert.equal(program.mares[0]!.status, 'near-term');
    assert.equal(program.inFoal, 1);
    assert.equal(program.projectedProgramValue, 20000);
  });
}

for (const completionState of ['planned', 'cancelled']) {
  for (const kind of ['breeding', 'pregnancy-check', 'foaling']) {
    for (const days of [-1, 1]) {
      test(`RP03: ${completionState} ${kind} ${days} days ago cannot change observed status`, () => {
        const unobserved = event(
          days,
          kind,
          '',
          { recordType: kind, result: kind === 'foaling' ? 'loss' : 'open' },
          completionState,
        );
        const program = buildBreedingProgram([mare([unobserved, check(290, 'in-foal'), cover()])], now);
        assert.equal(program.mares[0]!.status, 'near-term');
        assert.equal(program.inFoal, 1);
        assert.equal(program.projectedProgramValue, 20000);
      });
    }
  }
}

test('RP03: a later negative supersedes a positive and removes its value', () => {
  const program = buildBreedingProgram([mare([check(10, 'open'), check(290, 'in-foal'), cover()])], now);
  assert.equal(program.mares[0]!.status, 'open');
  assert.equal(program.inFoal, 0);
  assert.equal(program.projectedProgramValue, 0);
});

for (const summary of [
  'Confirmed positive, no heartbeat detected',
  'Positive pregnancy, heartbeat absent',
  'Confirmed positive; embryo nonviable',
  'Pregnant, no viable fetus',
  'Confirmed positive; heartbeat is not detected',
  'Pregnancy check planned; positive result expected',
]) {
  test(`RP03: review is required for ${summary}`, () => {
    const program = buildBreedingProgram([mare([event(10, 'Pregnancy check', summary), cover()])], now);
    assert.equal(program.inFoal, 0);
    assert.equal(program.projectedProgramValue, 0);
  });
}

test('RP03: actual birth replaces carrying value without pretending to determine a guarantee', () => {
  const program = buildBreedingProgram(
    [
      mare([
        event(2, 'Foaled', '', { recordType: 'foaling', result: 'live' }, 'completed'),
        check(290, 'in-foal'),
        cover(),
      ]),
    ],
    now,
  );
  assert.equal(program.mares[0]!.status, 'foaled-live');
  assert.equal(program.inFoal, 0);
  assert.equal(program.projectedProgramValue, 0);
  assert.equal(program.mares[0]!.guarantee, 'not-recorded');
});

const guaranteeTerms = {
  breedingEventId: cover().id,
  counterparty: 'Synthetic Stallion Owner',
  terms: 'Synthetic agreement: live foal, subject to the recorded conditions and claim deadline.',
  coverage: 'included',
  conditionsReview: 'satisfied',
  reviewedBy: 'Synthetic Reviewer',
  reviewedOn: '2026-10-08',
  claimDeadline: '2026-11-01',
};
function contract(overrides: object = {}, extraDetails: object = {}): TimelineEvent {
  return event(
    2,
    'Breeding agreement reviewed',
    '',
    {
      recordType: 'contract',
      documentId: 'synthetic-contract',
      liveFoalGuarantee: { ...guaranteeTerms, ...overrides },
      ...extraDetails,
    },
    'completed',
  );
}
function contracted(events: TimelineEvent[]): HorseRecord {
  return { ...mare(events), documents: ['synthetic-contract'] };
}
for (const [name, terms, expected] of [
  ['reviewed recorded agreement', {}, 'recorded'],
  ['excluded coverage', { coverage: 'excluded' }, 'excluded'],
  ['unmet recorded condition', { conditionsReview: 'not-satisfied' }, 'excluded'],
  [
    'unreviewed conditional guarantee',
    { coverage: 'conditional', conditionsReview: 'unreviewed' },
    'conditions-pending',
  ],
  ['reviewed conditional guarantee', { coverage: 'conditional' }, 'recorded'],
  ['past recorded claim deadline', { claimDeadline: '2026-10-08' }, 'expired'],
  ['deadline today remains reviewable', { claimDeadline: '2026-10-09' }, 'recorded'],
  ['invalid claim deadline', { claimDeadline: '2026-02-30' }, 'unconfirmed'],
  ['missing reviewer', { reviewedBy: '' }, 'unconfirmed'],
  ['future review', { reviewedOn: '2026-10-10' }, 'unconfirmed'],
  ['review predates agreement', { reviewedOn: '2026-10-01' }, 'unconfirmed'],
  ['missing counterparty', { counterparty: '' }, 'unconfirmed'],
  ['missing terms', { terms: '' }, 'unconfirmed'],
  ['different breeding episode', { breedingEventId: 'other-cover' }, 'unconfirmed'],
] as const) {
  test(`RP04: ${name} stays distinct without adjudicating legal entitlement`, () => {
    const state = buildMareBreedingState(contracted([contract(terms), check(290, 'in-foal'), cover()]), now);
    assert.equal(state.guarantee, expected);
    assert.doesNotMatch(state.guaranteeLabel, /(?:^|\s)(?:covered|owed|fulfilled)(?:$|\s)/i);
  });
}

test('RP04: valid loss with reviewed terms asks for claim review, never says rebreed owed', () => {
  const state = buildMareBreedingState(
    contracted([
      event(1, 'Foaling loss', '', { recordType: 'foaling', result: 'loss' }, 'completed'),
      contract(),
      cover(),
    ]),
    now,
  );
  assert.equal(state.status, 'foaled-loss');
  assert.equal(state.guarantee, 'claim-review');
  assert.doesNotMatch(`${state.guaranteeLabel} ${state.actionLabel}`, /owed|fulfilled|schedule rebreed/i);
});

test('RP04: missing/unlinked source document prevents even a reviewed-terms label', () => {
  for (const horse of [mare([contract(), cover()]), contracted([contract({}, { documentId: undefined }), cover()])]) {
    assert.equal(buildMareBreedingState(horse, now).guarantee, 'unconfirmed');
  }
});

test('RP04: contradictory same-day contract amendments stay unconfirmed', () => {
  const first = contract();
  const second = { ...contract({ coverage: 'excluded' }), id: 'amendment' };
  for (const contracts of [
    [first, second],
    [second, first],
  ]) {
    assert.equal(buildMareBreedingState(contracted([...contracts, cover()]), now).guarantee, 'unconfirmed');
  }
});

test('RP04: actual live birth alone never marks recorded terms fulfilled', () => {
  const state = buildMareBreedingState(
    contracted([event(1, 'Foaled', '', { recordType: 'foaling', result: 'live' }, 'completed'), contract(), cover()]),
    now,
  );
  assert.equal(state.guarantee, 'recorded');
  assert.doesNotMatch(state.guaranteeLabel, /fulfilled|owed|covered/i);
});

test('RP03/04: read-only derivation preserves original records and contract references', () => {
  const horse = contracted([contract(), check(290, 'in-foal'), cover()]);
  const before = JSON.stringify(horse);
  buildMareBreedingState(horse, now);
  buildBreedingProgram([horse], now);
  assert.equal(JSON.stringify(horse), before);
});

for (const [kind, result, summary, status] of [
  ['pregnancy-check', 'open', 'Open today. Rebreed scheduled next week', 'open'],
  ['pregnancy-check', 'in-foal', 'Positive scan; expected foaling 2027-06-06', 'near-term'],
  ['foaling', 'live', 'Foaled a live filly. Vet check scheduled tomorrow', 'foaled-live'],
] as const) {
  test(`RP03: follow-up plans cannot erase the observed ${result} result`, () => {
    const observed = event(10, kind, summary, { recordType: kind, result });
    assert.equal(buildMareBreedingState(mare([observed, check(290, 'in-foal'), cover()]), now).status, status);
  });
}

test('RP03: a legacy birth remains live when a later follow-up is planned in another clause', () => {
  const birth = event(1, 'Foaled a live filly', 'Vet check scheduled tomorrow');
  assert.equal(buildMareBreedingState(mare([birth, cover()]), now).status, 'foaled-live');
});

for (const [early, late, expected] of [
  ['open', 'in-foal', 'near-term'],
  ['in-foal', 'open', 'open'],
] as const) {
  test(`RP03: precise later ${late} check supersedes same-day ${early} in either array order`, () => {
    const earlier = { ...check(2, early), date: '2026-10-07T09:00:00Z' };
    const later = { ...check(2, late), date: '2026-10-07T17:00:00Z' };
    for (const checks of [
      [earlier, later],
      [later, earlier],
    ]) {
      assert.equal(buildMareBreedingState(mare([...checks, cover()]), now).status, expected);
    }
  });
}

test('RP03: precise future timestamps today cannot establish any completed event', async () => {
  const { validateBreedingDate } = await import('../src/lib/breedingEntry.js');
  for (const kind of ['breeding', 'pregnancy-check', 'foaling']) {
    const future = {
      ...event(0, kind, '', { recordType: kind, result: kind === 'foaling' ? 'live' : 'open' }, 'completed'),
      date: '2026-10-09T22:00:00Z',
    };
    assert.equal(buildMareBreedingState(mare([future, check(290, 'in-foal'), cover()]), now).status, 'near-term');
    assert.match(validateBreedingDate(future.date, kind, now, 'completed') ?? '', /future-dated/);
    assert.equal(validateBreedingDate(future.date, kind, now, 'planned'), null);
  }
});

test('RP03: a full timestamp in another zone is compared by its observed instant', () => {
  const negative = { ...check(2, 'open'), date: '2026-10-07T21:00:00-07:00' };
  const laterPositive = { ...check(2, 'in-foal'), date: '2026-10-08T05:00:00Z' };
  assert.equal(buildMareBreedingState(mare([negative, laterPositive, cover()]), now).status, 'near-term');
});

test('RP03: due checkpoints stay due throughout the local day, including before UTC midnight', async () => {
  const { buildCheckpoints } = await import('../src/lib/breedingIntelligence.js');
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const lateToday = new Date('2026-10-09T06:30:00Z');
    const checkpoint = buildCheckpoints(new Date('2026-09-23T00:00:00Z'), lateToday)[0]!;
    assert.equal(checkpoint.dueDate, '2026-10-08');
    assert.equal(checkpoint.status, 'due');
    assert.equal(
      buildCheckpoints(new Date('2026-09-23T00:00:00Z'), new Date('2026-10-09T07:30:00Z'))[0]!.status,
      'overdue',
    );
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('RP03: the overview chronology contains observed records, never plans or cancellations', async () => {
  const { chronologicalBreedingEvents } = await import('../src/lib/breedingIntelligence.js');
  const actual = check(290, 'in-foal');
  const events = [
    event(1, 'Foaled live', '', { recordType: 'foaling', result: 'live' }, 'planned'),
    event(2, 'Foaled live', '', { recordType: 'foaling', result: 'live' }, 'cancelled'),
    event(3, 'Foaling prep', 'Buy foaling kit'),
    actual,
  ];
  assert.deepEqual(chronologicalBreedingEvents(events, now), [actual]);
});

test('RP03: a post-cover check with an earlier written date still belongs to that precise episode', () => {
  const coverEvent = { ...cover(), date: '2026-10-02T01:00:00+14:00' };
  const positive = { ...check(1, 'in-foal'), date: '2026-10-01T12:00:00Z' };
  for (const events of [
    [positive, coverEvent],
    [coverEvent, positive],
  ]) {
    assert.equal(buildMareBreedingState(mare(events), now).status, 'in-foal');
  }
});

test('RP03: an appointment confirmation is not a pregnancy result', () => {
  const appointment = event(1, 'Pregnancy check', 'Appointment confirmed');
  assert.equal(buildBreedingProgram([mare([appointment, cover()])], now).inFoal, 0);
});

for (const date of ['2026-10-01', '2026-10-01T09:00:00Z']) {
  test(`RP03: equally recent conflicting births stay unconfirmed: ${date}`, () => {
    const live = { ...event(1, 'Birth live', '', { recordType: 'foaling', result: 'live' }, 'completed'), date };
    const loss = { ...event(1, 'Birth loss', '', { recordType: 'foaling', result: 'loss' }, 'completed'), date };
    for (const births of [
      [live, loss],
      [loss, live],
    ]) {
      const state = buildMareBreedingState(mare([...births, cover()]), now);
      assert.equal(state.status, 'foaling-unknown');
      assert.doesNotMatch(state.actionLabel, /Register|rebreed/i);
      assert.equal(buildBreedingProgram([mare([...births, cover()])], now).projectedProgramValue, 0);
    }
  });
}

test('RP03: precisely timed birth outcomes remain ordered rather than becoming a false tie', () => {
  const live = {
    ...event(1, 'Birth live', '', { recordType: 'foaling', result: 'live' }, 'completed'),
    date: '2026-10-01T09:00:00Z',
  };
  const loss = {
    ...event(1, 'Birth loss', '', { recordType: 'foaling', result: 'loss' }, 'completed'),
    date: '2026-10-01T17:00:00Z',
  };
  for (const births of [
    [live, loss],
    [loss, live],
  ]) {
    assert.equal(buildMareBreedingState(mare([...births, cover()]), now).status, 'foaled-loss');
  }
});

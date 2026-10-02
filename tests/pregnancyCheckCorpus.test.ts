import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { breedingEntryDetails } from '../src/lib/breedingEntry.js';
import {
  buildBreedingProgram,
  buildMareBreedingState,
  currentPregnancyOutcome,
  pregnancyCheckOutcome,
  type PregnancyCheckOutcome,
} from '../src/lib/breedingIntelligence.js';
import type { HorseRecord, TimelineEvent } from '../src/types/xbar.js';

/*
 * Audit F07: whether a mare is in foal was read out of free text. A check
 * titled "Pregnancy check" with the note "Negative -- mare is not pregnant"
 * counted as in foal, because "pregnant" matched before anything noticed the
 * "not" in front of it.
 *
 * Every row says what a person reading the entry would say -- the contract,
 * not what the code happens to do. When you find a new case, add a row; never
 * relax one to make a change pass (CLAUDE.md, "Hold the whole contract").
 */

function check(title: string, summary: string, result?: unknown, date = '2026-06-01'): TimelineEvent {
  return {
    id: `ev-${title}-${summary}-${date}`.replace(/\W+/g, '-'),
    date,
    title,
    summary,
    owner: 'Vet',
    category: 'Breeding',
    ...(result === undefined ? {} : { details: { recordType: 'pregnancy-check', result } }),
  } as TimelineEvent;
}

const corpus: Array<[string, TimelineEvent, PregnancyCheckOutcome]> = [
  // Chosen results decide, whatever the note says.
  ['form: in foal, note mentions twins', check('Ultrasound', 'Negative for twins', 'in-foal'), 'positive'],
  ['form: open, note recalls an old positive', check('Recheck', 'Was confirmed in foal last time', 'open'), 'negative'],
  ['form: awaiting result', check('Ultrasound', 'Sample sent to lab', 'pending'), 'unknown'],
  // The audit's own two cases.
  ['audit: negative, not pregnant', check('Pregnancy check', 'Negative — mare is not pregnant'), 'negative'],
  [
    'audit: confirmed positive in notes',
    check('Preg check — 45 days', 'Confirmed positive, strong heartbeat'),
    'positive',
  ],
  // Negation in the same clause.
  ['no heartbeat yet', check('Ultrasound 14 days', 'No heartbeat detected, recheck in 7 days'), 'unknown'],
  ['not confirmed yet', check('Pregnancy check', 'Not confirmed yet'), 'unknown'],
  ['mare is not pregnant', check('Scan', 'Mare is not pregnant'), 'negative'],
  // Phrases that read the opposite way to their loudest word.
  ['confirmed open', check('Vet check', 'Confirmed open'), 'negative'],
  ['confirmed not pregnant', check('Recheck', 'Confirmed not pregnant'), 'negative'],
  ['confirmed not in foal', check('Recheck', 'Confirmed not in foal'), 'negative'],
  ['confirmed she is not pregnant', check('Recheck', 'Confirmed she is not pregnant'), 'negative'],
  ['bare confirmed is in foal', check('Pregnancy check', 'Confirmed'), 'positive'],
  ['confirmed, single pregnancy', check('Ultrasound', 'Confirmed single pregnancy, negative for twins'), 'positive'],
  ['single pregnancy, negative for twins', check('Ultrasound', 'Single pregnancy, negative for twins'), 'positive'],
  // Plain results.
  ['empty', check('Preg check', 'Empty'), 'negative'],
  ['in foal at 16 days', check('Pregnancy check', 'In foal at 16 days'), 'positive'],
  ['mare is pregnant', check('Scan', 'Mare is pregnant'), 'positive'],
  ['lost the pregnancy', check('Pregnancy check', 'Lost the pregnancy at 60 days'), 'negative'],
  ['awaiting lab results', check('Pregnancy check', 'Awaiting results from the lab'), 'unknown'],
  // Both directions at once is for a person to settle, not a guess.
  ['conflicting wording', check('Ultrasound', 'Heartbeat seen but fluid noted, possibly open'), 'unknown'],
  // A restored backup can carry anything in the result field.
  ['non-string result falls back to the text', check('Pregnancy check', 'In foal', 45), 'positive'],
];

for (const [name, event, expected] of corpus) {
  test(`pregnancy check reads as a person would: ${name}`, () => {
    assert.equal(pregnancyCheckOutcome(event), expected);
  });
}

const BRED = '2026-04-01';

test('the latest definite check decides, so a re-check can reverse an earlier one', () => {
  const open14 = check('Ultrasound', '', 'open', '2026-04-15');
  const inFoal16 = check('Ultrasound', '', 'in-foal', '2026-04-17');
  const open45 = check('Recheck', '', 'open', '2026-05-16');
  const pending60 = check('Recheck', '', 'pending', '2026-05-31');

  assert.equal(currentPregnancyOutcome([inFoal16, open14], BRED), 'positive', 'open at 14, in foal at 16');
  assert.equal(currentPregnancyOutcome([open45, inFoal16], BRED), 'negative', 'in foal at 16, lost by 45');
  assert.equal(currentPregnancyOutcome([pending60, inFoal16], BRED), 'positive', 'a pending re-check erases nothing');
  // A free-text re-check that confirms a loss overrides the earlier positive.
  const lost = check('Recheck', 'Confirmed not pregnant', undefined, '2026-05-20');
  assert.equal(currentPregnancyOutcome([lost, inFoal16], BRED), 'negative', 'confirmed not pregnant at 50');
  // Same day: the timeline is newest-first, so the entry made last wins.
  const morning = check('Scan', '', 'open', '2026-05-01');
  const afternoon = check('Rescan', '', 'in-foal', '2026-05-01');
  assert.equal(currentPregnancyOutcome([afternoon, morning], BRED), 'positive');
  // Checks from before this cover belong to an earlier one.
  assert.equal(currentPregnancyOutcome([check('Old', '', 'in-foal', '2026-03-01')], BRED), 'unknown');
});

test("the audit's mare reads as open on the program screen, not in foal", () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const mare = (summary: string) =>
    ({
      id: 'm1',
      name: 'Glory',
      sex: 'Mare',
      breedingTimeline: [
        check('Pregnancy check', summary, undefined, '2026-04-20'),
        {
          id: 'cover',
          date: BRED,
          title: 'Bred to Thunder',
          summary: '',
          owner: 'Vet',
          category: 'Breeding',
          details: { recordType: 'breeding' },
        },
      ],
    }) as unknown as HorseRecord;

  assert.equal(buildMareBreedingState(mare('Negative — mare is not pregnant'), now).status, 'open');
  assert.equal(buildMareBreedingState(mare('Confirmed positive, strong heartbeat'), now).status, 'in-foal');
  assert.equal(buildMareBreedingState(mare('No heartbeat detected, recheck'), now).status, 'bred-awaiting-check');
});

test('time since a cover is not a pregnancy: near term needs a confirmed check', () => {
  // Covered 320 days ago -- foaling would be ~20 days out if she took.
  const now = new Date('2027-02-15T12:00:00Z');
  const cover = {
    id: 'cover',
    date: '2026-04-01',
    title: 'Bred to Thunder',
    summary: '',
    owner: 'Vet',
    category: 'Breeding',
    details: { recordType: 'breeding' },
  } as TimelineEvent;
  const economics = { studFee: 0, bookedMares: 1, breedingCosts: 0, mareProductionValue: 0, foalProjectedValue: 18000 };
  const mare = (checks: TimelineEvent[]) =>
    ({
      id: 'm1',
      name: 'Glory',
      sex: 'Mare',
      breedingTimeline: [...checks, cover],
      breedingEconomics: economics,
    }) as unknown as HorseRecord;

  for (const [label, checks] of [
    ['no check at all', []],
    ['only an awaiting-result check', [check('Ultrasound', 'Sample sent to lab', 'pending', '2026-04-20')]],
    [
      'only an unreadable note',
      [check('Pregnancy check', 'Heartbeat seen but fluid noted, possibly open', undefined, '2026-04-20')],
    ],
  ] as Array<[string, TimelineEvent[]]>) {
    const state = buildMareBreedingState(mare(checks), now);
    assert.equal(state.status, 'bred-awaiting-check', label);
    assert.match(state.actionLabel, /^Confirm pregnancy for Glory \(foaling would be due /, label);
    const program = buildBreedingProgram([mare(checks)], now);
    assert.equal(program.inFoal, 0, `${label}: not counted in foal`);
    assert.equal(program.nearTerm, 0, `${label}: not counted near term`);
    assert.equal(program.projectedProgramValue, 0, `${label}: no foal value promised`);
  }

  // The same mare with a confirmed check is near term, and counted.
  const confirmed = mare([check('Ultrasound', '', 'in-foal', '2026-04-20')]);
  assert.equal(buildMareBreedingState(confirmed, now).status, 'near-term');
  const program = buildBreedingProgram([confirmed], now);
  assert.equal(program.inFoal, 1);
  assert.equal(program.nearTerm, 1);
  assert.equal(program.projectedProgramValue, 18000);
});

test('an entry says what it is, and a check says its result, or it is refused', () => {
  assert.deepEqual(breedingEntryDetails({ kind: 'pregnancy-check', result: 'in-foal' }), {
    ok: true,
    details: { recordType: 'pregnancy-check', result: 'in-foal' },
  });
  assert.deepEqual(breedingEntryDetails({ kind: 'note', result: 'in-foal' }), {
    ok: true,
    details: { recordType: 'note' },
  });
  for (const choice of [{}, { kind: '' }, { kind: 'cover' }]) {
    const refused = breedingEntryDetails(choice);
    assert.equal(refused.ok, false);
    assert.match(refused.ok ? '' : refused.message, /Choose what this entry records/);
  }
  for (const result of [undefined, '', 'positive', 'maybe']) {
    const refused = breedingEntryDetails({ kind: 'pregnancy-check', result });
    assert.equal(refused.ok, false, `${String(result)} is not a result`);
    assert.match(refused.ok ? '' : refused.message, /Choose the check result/);
  }
});

test('both entry points ask, and the foaling page reads the same classifier', async () => {
  const breeding = await readFile('src/routes/Breeding.tsx', 'utf8');
  assert.match(breeding, /kind: eventKind,\s*result: eventResult,/);
  assert.match(breeding, /useState\(localIsoDate\(\)\)/, 'the default date is the local day');
  const flows = await readFile('src/components/saas/flows.tsx', 'utf8');
  assert.match(flows, /kind: f\.kind \?\? '',\s*result: f\.result \?\? '',/);
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  assert.match(store, /const entry = breedingEntryDetails\(\{ kind: event\.kind, result: event\.result \}\);/);
  const foaling = await readFile('src/routes/BreedingFoaling.tsx', 'utf8');
  assert.match(foaling, /const state = buildMareBreedingState\(m\);/);
  assert.doesNotMatch(foaling, /in foal\|confirmed\|pregnan/, 'no private word match');
});

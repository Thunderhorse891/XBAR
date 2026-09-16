import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nameNeedsRepair,
  proposeHorseNameRepairs,
  type RepairSourceDocument,
  type RepairableHorse,
} from '../src/lib/horseNameRepair.js';

/*
 * Twenty real papers produced twenty horses named by their registration
 * numbers. The creation defect is fixed; these cover offering the existing
 * records their names back, from the papers still attached to them.
 */

function horse(overrides: Partial<RepairableHorse> = {}): RepairableHorse {
  return {
    id: 'horse-1',
    name: '35012691962',
    barnName: '35012691962',
    registrationNumber: '35012691962',
    documents: ['doc-1'],
    ...overrides,
  };
}

function document(overrides: Partial<RepairSourceDocument> = {}): RepairSourceDocument {
  return { id: 'doc-1', title: 'Bar B Joseywood pedigree', horseId: 'horse-1', ...overrides };
}

test('a name that is only digits needs repair', () => {
  assert.equal(nameNeedsRepair({ name: '35012691962', registrationNumber: '35012691962' }), true);
  assert.equal(nameNeedsRepair({ name: '539882319930', registrationNumber: '' }), true);
});

test('a name that repeats the registration number needs repair even with letters in it', () => {
  assert.equal(nameNeedsRepair({ name: 'AQHA5551234', registrationNumber: 'AQHA5551234' }), true);
  assert.equal(nameNeedsRepair({ name: 'aqha5551234', registrationNumber: 'AQHA5551234' }), true);
  assert.equal(nameNeedsRepair({ name: 'X7', registrationNumber: '', aqhaNumber: 'X7' }), true);
});

test('a real name is never a candidate, however odd it looks', () => {
  for (const name of ['Bar B Joseywood', 'blue valentine dot com', 'Horse 3', 'A1 Sweet Lady', 'Docs 2026']) {
    assert.equal(nameNeedsRepair({ name, registrationNumber: '35012691962' }), false, `${name} must be left alone`);
  }
});

test('an empty name is not repaired by this path', () => {
  // Nothing to compare and nothing claimed; a blank name is a different problem.
  assert.equal(nameNeedsRepair({ name: '   ', registrationNumber: '35012691962' }), false);
});

test('a number-named horse is offered the name on its paper', () => {
  const repairs = proposeHorseNameRepairs({ horses: [horse()], documents: [document()] });

  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].horseId, 'horse-1');
  assert.equal(repairs[0].currentName, '35012691962');
  assert.equal(repairs[0].proposedName, 'Bar B Joseywood');
  assert.equal(repairs[0].sourceDocumentTitle, 'Bar B Joseywood pedigree');
  assert.equal(repairs[0].collidesWithHorseId, undefined);
});

test('the barn name follows only when it holds the same bad value', () => {
  const [followed] = proposeHorseNameRepairs({ horses: [horse()], documents: [document()] });
  assert.equal(followed.proposedBarnName, 'Bar B');

  const [untouched] = proposeHorseNameRepairs({
    horses: [horse({ barnName: 'Joey' })],
    documents: [document()],
  });
  assert.equal(untouched.proposedBarnName, undefined, 'a barn name a person chose is theirs');
});

/*
 * Found in review. An earlier version asked `nameNeedsRepair` about the barn
 * name, which is true for anything with no letters in it -- so a barn that
 * deliberately calls a horse "7" would have had that replaced by the first two
 * words of the registered name, as a silent side effect of fixing a different
 * field, with nothing in the review UI showing it.
 */
test('a deliberately numeric barn name is left alone', () => {
  for (const barnName of ['7', '42', '3B']) {
    const [repair] = proposeHorseNameRepairs({
      horses: [horse({ barnName })],
      documents: [document()],
    });
    assert.equal(repair.proposedBarnName, undefined, `barn name ${barnName} is a choice, not the defect`);
  }
});

test('a barn name repeating the AQHA number or the broken name does follow', () => {
  const [byAqha] = proposeHorseNameRepairs({
    horses: [horse({ barnName: 'AQHA77', registrationNumber: '35012691962', aqhaNumber: 'AQHA77' })],
    documents: [document()],
  });
  assert.equal(byAqha.proposedBarnName, 'Bar B');

  // The registered name was the bad value and the barn name copied it.
  const [byName] = proposeHorseNameRepairs({
    horses: [horse({ name: '999', barnName: '999', registrationNumber: '' })],
    documents: [document()],
  });
  assert.equal(byName.proposedBarnName, 'Bar B');
});

test('a horse whose papers hold no usable name is not proposed at all', () => {
  // No placeholder, no guess: absence is the honest answer.
  const repairs = proposeHorseNameRepairs({
    horses: [horse()],
    documents: [document({ title: 'scan-001' })],
  });

  assert.deepEqual(repairs, []);
});

test('a horse with no attached papers is not proposed', () => {
  assert.deepEqual(proposeHorseNameRepairs({ horses: [horse({ documents: [] })], documents: [] }), []);
});

test('documents attached by horseId alone are still found', () => {
  const repairs = proposeHorseNameRepairs({
    horses: [horse({ documents: [] })],
    documents: [document({ id: 'doc-9', horseId: 'horse-1' })],
  });

  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].proposedName, 'Bar B Joseywood');
});

test('the first paper carrying a usable name wins, and each horse is proposed once', () => {
  const repairs = proposeHorseNameRepairs({
    horses: [horse({ documents: ['doc-a', 'doc-b', 'doc-c'] })],
    documents: [
      document({ id: 'doc-a', title: 'IMG_4821' }),
      document({ id: 'doc-b', title: 'Bar B Joseywood pedigree' }),
      document({ id: 'doc-c', title: 'Something Else Entirely' }),
    ],
  });

  assert.equal(repairs.length, 1, 'one proposal per horse');
  assert.equal(repairs[0].proposedName, 'Bar B Joseywood');
  assert.equal(repairs[0].sourceDocumentId, 'doc-b');
});

test('a proposal that would duplicate another horse name says so', () => {
  const repairs = proposeHorseNameRepairs({
    horses: [horse(), { ...horse({ id: 'horse-2', name: 'Bar B Joseywood', barnName: 'Bar B' }) }],
    documents: [document()],
  });

  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].collidesWithHorseId, 'horse-2');
});

test('a horse already correctly named is never proposed', () => {
  const repairs = proposeHorseNameRepairs({
    horses: [horse({ name: 'Bar B Joseywood', barnName: 'Bar B' })],
    documents: [document()],
  });

  assert.deepEqual(repairs, []);
});

test('a full bulk intake is repaired in one pass', () => {
  // The four rows visible in the report that started this.
  const roster: [string, string, string][] = [
    ['35012691962', 'Bar B Joseywood pedigree', 'Bar B Joseywood'],
    ['539882319930', 'Berry Peachy Chic - Copy - Copy', 'Berry Peachy Chic'],
    ['52793571973', 'blue valentine dot com - Copy - Copy', 'blue valentine dot com'],
    ['14325211973', 'Bonny lil Man Rogers - Copy - Copy', 'Bonny lil Man Rogers'],
  ];

  const repairs = proposeHorseNameRepairs({
    horses: roster.map(([number], index) =>
      horse({
        id: `horse-${index}`,
        name: number,
        barnName: number,
        registrationNumber: number,
        documents: [`doc-${index}`],
      }),
    ),
    documents: roster.map(([, title], index) => document({ id: `doc-${index}`, title, horseId: `horse-${index}` })),
  });

  assert.equal(repairs.length, 4);
  repairs.forEach((repair, index) => {
    assert.equal(repair.currentName, roster[index][0]);
    assert.equal(repair.proposedName, roster[index][2]);
  });
});

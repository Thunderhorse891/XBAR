import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HEALTH_CERTIFICATE_DAYS,
  buildExpiryRadar,
  describeExpiryRisk,
  expiryKindOf,
  expiryReminderItems,
  findPrintedExpiryDate,
} from '../src/lib/documentExpiry.js';
import { CURRENT_COGGINS_DAYS, isCurrentDatedDocument } from '../src/lib/documentCurrency.js';
import { buildAlertDigest } from '../src/lib/alertCenter.js';
import { buildOperationsPriorities } from '../src/lib/operationsPriority.js';
import type { DocumentRecord, HorseRecord } from '../src/types/xbar.js';

// The expiry radar tells a rancher which papers run out and what that puts at
// risk. It must read dates the way the rest of XBAR does (the Coggins window
// is the sale-packet gate's window), refuse to guess a date it cannot read,
// and never touch the documents it reads.

// Midday local time, so "today" is 2026-06-30 in any zone the suite runs in.
const NOW = new Date(2026, 5, 30, 12);

let seq = 0;
function doc(fields: Partial<DocumentRecord> & Pick<DocumentRecord, 'type'>): DocumentRecord {
  seq += 1;
  return {
    id: `doc-${seq}`,
    title: `${fields.type} ${seq}`,
    uploadedBy: 'Test',
    uploadedAt: '2026-01-01T00:00:00Z',
    source: 'Manual Upload',
    state: 'Ready',
    confidence: 0.95,
    duplicateRisk: 'Low',
    extractedTextPreview: '',
    summary: '',
    entities: {},
    ...fields,
  } as DocumentRecord;
}

const horses = [
  { id: 'h1', name: 'Copper Canyon', sale: { askPrice: 15000 }, insuredValue: 40000 },
  { id: 'h2', name: 'Blue Roan Sally', sale: { askPrice: 0 }, insuredValue: 0 },
  { id: 'h3', name: 'Lena Doc', sale: { askPrice: 8000 }, insuredValue: 0 },
] as unknown as HorseRecord[];

const coggins = (horseId: string, examDate: string | undefined, extra: Partial<DocumentRecord> = {}) =>
  doc({ type: 'Coggins', horseId, entities: examDate ? { examDate } : {}, ...extra });

test('a Coggins runs out twelve months after the test, sorted into the right bucket', () => {
  const radar = buildExpiryRadar(
    [
      coggins('h1', '2025-06-01'), // expired 2026-06-01
      coggins('h2', '2025-07-15'), // 15 days left
      coggins('h3', '2025-09-01'), // 63 days left
    ],
    horses,
    NOW,
  );

  assert.deepEqual(
    radar.expired.map((item) => [item.horseName, item.expiresOn, item.daysLeft]),
    [['Copper Canyon', '2026-06-01', -29]],
  );
  assert.deepEqual(
    radar.under30.map((item) => [item.horseName, item.daysLeft]),
    [['Blue Roan Sally', 15]],
  );
  assert.deepEqual(
    radar.under90.map((item) => [item.horseName, item.daysLeft]),
    [['Lena Doc', 63]],
  );
  assert.equal(radar.attentionCount, 2);
  assert.deepEqual(
    radar.items.map((item) => item.urgency),
    ['expired', 'under30', 'under90'],
    'most urgent first',
  );
});

test('the last good day agrees with the sale-packet gate exactly', () => {
  const lastDay = coggins('h1', '2025-06-30');
  const dayAfter = coggins('h2', '2025-06-29');
  const radar = buildExpiryRadar([lastDay, dayAfter], horses, NOW);

  assert.equal(CURRENT_COGGINS_DAYS, 365);
  const today = radar.items.find((item) => item.documentId === lastDay.id);
  const yesterday = radar.items.find((item) => item.documentId === dayAfter.id);
  assert.equal(today?.daysLeft, 0);
  assert.equal(today?.urgency, 'under30', 'still good on its last day');
  assert.equal(isCurrentDatedDocument(lastDay, CURRENT_COGGINS_DAYS, NOW), true);
  assert.equal(yesterday?.urgency, 'expired');
  assert.equal(isCurrentDatedDocument(dayAfter, CURRENT_COGGINS_DAYS, NOW), false);
});

test('a renewal replaces the old paper instead of leaving it listed as expired', () => {
  const radar = buildExpiryRadar(
    [coggins('h1', '2025-01-10'), coggins('h1', '2026-04-02'), coggins('h2', '2025-01-10')],
    horses,
    NOW,
  );

  assert.deepEqual(
    radar.expired.map((item) => item.horseId),
    ['h2'],
  );
  assert.equal(radar.currentCount, 1, 'Copper Canyon’s renewed Coggins is current');
});

test('archived and unread documents are left out; unreviewed ones are flagged', () => {
  const radar = buildExpiryRadar(
    [
      coggins('h1', '2025-06-01', { state: 'Archived' }),
      coggins('h2', '2025-06-01', { state: 'Queued' }),
      coggins('h3', '2025-06-01', { state: 'Needs Review' }),
    ],
    horses,
    NOW,
  );

  assert.equal(radar.items.length, 1);
  assert.equal(radar.items[0]?.horseId, 'h3');
  assert.equal(radar.items[0]?.reviewed, false);
});

test('a Coggins without an exam date is listed as undated, never given a date', () => {
  const radar = buildExpiryRadar([coggins('h1', undefined, { uploadedAt: '2026-06-01T00:00:00Z' })], horses, NOW);

  assert.equal(radar.undated.length, 1);
  assert.equal(radar.undated[0]?.expiresOn, null);
  assert.match(radar.undated[0]?.basis ?? '', /No exam date/);
  assert.equal(radar.attentionCount, 0);
});

test('printed expiry dates are read only after an expiry label, and only when they agree', () => {
  assert.equal(findPrintedExpiryDate('Policy #88213 Expiration Date: 05/01/2027 Premium $1,240'), '2027-05-01');
  assert.equal(findPrintedExpiryDate('Coverage is valid through July 15, 2026.'), '2026-07-15');
  assert.equal(findPrintedExpiryDate('EXPIRES 2026-09-30'), '2026-09-30');
  assert.equal(findPrintedExpiryDate('Expiry: 3 Aug 2026'), '2026-08-03');
  assert.equal(findPrintedExpiryDate('Policy period: 07/01/2026 to 07/01/2027'), '2027-07-01');
  assert.equal(
    findPrintedExpiryDate('Expiration date 05/01/2027. Renewal notice: expires 05/01/2027.'),
    '2027-05-01',
    'the same date twice is one date',
  );

  assert.equal(findPrintedExpiryDate('Expires 05/01/2027. Prior policy expiration: 05/01/2026.'), null, 'conflict');
  assert.equal(findPrintedExpiryDate('Signed 05/01/2026 by the owner.'), null, 'an unlabelled date is not an expiry');
  assert.equal(findPrintedExpiryDate('Expiration Date: 02/30/2026'), null, 'an impossible date is unreadable');
  assert.equal(findPrintedExpiryDate(''), null);
  assert.equal(findPrintedExpiryDate(undefined), null);
});

test('insurance and contracts use the printed date, and are undated without one', () => {
  const lapsed = doc({
    type: 'Insurance',
    horseId: 'h1',
    extractedTextPreview: 'Equine mortality policy. Expiration Date: 06/01/2026',
  });
  const ranchPolicy = doc({ type: 'Insurance', extractedTextPreview: 'Farm liability — valid through 08/15/2026' });
  const contractA = doc({ type: 'Breeding Contract', horseId: 'h2', extractedTextPreview: 'Term ends 07/10/2026' });
  const contractB = doc({ type: 'Breeding Contract', horseId: 'h2', extractedTextPreview: 'No dates here' });
  const radar = buildExpiryRadar([lapsed, ranchPolicy, contractA, contractB], horses, NOW);

  const find = (id: string) => radar.items.find((item) => item.documentId === id);
  assert.equal(find(lapsed.id)?.urgency, 'expired');
  assert.match(find(lapsed.id)?.basis ?? '', /read from the document/);
  assert.equal(find(ranchPolicy.id)?.horseName, null, 'not linked to a horse: ranch-wide');
  assert.equal(find(ranchPolicy.id)?.urgency, 'under90');
  assert.equal(find(contractA.id)?.urgency, 'under30');
  assert.equal(find(contractB.id)?.urgency, 'undated', 'two contracts are two agreements, both listed');
});

test('a health certificate runs 30 days from inspection unless it prints its own date', () => {
  const cvi = doc({
    type: 'Vet Record',
    horseId: 'h1',
    title: 'CVI export',
    extractedTextPreview: 'Certificate of Veterinary Inspection',
    entities: { examDate: '2026-06-10' },
  });
  const vetVisit = doc({
    type: 'Vet Record',
    horseId: 'h2',
    title: 'Dental float notes',
    entities: { examDate: '2025-01-01' },
  });

  assert.equal(expiryKindOf(cvi), 'Health certificate');
  assert.equal(expiryKindOf(vetVisit), null, 'an ordinary vet record does not expire');
  assert.equal(expiryKindOf(doc({ type: 'Registration' })), null);

  const radar = buildExpiryRadar([cvi, vetVisit], horses, NOW);
  assert.equal(radar.items.length, 1);
  assert.equal(HEALTH_CERTIFICATE_DAYS, 30);
  assert.equal(radar.items[0]?.expiresOn, '2026-07-10');
  assert.equal(radar.items[0]?.urgency, 'under30');
});

test('money at risk is said in plain words, with dollars only from the horse records', () => {
  const radar = buildExpiryRadar(
    [
      coggins('h1', '2025-05-01'),
      coggins('h2', '2025-05-01'),
      coggins('h3', '2025-07-20'),
      doc({ type: 'Insurance', horseId: 'h1', extractedTextPreview: 'Expiration Date: 06/15/2026' }),
      doc({ type: 'Breeding Contract', horseId: 'h2', extractedTextPreview: 'Contract ends 06/01/2026' }),
    ],
    horses,
    NOW,
  );

  assert.deepEqual(describeExpiryRisk(radar, horses), [
    '2 horses can’t legally travel or sell until Coggins is renewed — $15,000 in asking prices is on hold.',
    '1 horse loses travel and sale clearance within 30 days unless Coggins is redrawn.',
    '1 insurance policy has lapsed — $40,000 of insured horse value is uncovered.',
    '1 contract has passed its end date — renew or close it before relying on the terms.',
  ]);

  const noPrices = buildExpiryRadar([coggins('h2', '2025-05-01')], horses, NOW);
  assert.deepEqual(describeExpiryRisk(noPrices, horses), [
    '1 horse can’t legally travel or sell until Coggins is renewed.',
  ]);
});

test('expired and 30-day papers reach the Reminders queue and its alert digest, Coggins excepted', () => {
  const radar = buildExpiryRadar(
    [
      coggins('h1', '2025-05-01'),
      doc({ id: 'ins-1', type: 'Insurance', horseId: 'h1', extractedTextPreview: 'Expiration Date: 06/15/2026' }),
      doc({ id: 'ins-2', type: 'Insurance', horseId: 'h2', extractedTextPreview: 'Expiration Date: 07/20/2026' }),
      doc({ id: 'ins-3', type: 'Insurance', horseId: 'h3', extractedTextPreview: 'Expiration Date: 09/01/2026' }),
    ],
    horses,
    NOW,
  );
  const reminders = expiryReminderItems(radar);

  // The care board already raises Coggins; a second reminder for it is noise.
  assert.deepEqual(
    reminders.map((item) => [item.id, item.urgency, item.route]),
    [
      ['expiry-ins-1', 'Due', '/expiring'],
      ['expiry-ins-2', 'Watch', '/expiring'],
    ],
  );

  const priorities = buildOperationsPriorities(
    {
      careRows: [],
      transferRows: [],
      documents: [],
      salesLeads: [],
      horseNames: {},
      expiringDocuments: reminders,
    },
    NOW,
  );
  const lapsed = priorities.items.find((item) => item.id === 'expiry-ins-1');
  assert.equal(lapsed?.kind, 'Documents');
  assert.equal(lapsed?.timing, 'Overdue');
  assert.ok(
    buildAlertDigest(priorities.items, NOW).alerts.some((alert) => alert.id === 'expiry-ins-1'),
    'a lapsed policy is in the emailed digest',
  );
});

test('the radar never modifies a document it reads', () => {
  const documents = [
    coggins('h1', '2025-05-01'),
    coggins('h1', '2026-04-01'),
    doc({ type: 'Insurance', extractedTextPreview: 'Expiration Date: 06/15/2026' }),
    coggins('h2', undefined, { state: 'Archived' }),
  ];
  const before = JSON.parse(JSON.stringify(documents)) as DocumentRecord[];
  Object.freeze(documents);
  documents.forEach((document) => Object.freeze(document));

  const radar = buildExpiryRadar(documents, horses, NOW);
  describeExpiryRisk(radar, horses);
  expiryReminderItems(radar);

  assert.deepEqual(documents, before);
  assert.equal(documents.length, 4, 'archived documents are skipped, not removed');
});

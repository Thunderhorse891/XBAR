import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HEALTH_CERTIFICATE_DAYS,
  buildExpiryRadar,
  describeExpiryRisk,
  expiryBellCount,
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
    '1 insurance policy has lapsed — $40,000 of insured horse value has no current policy on file.',
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

test('a lapsed policy beside a current one does not claim the horse is uncovered', () => {
  const mortality = doc({ type: 'Insurance', horseId: 'h1', extractedTextPreview: 'Expiration Date: 03/01/2027' });
  const majorMedical = doc({ type: 'Insurance', horseId: 'h1', extractedTextPreview: 'Expiration Date: 06/10/2026' });
  const radar = buildExpiryRadar([mortality, majorMedical], horses, NOW);

  assert.deepEqual(
    describeExpiryRisk(radar, horses),
    ['1 insurance policy has lapsed.'],
    'no policy is tied to the $40,000, and one is still current',
  );
  assert.deepEqual(
    radar.current.map((item) => item.documentId),
    [mortality.id],
  );
});

test('separate insurance policies stay separate, so a current one cannot hide one that lapsed', () => {
  const liability = doc({
    type: 'Insurance',
    title: 'Farm liability',
    extractedTextPreview: 'Expiration Date: 06/01/2026',
  });
  const property = doc({
    type: 'Insurance',
    title: 'Barn property',
    extractedTextPreview: 'Expiration Date: 12/01/2026',
  });
  const mortality = doc({ type: 'Insurance', horseId: 'h1', extractedTextPreview: 'Expiration Date: 06/10/2026' });
  const majorMedical = doc({ type: 'Insurance', horseId: 'h1', extractedTextPreview: 'Expiration Date: 03/01/2027' });
  const radar = buildExpiryRadar([liability, property, mortality, majorMedical], horses, NOW);

  assert.deepEqual(
    radar.expired.map((item) => item.documentId).sort(),
    [liability.id, mortality.id].sort(),
    'both lapsed policies are listed beside the current ones',
  );
  assert.equal(radar.currentCount, 2);
  assert.equal(expiryReminderItems(radar).length, 2);
});

test('an exam date after today is a typo to check, not a current Coggins, and hides nothing', () => {
  const expired = coggins('h1', '2025-05-01');
  const typo = coggins('h1', '2062-05-01');
  const certificate = doc({
    type: 'Vet Record',
    horseId: 'h2',
    extractedTextPreview: 'Health certificate',
    entities: { examDate: '2026-12-01' },
  });
  const radar = buildExpiryRadar([expired, typo, certificate], horses, NOW);

  assert.deepEqual(
    radar.expired.map((item) => item.documentId),
    [expired.id],
    'the real expired Coggins is still listed',
  );
  assert.deepEqual(radar.undated.map((item) => item.documentId).sort(), [typo.id, certificate.id].sort());
  assert.match(radar.undated.find((item) => item.documentId === typo.id)?.basis ?? '', /after today/);
  assert.equal(isCurrentDatedDocument(typo, CURRENT_COGGINS_DAYS, NOW), false, 'the sale-packet gate agrees');
});

test('a paper inside its 30-day window reaches the emailed digest, not just the last seven days', () => {
  const radar = buildExpiryRadar(
    [doc({ id: 'ins-20', type: 'Insurance', horseId: 'h1', extractedTextPreview: 'Expiration Date: 07/20/2026' })],
    horses,
    NOW,
  );
  const priorities = buildOperationsPriorities(
    {
      careRows: [],
      transferRows: [],
      documents: [],
      salesLeads: [],
      horseNames: {},
      expiringDocuments: expiryReminderItems(radar),
    },
    NOW,
  );

  assert.equal(priorities.items[0]?.timing, 'This month');
  assert.ok(buildAlertDigest(priorities.items, NOW).alerts.some((alert) => alert.id === 'expiry-ins-20'));
});

test('an unreviewed renewal cannot hide a confirmed expiry, and both stay visible', () => {
  const confirmedExpired = coggins('h1', '2025-05-01');
  const pendingRenewal = coggins('h1', '2026-06-01', { state: 'Needs Review' });
  const pendingOlder = coggins('h1', '2025-01-01', { state: 'Needs Review' });
  const radar = buildExpiryRadar([confirmedExpired, pendingRenewal, pendingOlder], horses, NOW);

  const expired = radar.expired.find((item) => item.documentId === confirmedExpired.id);
  assert.ok(expired, 'the confirmed expired Coggins is still listed');
  assert.equal(expired?.renewalInReview, true);
  // The pending renewal runs to 2027. It is current, but nobody has approved
  // it, so it is listed — with its "Not reviewed yet" flag — rather than
  // folded into the unlisted current count.
  assert.deepEqual(
    radar.inReview.map((item) => [item.documentId, item.reviewed]),
    [[pendingRenewal.id, false]],
  );
  assert.ok(
    radar.items.some((item) => item.documentId === pendingRenewal.id),
    'the renewal is on the page',
  );
  assert.equal(radar.currentCount, 0, 'and not counted twice');
  assert.ok(
    !radar.items.some((item) => item.documentId === pendingOlder.id),
    'a pending paper older than the confirmed one is superseded',
  );

  // Once approved, the renewal replaces it as before.
  const approved = buildExpiryRadar([confirmedExpired, { ...pendingRenewal, state: 'Ready' }], horses, NOW);
  assert.equal(approved.expired.length, 0);
});

test('a Coggins with no horse on the roster still reaches the Reminders queue', () => {
  // The care board raises Coggins only for horses it knows. A loose paper has
  // no care row, so leaving it out would drop it from reminders and the digest.
  const loose = coggins('', '2025-05-01', { horseId: undefined });
  const orphaned = coggins('gone', '2025-05-01');
  const linked = coggins('h1', '2025-05-01');
  const radar = buildExpiryRadar([loose, orphaned, linked], horses, NOW);

  assert.deepEqual(
    expiryReminderItems(radar)
      .map((item) => item.id)
      .sort(),
    [`expiry-${loose.id}`, `expiry-${orphaned.id}`].sort(),
    'the linked Coggins is on the care board already',
  );
});

test('a digest counts every alert it lists, including ones due within 30 days', () => {
  const radar = buildExpiryRadar(
    [doc({ id: 'ins-21', type: 'Insurance', horseId: 'h1', extractedTextPreview: 'Expiration Date: 07/20/2026' })],
    horses,
    NOW,
  );
  const priorities = buildOperationsPriorities(
    {
      careRows: [],
      transferRows: [],
      documents: [],
      salesLeads: [],
      horseNames: {},
      expiringDocuments: expiryReminderItems(radar),
    },
    NOW,
  );
  const digest = buildAlertDigest(priorities.items, NOW);

  assert.equal(digest.alerts.length, 1);
  assert.equal(digest.dueThisMonthCount, 1);
  assert.match(digest.emailSubject, /0 overdue, 0 due soon, 1 within 30 days/);
  assert.match(digest.browserBody, /1 within 30 days/);
});

test('papers not yet assigned to a horse cannot replace each other', () => {
  const expiredLoose = coggins('', '2025-05-01', { horseId: undefined });
  const currentLoose = coggins('', '2026-05-01', { horseId: undefined });
  const radar = buildExpiryRadar([expiredLoose, currentLoose], horses, NOW);

  assert.deepEqual(
    radar.expired.map((item) => item.documentId),
    [expiredLoose.id],
  );
});

test('the bell counts each attention paper once, including a Coggins that is only running low', () => {
  const radar = buildExpiryRadar(
    [
      coggins('h1', '2025-05-01'), // expired — h1 is also a due care row
      coggins('h2', '2025-07-15'), // 15 days left — only a care watch
      doc({ type: 'Insurance', horseId: 'h3', extractedTextPreview: 'Expiration Date: 06/15/2026' }),
    ],
    horses,
    NOW,
  );

  type Board = Parameters<typeof expiryBellCount>[1];
  const row = (horseId: string, ...signals: Array<['wormer' | 'dental' | 'coggins', 'due' | 'watch' | 'clear']>) =>
    ({ horseId, signals: signals.map(([key, status]) => ({ key, status })) }) as unknown as Board[number];

  assert.equal(
    expiryBellCount(radar, [row('h1', ['coggins', 'due']), row('h2', ['coggins', 'watch'])]),
    2,
    'h2’s Coggins and the policy',
  );
  assert.equal(expiryBellCount(radar, []), 3);
  // h2 is on the care count for a due wormer, but its Coggins is only a watch:
  // the care count holds the wormer, not the Coggins, so the bell still adds it.
  assert.equal(
    expiryBellCount(radar, [row('h1', ['coggins', 'due']), row('h2', ['wormer', 'due'], ['coggins', 'watch'])]),
    2,
  );
});

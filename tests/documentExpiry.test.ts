import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  HEALTH_CERTIFICATE_DAYS,
  buildExpiryRadar,
  describeExpiryRisk,
  expiryBellCount,
  expiryRowAction,
  expiryKindOf,
  expiryReminderItems,
  findPrintedExpiryDate,
} from '../src/lib/documentExpiry.js';
import { CURRENT_COGGINS_DAYS, isCurrentDatedDocument } from '../src/lib/documentCurrency.js';
import { buildAlertDigest } from '../src/lib/alertCenter.js';
import { buildOperationsPriorities } from '../src/lib/operationsPriority.js';
import { buildCareBoardRows } from '../src/lib/dashboardOps.js';
import { buildDocumentRecord } from '../src/lib/xbarRuntime.js';
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

// The care board built from the same documents, the way the Reminders page builds it.
const careBoardFor = (documents: DocumentRecord[]) => buildCareBoardRows(horses, documents, [], NOW);

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
  const documents = [
    coggins('h1', '2025-05-01'),
    doc({ id: 'ins-1', type: 'Insurance', horseId: 'h1', extractedTextPreview: 'Expiration Date: 06/15/2026' }),
    doc({ id: 'ins-2', type: 'Insurance', horseId: 'h2', extractedTextPreview: 'Expiration Date: 07/20/2026' }),
    doc({ id: 'ins-3', type: 'Insurance', horseId: 'h3', extractedTextPreview: 'Expiration Date: 09/01/2026' }),
  ];
  const radar = buildExpiryRadar(documents, horses, NOW);
  const reminders = expiryReminderItems(radar, careBoardFor(documents));

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
  expiryReminderItems(radar, careBoardFor(documents));

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
  assert.equal(expiryReminderItems(radar, []).length, 2);
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
      expiringDocuments: expiryReminderItems(radar, []),
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
    expiryReminderItems(radar, careBoardFor([loose, orphaned, linked]))
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
      expiringDocuments: expiryReminderItems(radar, []),
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

test('a paper still in review is counted once in the bell, by the review count', () => {
  const pending = doc({
    type: 'Insurance',
    horseId: 'h1',
    state: 'Needs Review',
    extractedTextPreview: 'Expiration Date: 06/15/2026',
  });
  const confirmed = doc({ type: 'Insurance', horseId: 'h2', extractedTextPreview: 'Expiration Date: 06/15/2026' });
  const radar = buildExpiryRadar([pending, confirmed], horses, NOW);

  assert.equal(radar.expired.length, 2, 'both are listed on the page');
  assert.equal(expiryBellCount(radar, []), 1, 'the pending one is already in the bell as a document to review');
});

test('only a paper that can be approved waits in review, and each row offers what can actually be done', async () => {
  const ranchWide = doc({
    type: 'Insurance',
    state: 'Needs Review',
    extractedTextPreview: 'Expiration Date: 03/01/2027',
  });
  const linked = doc({
    type: 'Insurance',
    horseId: 'h1',
    state: 'Matched',
    extractedTextPreview: 'Expiration Date: 03/01/2027',
  });
  const radar = buildExpiryRadar([ranchWide, linked], horses, NOW);
  // Approval needs a horse; a ranch-wide paper here could never leave the group.
  assert.deepEqual(
    radar.inReview.map((item) => item.documentId),
    [linked.id],
  );

  const row = (fields: Partial<DocumentRecord> & Pick<DocumentRecord, 'type'>) =>
    buildExpiryRadar([doc(fields)], horses, NOW).items[0]!;
  const expiredText = 'Expiration Date: 06/15/2026';
  assert.equal(
    expiryRowAction(
      row({ type: 'Insurance', horseId: 'h1', state: 'Needs Review', extractedTextPreview: expiredText }),
    ),
    'review',
    'its date is unconfirmed: review it before uploading a duplicate',
  );
  assert.equal(
    expiryRowAction(row({ type: 'Insurance', state: 'Needs Review', extractedTextPreview: expiredText })),
    'upload-renewal',
    'a ranch-wide paper cannot be approved, so it goes by its date',
  );
  assert.equal(
    expiryRowAction(row({ type: 'Insurance', horseId: 'h1', extractedTextPreview: expiredText })),
    'upload-renewal',
  );
  assert.equal(expiryRowAction(row({ type: 'Insurance', horseId: 'h1' })), 'open-documents');

  const renewal = buildExpiryRadar(
    [coggins('h1', '2025-05-01'), coggins('h1', '2026-06-01', { state: 'Needs Review' })],
    horses,
    NOW,
  );
  assert.equal(expiryRowAction(renewal.expired[0]!), 'review-renewal');

  const page = await readFile('src/routes/ExpiringSoon.tsx', 'utf8');
  assert.match(page, /const action = expiryRowAction\(item\);/);
});

test('a date read off a paper still in review makes no claim and no second reminder', () => {
  const pendingLapse = doc({
    type: 'Insurance',
    horseId: 'h1',
    state: 'Needs Review',
    extractedTextPreview: 'Expiration Date: 06/15/2026',
  });
  const radar = buildExpiryRadar([pendingLapse], horses, NOW);
  assert.equal(radar.expired.length, 1, 'it is listed on the page, flagged as not reviewed');

  // The queue already carries a review reminder for it.
  assert.deepEqual(expiryReminderItems(radar, []), []);

  // An OCR slip must not become "$40,000 of insured horse value has no current policy".
  const risk = describeExpiryRisk(radar, horses);
  assert.ok(
    risk.every((line) => !/\$|lapsed/.test(line)),
    risk.join(' | '),
  );
  assert.deepEqual(risk, [
    '1 paper waiting in review reads as expired or due within 30 days — confirm its date in Documents before relying on it.',
  ]);

  const approved = buildExpiryRadar([{ ...pendingLapse, state: 'Ready' }], horses, NOW);
  assert.equal(expiryReminderItems(approved, []).length, 1);
  assert.match(describeExpiryRisk(approved, horses).join(' '), /\$40,000/);
});

test('a CVI filed as Registration is still read as a health certificate', () => {
  // Local intake types a file by its name alone, and anything it doesn't
  // recognise becomes Registration — "CVI.pdf" and "Health Certificate.pdf"
  // included. The review screen can't change a type, so the radar must
  // recognise the paper itself or it silently reports nothing due.
  const byName = doc({ type: 'Registration', horseId: 'h1', title: 'CVI', entities: { examDate: '2026-05-01' } });
  const byTitle = doc({
    type: 'Registration',
    horseId: 'h2',
    title: 'Health Certificate',
    entities: { examDate: '2026-06-10' },
  });
  const byText = doc({
    type: 'Registration',
    horseId: 'h3',
    title: 'scan0042',
    extractedTextPreview: 'CERTIFICATE OF VETERINARY INSPECTION  Origin: Texas',
    entities: { examDate: '2026-06-10' },
  });
  // The server's classifier files what it can't place as Ownership Memo.
  const serverUnknown = doc({
    type: 'Ownership Memo',
    horseId: 'h3',
    title: 'upload',
    extractedTextPreview: 'Certificate of Veterinary Inspection',
    entities: { examDate: '2026-06-12' },
  });
  for (const paper of [byName, byTitle, byText, serverUnknown]) {
    assert.equal(expiryKindOf(paper), 'Health certificate', paper.title);
  }
  const radar = buildExpiryRadar([byName, byTitle], horses, NOW);
  assert.deepEqual(
    radar.items.map((item) => [item.documentId, item.expiresOn, item.urgency]),
    [
      [byName.id, '2026-05-31', 'expired'],
      [byTitle.id, '2026-07-10', 'under30'],
    ],
  );

  // A registration paper stays a registration paper.
  const registration = doc({
    type: 'Registration',
    horseId: 'h1',
    title: 'AQHA Registration',
    extractedTextPreview:
      'American Quarter Horse Association  Certificate of Registration  Registration Number 5512345',
  });
  assert.equal(expiryKindOf(registration), null);
  // A type the intake did recognise is never second-guessed.
  assert.equal(
    expiryKindOf(doc({ type: 'Bill of Sale', title: 'Bill of Sale', extractedTextPreview: 'CVI attached' })),
    null,
  );
});

test('a policy or agreement filed as Registration is still read, and still dated only from the paper', () => {
  const liability = doc({
    type: 'Registration',
    title: 'Farm Liability Policy',
    extractedTextPreview: 'Expiration Date: 06/15/2026',
  });
  const service = doc({
    type: 'Registration',
    horseId: 'h2',
    title: 'Stallion Service Agreement',
    extractedTextPreview: 'Agreement ends 07/20/2026',
  });
  const policyByText = doc({
    type: 'Registration',
    horseId: 'h1',
    title: 'scan0043',
    extractedTextPreview: 'Equine Mortality Insurance Policy  Policy Number EQ-4471  Expiration Date: 09/01/2026',
  });
  const leaseByText = doc({
    type: 'Ownership Memo',
    horseId: 'h3',
    title: 'upload',
    extractedTextPreview: 'Mare Lease Agreement  Term ends 12/31/2026',
  });
  assert.equal(expiryKindOf(liability), 'Insurance');
  assert.equal(expiryKindOf(service), 'Contract');
  assert.equal(expiryKindOf(policyByText), 'Insurance');
  assert.equal(expiryKindOf(leaseByText), 'Contract');

  const radar = buildExpiryRadar([liability, service, policyByText, leaseByText], horses, NOW);
  assert.deepEqual(
    radar.expired.map((item) => item.documentId),
    [liability.id],
  );
  assert.deepEqual(
    radar.under30.map((item) => item.documentId),
    [service.id],
  );
  assert.deepEqual(
    radar.under90.map((item) => item.documentId),
    [policyByText.id],
  );
  assert.equal(expiryReminderItems(radar, []).length, 2, 'both reach the Reminders queue');

  // An expiry label alone does not make a paper expire: with nothing saying
  // what the paper is, it is left alone rather than guessed at.
  assert.equal(
    expiryKindOf(doc({ type: 'Registration', title: 'scan0044', extractedTextPreview: 'Expiration Date: 06/15/2026' })),
    null,
  );
});

test('a health certificate is dated by the certificate, never by a vaccination printed on it', () => {
  const inspected = { type: 'Vet Record' as const, horseId: 'h1', entities: { examDate: '2026-05-01' } };
  const withRabies = doc({
    ...inspected,
    extractedTextPreview: 'Certificate of Veterinary Inspection  Rabies vaccination expires 05/01/2027',
  });
  const withCoggins = doc({
    ...inspected,
    horseId: 'h2',
    extractedTextPreview: 'Health certificate  EIA test valid through 04/20/2027',
  });
  const radar = buildExpiryRadar([withRabies, withCoggins], horses, NOW);
  assert.deepEqual(
    radar.items.map((item) => [item.documentId, item.expiresOn, item.urgency]),
    [
      [withRabies.id, '2026-05-31', 'expired'],
      [withCoggins.id, '2026-05-31', 'expired'],
    ],
    'the 30-day inspection window, not the vaccine or test date',
  );

  // A date the certificate gives for itself is used.
  for (const text of [
    'Certificate of Veterinary Inspection  This certificate is valid through 07/15/2026',
    'Health certificate  Certificate expiration date: 07/15/2026',
    'CVI valid until July 15, 2026  Rabies vaccination expires 05/01/2027',
  ]) {
    const item = buildExpiryRadar([doc({ ...inspected, extractedTextPreview: text })], horses, NOW).items[0];
    assert.equal(item?.expiresOn, '2026-07-15', text);
    assert.match(item?.basis ?? '', /read from the document/);
  }
  // Two certificate dates that disagree are a guess; the window is used.
  const conflicting = doc({
    ...inspected,
    extractedTextPreview:
      'Health certificate  Certificate valid through 07/15/2026  Certificate valid through 08/15/2026',
  });
  assert.equal(buildExpiryRadar([conflicting], horses, NOW).items[0]?.expiresOn, '2026-05-31');
});

test('a Coggins is left out of reminders only when the care board raises one for that horse', () => {
  // The care board reads the newest Ready Coggins by exam date, falling back
  // to the upload date. A newer paper with no exam date (or a mistyped future
  // one) reads as current there, while the radar still holds last year's
  // expired Coggins. Dropping it then would leave the horse with no Coggins
  // reminder at all.
  const expired = coggins('h1', '2025-05-01');
  const undatedNewer = coggins('h1', undefined, { uploadedAt: '2026-06-01T00:00:00Z' });
  const documents = [expired, undatedNewer];
  const careBoard = careBoardFor(documents);
  const cogginsSignal = careBoard
    .find((row) => row.horseId === 'h1')
    ?.signals.find((signal) => signal.key === 'coggins');
  assert.equal(cogginsSignal?.status, 'clear', 'the care board raises nothing for this Coggins');

  const radar = buildExpiryRadar(documents, horses, NOW);
  assert.deepEqual(
    expiryReminderItems(radar, careBoard).map((item) => item.id),
    [`expiry-${expired.id}`],
  );

  const typo = coggins('h1', '2062-05-01');
  const withTypo = [expired, typo];
  assert.deepEqual(
    expiryReminderItems(buildExpiryRadar(withTypo, horses, NOW), careBoardFor(withTypo)).map((item) => item.id),
    [`expiry-${expired.id}`],
    'a mistyped future exam does not silence the real expiry either',
  );

  // When the care board does raise it, one reminder is enough.
  assert.deepEqual(expiryReminderItems(buildExpiryRadar([expired], horses, NOW), careBoardFor([expired])), []);
});

test('the Reminders page passes its care board to the radar reminders', async () => {
  const page = await readFile('src/routes/Reminders.tsx', 'utf8');
  assert.match(page, /expiryReminderItems\(buildExpiryRadar\(documents, horses\), careRows\)/);
  assert.match(page, /careRows,\n/);
});

test('a CVI is dated by its formal name too: "Certificate of Veterinary Inspection valid until …"', () => {
  const inspected = { type: 'Vet Record' as const, horseId: 'h1', entities: { examDate: '2026-05-01' } };
  for (const text of [
    'Certificate of Veterinary Inspection valid until July 15, 2026',
    'Certificate of Veterinary Inspection (CVI) valid until 07/15/2026',
    'Certificate of Veterinary Inspection expires 07/15/2026  Rabies vaccination expires 05/01/2027',
    'Interstate health certificate valid through 07/15/2026',
  ]) {
    const item = buildExpiryRadar([doc({ ...inspected, extractedTextPreview: text })], horses, NOW).items[0];
    assert.equal(item?.expiresOn, '2026-07-15', text);
    assert.equal(item?.urgency, 'under30', text);
  }
});

test('a CVI recovered from a Registration upload is dated by the inspection date printed on it', async () => {
  // The real local intake: "CVI" is not a name guessDocumentType knows, so the
  // paper is filed as Registration, and entity extraction reads an exam date
  // only for Vet Record and Coggins. The radar must read the labelled
  // inspection date itself, or the certificate sits undated.
  const upload = await buildDocumentRecord({
    file: new File(
      ['Certificate of Veterinary Inspection\nOrigin: Texas\nInspection Date: 2026-05-01\nDr. Jane Smith'],
      'CVI.txt',
      { type: 'text/plain' },
    ),
    uploadedBy: 'Ops Desk',
    source: 'Manual Upload',
    horses: [],
    existingDocuments: [],
  });
  assert.equal(upload.type, 'Registration', 'intake still files it as Registration');
  assert.equal(upload.entities.examDate, undefined, 'and reads no exam date');
  const recovered = { ...upload, state: 'Ready' as const, horseId: 'h1' };
  const item = buildExpiryRadar([recovered], horses, NOW).items[0];
  assert.equal(item?.kind, 'Health certificate');
  assert.equal(item?.expiresOn, '2026-05-31', '30 days from the printed inspection');
  assert.equal(item?.urgency, 'expired');
  assert.match(item?.basis ?? '', /inspection/);
  assert.match(item?.basis ?? '', /check it against the paper/i);

  const certificate = (text: string, type: DocumentRecord['type'] = 'Registration') =>
    doc({ type, horseId: 'h2', title: 'CVI', extractedTextPreview: text });
  // Other ways a certificate labels it; a vet record with no stored exam date reads it too.
  for (const [text, type] of [
    ['Date of Inspection: 06/10/2026', 'Registration'],
    ['Date Inspected June 10, 2026', 'Ownership Memo'],
    ['Certificate of Veterinary Inspection  Examination Date: 06/10/2026', 'Vet Record'],
  ] as const) {
    assert.equal(buildExpiryRadar([certificate(text, type)], horses, NOW).items[0]?.expiresOn, '2026-07-10', text);
  }
  // It refuses to guess: an unlabelled date, two labelled dates that disagree,
  // or an inspection after today leave the certificate undated.
  for (const text of [
    'CVI  2026-06-10',
    'Inspection Date: 06/10/2026  Inspection Date: 06/12/2026',
    'Inspection Date: 12/01/2026',
  ]) {
    const item = buildExpiryRadar([certificate(text)], horses, NOW).items[0];
    assert.equal(item?.urgency, 'undated', text);
  }
  // A stored exam date still decides when there is one.
  const stored = doc({
    type: 'Vet Record',
    horseId: 'h3',
    extractedTextPreview: 'Health certificate  Inspection Date: 06/12/2026',
    entities: { examDate: '2026-06-10' },
  });
  assert.equal(buildExpiryRadar([stored], horses, NOW).items[0]?.expiresOn, '2026-07-10');
});

test('a vaccination or test certificate printed on a CVI is never read as the CVI’s own expiry', () => {
  const cvi = (text: string) => doc({ type: 'Vet Record', horseId: 'h1', title: 'CVI', extractedTextPreview: text });
  // The reviewer's case: nothing on the paper dates the certificate itself.
  const radar = buildExpiryRadar(
    [cvi('Health certificate\nInspection Date: 2026-05-01\nRabies vaccination certificate valid through 05/01/2027')],
    horses,
    NOW,
  );
  assert.equal(radar.items[0]?.expiresOn, '2026-05-31', 'the inspection window, not the rabies date');
  assert.equal(radar.items[0]?.urgency, 'expired');
  assert.equal(radar.currentCount, 0);
  assert.equal(radar.attentionCount, 1);
  assert.equal(
    buildExpiryRadar(
      [cvi('Health certificate\nInspection Date: 2026-05-01\nCoggins test certificate valid through 04/20/2027')],
      horses,
      NOW,
    ).items[0]?.expiresOn,
    '2026-05-31',
  );

  // Beside the certificate's own date, the component certificate neither wins nor makes the dates "disagree".
  assert.equal(
    buildExpiryRadar(
      [
        cvi(
          'Health certificate\nThis certificate is valid through 07/15/2026\nRabies vaccination certificate valid through 05/01/2027',
        ),
      ],
      horses,
      NOW,
    ).items[0]?.expiresOn,
    '2026-07-15',
  );
  // A bare "Certificate …" label that starts its own field is still the certificate's.
  for (const text of [
    'Certificate of Veterinary Inspection\nCertificate expiration date: 07/15/2026',
    'Health certificate  Certificate expiration date: 07/15/2026',
  ]) {
    assert.equal(
      buildExpiryRadar(
        [doc({ type: 'Vet Record', horseId: 'h1', extractedTextPreview: text, entities: { examDate: '2026-05-01' } })],
        horses,
        NOW,
      ).items[0]?.expiresOn,
      '2026-07-15',
      text,
    );
  }
});

test('a policy or agreement that mentions a health certificate keeps its own identity', () => {
  // The reviewer's case: the paper's name says what it is; a line in its body
  // about bringing a health certificate does not make it one.
  const agreement = doc({
    type: 'Registration',
    horseId: 'h2',
    title: 'Stallion Service Agreement',
    extractedTextPreview:
      'Stallion service agreement. A current health certificate is required before arrival. Agreement ends 06/10/2026',
  });
  const policy = doc({
    type: 'Registration',
    horseId: 'h1',
    title: 'Farm Liability Policy',
    extractedTextPreview:
      'Coverage requires a current CVI for every horse on the premises. Expiration Date: 06/15/2026',
  });
  const certificate = doc({
    type: 'Registration',
    horseId: 'h3',
    title: 'CVI',
    extractedTextPreview: 'Certificate of Veterinary Inspection  Owner carries mortality insurance policy number EQ-1',
    entities: { examDate: '2026-06-10' },
  });
  assert.equal(expiryKindOf(agreement), 'Contract');
  assert.equal(expiryKindOf(policy), 'Insurance');
  assert.equal(expiryKindOf(certificate), 'Health certificate');

  const radar = buildExpiryRadar([agreement, policy], horses, NOW);
  assert.deepEqual(
    radar.expired.map((item) => [item.documentId, item.kind]).sort(),
    [
      [agreement.id, 'Contract'],
      [policy.id, 'Insurance'],
    ].sort(),
  );
  assert.equal(expiryReminderItems(radar, []).length, 2, 'both stay in the attention set');

  // With no name to go on and a body that points two ways, the radar refuses
  // rather than presenting the paper as the wrong kind.
  assert.equal(expiryKindOf({ ...agreement, title: 'scan0046' }), null);
  assert.equal(
    expiryKindOf({
      ...policy,
      title: 'scan0047',
      extractedTextPreview: `Insurance policy number EQ-2. ${policy.extractedTextPreview}`,
    }),
    null,
  );
  // A name that itself points two ways is refused too.
  assert.equal(expiryKindOf({ ...agreement, title: 'CVI and Lease Agreement' }), null);
});

test('a CVI’s own expiry field on its own line counts; a component’s expiry never does', () => {
  const cvi = (text: string) => doc({ type: 'Vet Record', horseId: 'h1', title: 'CVI', extractedTextPreview: text });
  const dated = (text: string) => buildExpiryRadar([cvi(text)], horses, NOW).items[0]?.expiresOn;
  // An eCVI prints its own validity as a field of its own, not beside the certificate's name.
  assert.equal(
    dated('Certificate of Veterinary Inspection\nInspection Date: 05/01/2026\nExpiration Date: 07/15/2026'),
    '2026-07-15',
  );
  assert.equal(dated('Health certificate\nInspection Date: 2026-05-01\nValid Through: 07/15/2026'), '2026-07-15');
  // Still refused: a label that follows a vaccine or test on its line, including across a table's column gap.
  assert.equal(
    dated('Health certificate\nInspection Date: 2026-05-01\nRabies vaccination expires 05/01/2027'),
    '2026-05-31',
  );
  assert.equal(
    dated('Health certificate\nInspection Date: 2026-05-01\nRabies  05/01/2026  Expires 05/01/2027'),
    '2026-05-31',
  );
  // Two expiry fields that disagree are a guess; the inspection window is used.
  assert.equal(
    dated('Health certificate\nInspection Date: 2026-05-01\nExpiration Date: 07/15/2026\nExpires: 05/01/2027'),
    '2026-05-31',
  );
});

test('a line naming a policy, contract or term is never a CVI’s own expiry', () => {
  // The standalone-field rule takes validity labels a certificate uses for
  // itself ("Expiration Date", "Valid Through"), not labels that name another
  // paper. A line break doesn't make a policy's expiry the certificate's.
  const dated = (line: string) =>
    buildExpiryRadar(
      [
        doc({
          type: 'Vet Record',
          horseId: 'h1',
          title: 'CVI',
          extractedTextPreview: `Certificate of Veterinary Inspection\nInspection Date: 05/01/2026\n${line}`,
        }),
      ],
      horses,
      NOW,
    );
  for (const line of [
    'Policy expires 05/01/2027',
    'Contract ends 05/01/2027',
    'Agreement ends 05/01/2027',
    'Coverage expires 05/01/2027',
    'Term ends 05/01/2027',
    'End date: 05/01/2027',
    'Termination date: 05/01/2027',
  ]) {
    const radar = dated(line);
    assert.equal(radar.items[0]?.expiresOn, '2026-05-31', line);
    assert.equal(radar.attentionCount, 1, line);
  }
  // The control beside them: the certificate's own validity field still counts.
  for (const line of ['Expiration Date: 07/15/2026', 'Valid Through: 07/15/2026', 'Exp. Date: 07/15/2026']) {
    assert.equal(dated(line).items[0]?.expiresOn, '2026-07-15', line);
  }
});

test('a validity field counts only in the certificate’s own header, never inside a vaccine, test or lab section', () => {
  const dated = (body: string) =>
    buildExpiryRadar(
      [
        doc({
          type: 'Vet Record',
          horseId: 'h1',
          title: 'CVI',
          extractedTextPreview: `Certificate of Veterinary Inspection\nInspection Date: 05/01/2026\n${body}`,
        }),
      ],
      horses,
      NOW,
    ).items[0]?.expiresOn;
  // Codex's case: the component is named on the line above its own expiry field.
  assert.equal(dated('Rabies Vaccination\nExpiration Date: 05/01/2027'), '2026-05-31');
  // A component section a few fields long, and one whose disease XBAR doesn't know, named only by its fields.
  assert.equal(
    dated('Rabies Vaccination\nVaccine: Imrab 3\nDate Given: 05/01/2026\nExpiration Date: 05/01/2027'),
    '2026-05-31',
  );
  assert.equal(dated('Potomac Horse Fever\nLot No. 12345\nExpiration Date: 05/01/2027'), '2026-05-31');
  assert.equal(dated('EIA Test Date: 01/01/2026\nExpiration Date: 01/01/2027'), '2026-05-31');
  // The certificate's own field, before any component section, still counts — and the one inside the section doesn't.
  assert.equal(dated('Expiration Date: 07/15/2026\nRabies Vaccination\nExpiration Date: 05/01/2027'), '2026-07-15');
  assert.equal(dated('Expiration Date: 07/15/2026'), '2026-07-15');
  // The header starts at the certificate's name: a test named above it, on a cover line, doesn't disqualify it.
  const withCover = doc({
    type: 'Vet Record',
    horseId: 'h1',
    title: 'CVI',
    extractedTextPreview:
      'EIA test attached\nCertificate of Veterinary Inspection\nInspection Date: 05/01/2026\nExpiration Date: 07/15/2026',
    entities: { examDate: '2026-05-01' },
  });
  assert.equal(buildExpiryRadar([withCover], horses, NOW).items[0]?.expiresOn, '2026-07-15');
});

test('with no name to go on, a paper is what its heading says, not what its body mentions', () => {
  const unnamed = (text: string) =>
    doc({ type: 'Registration', horseId: 'h2', title: 'scan0046', extractedTextPreview: text });
  // The reviewers' case: a CVI mentioned in the body of a purchase agreement.
  const purchase = unnamed(
    'Horse Purchase Agreement\nA current CVI is required before delivery.\nExpiration Date: 07/15/2026',
  );
  assert.notEqual(expiryKindOf(purchase), 'Health certificate');
  assert.equal(expiryKindOf(purchase), 'Contract', 'its heading says what it is');
  const item = buildExpiryRadar([purchase], horses, NOW).items[0];
  assert.equal(item?.kind, 'Contract');
  assert.equal(item?.expiresOn, '2026-07-15');
  // A health certificate mentioned in the body of a paper with no identifying heading is not a certificate.
  assert.equal(
    expiryKindOf(unnamed('Buyer: J. Smith\nA current health certificate is required before delivery.')),
    null,
  );
  // A real CVI under an agency heading is still recognised by its formal name.
  assert.equal(
    expiryKindOf(
      unnamed('TEXAS ANIMAL HEALTH COMMISSION\nCertificate of Veterinary Inspection\nInspection Date: 06/10/2026'),
    ),
    'Health certificate',
  );
  // A heading that names one kind, and a body that proves another, is refused.
  assert.equal(expiryKindOf(unnamed('Horse Purchase Agreement\nCertificate of Veterinary Inspection attached')), null);
});

/*
 * Every CVI expiry case raised across #240 and #249, in one place, each
 * asserting what a person reading the paper would say. A change to how a
 * certificate is dated is done when every row passes — not the row that
 * prompted it. A new case gets a new row.
 *
 * Each paper is a Ready vet record titled CVI with a 05/01/2026 inspection,
 * so the 30-day window gives 2026-05-31; a row expecting that is one where the
 * paper gives no date the certificate owns.
 */
const CVI_EXPIRY_CORPUS: Array<[string, string, string]> = [
  // Dates the certificate gives for itself.
  ['formal name, valid until', 'Certificate of Veterinary Inspection valid until July 15, 2026', '2026-07-15'],
  ['formal name with (CVI)', 'Certificate of Veterinary Inspection (CVI) valid until 07/15/2026', '2026-07-15'],
  ['interstate health certificate', 'Interstate health certificate valid through 07/15/2026', '2026-07-15'],
  ['this certificate', 'Health certificate\nThis certificate is valid through 07/15/2026', '2026-07-15'],
  ['CVI valid until', 'CVI valid until July 15, 2026', '2026-07-15'],
  [
    'formal name directly above its own field',
    'Certificate of Veterinary Inspection\nExpiration Date: 07/15/2026',
    '2026-07-15',
  ],
  [
    'bare label opening a line',
    'Certificate of Veterinary Inspection\nCertificate expiration date: 07/15/2026',
    '2026-07-15',
  ],
  ['bare label after a column gap', 'Health certificate  Certificate expiration date: 07/15/2026', '2026-07-15'],
  [
    'Expiration Date field in the header',
    'Certificate of Veterinary Inspection\nInspection Date: 05/01/2026\nExpiration Date: 07/15/2026',
    '2026-07-15',
  ],
  ['Valid Through field in the header', 'Health certificate\nValid Through: 07/15/2026', '2026-07-15'],
  ['Exp. Date field in the header', 'Health certificate\nExp. Date: 07/15/2026', '2026-07-15'],
  [
    'header field, then a vaccine section',
    'Health certificate\nExpiration Date: 07/15/2026\nRabies Vaccination\nExpiration Date: 05/01/2027',
    '2026-07-15',
  ],
  [
    'test on a cover line above the heading',
    'EIA test attached\nCertificate of Veterinary Inspection\nInspection Date: 05/01/2026\nExpiration Date: 07/15/2026',
    '2026-07-15',
  ],
  [
    'own date beside a rabies expiry',
    'Certificate of Veterinary Inspection expires 07/15/2026  Rabies vaccination expires 05/01/2027',
    '2026-07-15',
  ],
  [
    'own date beside a rabies certificate',
    'Health certificate\nThis certificate is valid through 07/15/2026\nRabies vaccination certificate valid through 05/01/2027',
    '2026-07-15',
  ],
  // Dates that belong to something else: the inspection window applies.
  [
    'rabies expiry on its line',
    'Certificate of Veterinary Inspection  Rabies vaccination expires 05/01/2027',
    '2026-05-31',
  ],
  ['EIA test valid through', 'Health certificate  EIA test valid through 04/20/2027', '2026-05-31'],
  [
    'rabies certificate mid-line',
    'Health certificate\nRabies vaccination certificate valid through 05/01/2027',
    '2026-05-31',
  ],
  ['Coggins test certificate', 'Health certificate\nCoggins test certificate valid through 04/20/2027', '2026-05-31'],
  ['table column gap', 'Health certificate\nRabies  05/01/2026  Expires 05/01/2027', '2026-05-31'],
  [
    'component named on the line above',
    'Health certificate\nRabies Vaccination\nExpiration Date: 05/01/2027',
    '2026-05-31',
  ],
  [
    'multi-field vaccine section',
    'Health certificate\nRabies Vaccination\nVaccine: Imrab 3\nDate Given: 05/01/2026\nExpiration Date: 05/01/2027',
    '2026-05-31',
  ],
  [
    'unlisted disease by its lot number',
    'Health certificate\nPotomac Horse Fever\nLot No. 12345\nExpiration Date: 05/01/2027',
    '2026-05-31',
  ],
  ['EIA test line', 'Health certificate\nEIA Test Date: 01/01/2026\nExpiration Date: 01/01/2027', '2026-05-31'],
  [
    'CVI mentioned inside a vaccine section',
    'Certificate of Veterinary Inspection\nRabies Vaccination\nRequired for CVI\nExpiration Date: 05/01/2027',
    '2026-05-31',
  ],
  [
    'bare label wrapped under a vaccine',
    'Certificate of Veterinary Inspection\nRabies vaccination\ncertificate valid through 05/01/2027',
    '2026-05-31',
  ],
  ['policy on its own line', 'Certificate of Veterinary Inspection\nPolicy expires 05/01/2027', '2026-05-31'],
  ['contract on its own line', 'Certificate of Veterinary Inspection\nContract ends 05/01/2027', '2026-05-31'],
  ['term on its own line', 'Certificate of Veterinary Inspection\nTerm ends 05/01/2027', '2026-05-31'],
  ['end date on its own line', 'Certificate of Veterinary Inspection\nEnd date: 05/01/2027', '2026-05-31'],
  [
    'two own dates that disagree',
    'Health certificate\nCertificate valid through 07/15/2026\nCertificate valid through 08/15/2026',
    '2026-05-31',
  ],
  [
    'certificate-prefixed field in a vaccine section',
    'Health certificate\nRabies Vaccination\nCertificate Expiration Date: 05/01/2027',
    '2026-05-31',
  ],
  [
    'two header fields that disagree',
    'Health certificate\nExpiration Date: 07/15/2026\nExpires: 05/01/2027',
    '2026-05-31',
  ],
];

test('the CVI expiry corpus: every case raised reads the way a person reading the paper would', () => {
  const failures = CVI_EXPIRY_CORPUS.flatMap(([name, text, expected]) => {
    const paper = doc({
      type: 'Vet Record',
      horseId: 'h1',
      title: 'CVI',
      extractedTextPreview: text,
      entities: { examDate: '2026-05-01' },
    });
    const actual = buildExpiryRadar([paper], horses, NOW).items[0]?.expiresOn ?? '(current, not listed)';
    return actual === expected ? [] : [`${name}: expected ${expected}, got ${actual}`];
  });
  assert.deepEqual(failures, [], `${failures.length} of ${CVI_EXPIRY_CORPUS.length} rows wrong`);
});

/*
 * Every identity case raised for papers intake couldn't place (filed as
 * Registration or Ownership Memo), in one table. The paper's name decides; with
 * no name, only its heading or an identity phrase that opens a line — a title
 * or a field — says what it is. A phrase inside a sentence is a mention.
 */
const UNPLACED_IDENTITY_CORPUS: Array<[string, string, string, string | null]> = [
  // [case, title, text, expected kind]
  ['CVI by name', 'CVI', '', 'Health certificate'],
  ['health certificate by name', 'Health Certificate', '', 'Health certificate'],
  ['mortality policy by name', 'Equine Mortality Policy', '', 'Insurance'],
  ['major medical policy by name', 'Major Medical Policy', '', 'Insurance'],
  ['insurance by name', 'Horse Insurance', '', 'Insurance'],
  ['a policy that is not insurance', 'Stable Biosecurity Policy', 'Expiration Date: 06/15/2026', null],
  ['a vaccination policy', 'Barn Vaccination Policy', '', null],
  ['a non-insurance policy heading', 'scan0048', 'Stable Biosecurity Policy\nExpiration Date: 06/15/2026', null],
  [
    'policy by name',
    'Farm Liability Policy',
    'Coverage requires a current CVI. Expiration Date: 06/15/2026',
    'Insurance',
  ],
  [
    'agreement by name',
    'Stallion Service Agreement',
    'A current health certificate is required before arrival.',
    'Contract',
  ],
  [
    'CVI by name whose body mentions insurance',
    'CVI',
    'Owner carries mortality insurance policy number EQ-1',
    'Health certificate',
  ],
  ['a name pointing two ways', 'CVI and Lease Agreement', '', null],
  ['CVI by heading', 'scan0042', 'CERTIFICATE OF VETERINARY INSPECTION  Origin: Texas', 'Health certificate'],
  [
    'CVI under an agency heading',
    'scan0042',
    'TEXAS ANIMAL HEALTH COMMISSION\nCertificate of Veterinary Inspection\nInspection Date: 06/10/2026',
    'Health certificate',
  ],
  ['policy by heading', 'scan0043', 'Equine Mortality Insurance Policy  Policy Number EQ-4471', 'Insurance'],
  [
    'policy by its number field',
    'scan0043',
    'Blue River Mutual\nPolicy Number: EQ-4471\nExpiration Date: 09/01/2026',
    'Insurance',
  ],
  ['lease by heading', 'upload', 'Mare Lease Agreement  Term ends 12/31/2026', 'Contract'],
  [
    'purchase agreement mentioning a CVI',
    'scan0046',
    'Horse Purchase Agreement\nA current CVI is required before delivery.',
    'Contract',
  ],
  [
    'a mention of a health certificate only',
    'scan0046',
    'Buyer: J. Smith\nA current health certificate is required before delivery.',
    null,
  ],
  [
    'a mention of the formal name only',
    'scan0046',
    'Buyer: J. Smith\nA current Certificate of Veterinary Inspection is required before delivery.\nExpiration Date: 07/15/2026',
    null,
  ],
  [
    'a mention of a lease only',
    'scan0046',
    'Buyer: J. Smith\nThis sale is subject to the existing lease agreement.',
    null,
  ],
  [
    'a mention of a policy number only',
    'scan0046',
    'Buyer: J. Smith\nBuyer will provide the policy number before delivery.',
    null,
  ],
  [
    'heading and a CVI title line disagree',
    'scan0046',
    'Horse Purchase Agreement\nCertificate of Veterinary Inspection attached',
    null,
  ],
  [
    'a heading pointing two ways',
    'scan0046',
    'Stallion service agreement. A current health certificate is required before arrival.',
    null,
  ],
  ['an expiry label with nothing to say what it is', 'scan0044', 'Expiration Date: 06/15/2026', null],
  [
    'a registration paper',
    'AQHA Registration',
    'American Quarter Horse Association  Certificate of Registration',
    null,
  ],
];

test('the unplaced-paper identity corpus: a paper is what its name or heading says, never what it mentions', () => {
  const failures = UNPLACED_IDENTITY_CORPUS.flatMap(([name, title, text, expected]) => {
    const actual = expiryKindOf({ type: 'Registration', title, extractedTextPreview: text });
    return actual === expected ? [] : [`${name}: expected ${expected}, got ${actual}`];
  });
  assert.deepEqual(failures, [], `${failures.length} of ${UNPLACED_IDENTITY_CORPUS.length} rows wrong`);
});

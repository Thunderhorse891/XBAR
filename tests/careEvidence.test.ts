import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCareBoardRows, type CareSignal } from '../src/lib/dashboardOps.js';
import type { DocumentRecord, ExpenseReceipt, HorseRecord, TimelineEvent } from '../src/types/xbar.js';

/*
 * Audit F06: the Care board read worming and dental dates from purchase
 * receipts and let a Coggins with no exam date be current from its upload day.
 * Its own controlled examples, each pinned here:
 *   - today's completed deworming or dental treatment left the board saying
 *     "No ... on record";
 *   - a wormer purchase described as not administered marked worming current;
 *   - a Ready Coggins with no exam date was current from its upload date.
 */

const NOW = new Date(2026, 9, 2, 18, 0, 0); // 2 Oct 2026, 6pm local
const day = (offset: number) => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const care = (type: string, date: string, details?: object): TimelineEvent =>
  ({
    id: `${type}-${date}`,
    date,
    title: type,
    summary: '',
    owner: 'Vet',
    category: 'Medical',
    status: type,
    ...(details ? { details } : {}),
  }) as TimelineEvent;

const horse = (medicalTimeline: TimelineEvent[] = []) =>
  ({ id: 'h1', name: 'Dun It Again', medicalTimeline }) as unknown as HorseRecord;

const coggins = (entities: Record<string, string>, uploadedAt = `${day(0)}T09:00:00Z`) =>
  ({
    id: `cog-${entities.examDate ?? 'undated'}`,
    horseId: 'h1',
    type: 'Coggins',
    state: 'Ready',
    uploadedAt,
    entities,
  }) as unknown as DocumentRecord;

const wormerReceipt = (date: string, notes: string) =>
  ({
    id: `r-${date}`,
    horseId: 'h1',
    category: 'Wormer',
    receiptDate: date,
    amount: 18,
    notes,
  }) as unknown as ExpenseReceipt;

function signal(
  horses: HorseRecord[],
  key: CareSignal['key'],
  documents: DocumentRecord[] = [],
  receipts: ExpenseReceipt[] = [],
) {
  const row = buildCareBoardRows(horses, documents, receipts, NOW)[0];
  // A horse with nothing due or near is left off the board: its signals are clear.
  return row?.signals.find((item) => item.key === key) ?? { key, status: 'clear', detail: 'all clear' };
}

test("today's logged deworming and dental make the board current", () => {
  const h = horse([care('Deworming', day(0)), care('Dental', day(0))]);
  assert.equal(signal([h], 'wormer').status, 'clear');
  assert.equal(signal([h], 'dental').status, 'clear');
});

test('a wormer purchase -- even one never given -- does not mark the horse wormed', () => {
  const receipts = [wormerReceipt(day(0), 'Bought for spring, not administered')];
  const wormer = signal([horse()], 'wormer', [], receipts);
  assert.equal(wormer.status, 'due');
  assert.equal(wormer.detail, 'No wormer on record yet');
  // Nor does a fresh purchase refresh an old deworming.
  const old = signal([horse([care('Deworming', day(-120))])], 'wormer', [], receipts);
  assert.equal(old.status, 'due');
  assert.equal(old.detail, 'Wormer overdue');
});

test('a Coggins with no exam date is not current from its upload day, and the board says why', () => {
  const undated = signal([horse()], 'coggins', [coggins({})]);
  assert.equal(undated.status, 'due');
  assert.equal(undated.detail, 'Coggins on file has no valid exam date');
  // An impossible exam date reads the same as none.
  assert.equal(signal([horse()], 'coggins', [coggins({ examDate: '2026-02-30' })]).status, 'due');
  // So does one that has not happened yet -- a mistyped year is no exam.
  const future = signal([horse()], 'coggins', [coggins({ examDate: '2062-05-01' })]);
  assert.equal(future.status, 'due');
  assert.equal(future.detail, 'Coggins on file has no valid exam date');
});

test('a dated Coggins is measured from its exam, not its upload', () => {
  assert.equal(
    signal([horse()], 'coggins', [coggins({ examDate: day(-100) }, `${day(-1)}T09:00:00Z`)]).status,
    'clear',
  );
  assert.equal(signal([horse()], 'coggins', [coggins({ examDate: day(-330) })]).status, 'watch');
  // Uploaded today, examined 400 days ago: overdue.
  assert.equal(signal([horse()], 'coggins', [coggins({ examDate: day(-400) })]).status, 'due');
});

test('a care date still ahead is a plan, not care given', () => {
  const planned = signal([horse([care('Deworming', day(3))])], 'wormer');
  assert.equal(planned.status, 'due');
  assert.equal(planned.detail, 'No wormer on record yet');
});

test('a care date that is not a real day is no care at all', () => {
  // 2026-09-31 would be read by Date as 1 October -- yesterday -- and score as current.
  const impossible = signal([horse([care('Deworming', '2026-09-31')])], 'wormer');
  assert.equal(impossible.status, 'due');
  assert.equal(impossible.detail, 'No wormer on record yet');
  // Nor can it outrank a real, older entry.
  const withReal = signal([horse([care('Dental', '2026-02-30'), care('Dental', day(-400))])], 'dental');
  assert.equal(withReal.status, 'due');
  assert.equal(withReal.detail, 'Dental float overdue');
});

test('structured records count by type, and the latest one decides', () => {
  const structured = horse([
    { ...care('Historical note', day(-200)), details: { recordType: 'deworming' } } as TimelineEvent,
    care('Deworming', day(-10)),
  ]);
  assert.equal(signal([structured], 'wormer').status, 'clear');
  // A note that merely mentions worming is not a deworming.
  const note = horse([{ ...care('Historical note', day(0)), title: 'Talked about worming' } as TimelineEvent]);
  assert.equal(signal([note], 'wormer').status, 'due');
});

test('malformed timestamp cannot hide an older valid care record', () => {
  const h = horse([care('Deworming', `${day(-1)}Tgarbage`), care('Deworming', day(-10))]);
  assert.equal(signal([h], 'wormer').status, 'clear');
  assert.equal(signal([horse([care('Dental', `${day(-1)}Tgarbage`)])], 'dental').status, 'due');
});

test('Medical initializes logged care on the local calendar day', async () => {
  const { readFile } = await import('node:fs/promises');
  const medical = await readFile('src/routes/Medical.tsx', 'utf8');
  assert.match(medical, /\[eventDate, setEventDate\] = useState\(\(\) => localIsoDate\(\)\)/);
  const previousTz = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const { localIsoDate } = await import('../src/lib/format.js');
    const evening = new Date('2026-10-03T02:00:00Z');
    const date = localIsoDate(evening);
    assert.equal(date, '2026-10-02');
    const rows = buildCareBoardRows([horse([care('Deworming', date), care('Dental', date)])], [], [], evening);
    assert.equal(rows[0]?.signals.find((item) => item.key === 'wormer')?.status, 'clear');
    assert.equal(rows[0]?.signals.find((item) => item.key === 'dental')?.status, 'clear');
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
});

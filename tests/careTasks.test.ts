import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCareTasks } from '../src/lib/careTasks.js';
import { localIsoDate } from '../src/lib/format.js';
import {
  addTaskDays,
  isCalendarDay,
  loadTaskDeferrals,
  readTaskDeferrals,
  restoreTaskDeferrals,
  taskDeferralEntryKey,
  taskDeferralsKey,
  taskIsDeferred,
  writeTaskDeferral,
} from '../src/lib/taskDeferrals.js';
import type { DocumentRecord, HorseRecord, SalesLead } from '../src/types/xbar.js';

const TODAY = '2026-10-05';
const horse = (id: string, segment: HorseRecord['segment']) => ({ id, name: id, segment }) as HorseRecord;
const lead = (id: string, horseId: string, date: string, stage: SalesLead['stage'] = 'New') =>
  ({ id, horseId, name: id, stage, nextFollowUp: date }) as SalesLead;
const input = {
  horses: [horse('young', 'Young Stock'), horse('mare', 'Broodmare')],
  documents: [],
  ownershipRecords: [],
  expenseReceipts: [],
  salesLeads: [
    lead('due', 'young', TODAY),
    lead('overdue', 'mare', '2026-10-04'),
    lead('future', 'young', '2026-10-06'),
    lead('closed', 'young', TODAY, 'Closed'),
  ],
};
const now = new Date(2026, 9, 5, 12);
const task = buildCareTasks(input, now).find((item) => item.id === 'lead-due')!;
const other = buildCareTasks(input, now).find((item) => item.id === 'lead-overdue')!;
const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};
function inZone(zone: string, run: () => void) {
  const previous = process.env.TZ;
  try {
    process.env.TZ = zone;
    run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('Today excludes future/closed buyers and includes due/overdue throughout each local day', () => {
  for (const zone of ['UTC', 'America/Chicago', 'Pacific/Auckland', 'Pacific/Kiritimati'])
    inZone(zone, () => {
      for (const hour of [0, 12, 23])
        assert.deepEqual(
          buildCareTasks(input, new Date(2026, 9, 5, hour, 30))
            .filter((item) => item.category === 'Sales')
            .map((item) => item.id),
          ['lead-due', 'lead-overdue'],
        );
    });
});
test('segment filtering covers care, ownership, documents and buyer work and omits archived horses', () => {
  const selected = buildCareTasks({ ...input, segment: 'Young Stock' }, now);
  assert.ok(selected.length);
  assert.ok(selected.every((item) => !item.id.includes('mare') && item.id !== other.id));
  assert.equal(buildCareTasks({ ...input, segment: 'unknown' }, now).length, 0);
  assert.equal(
    buildCareTasks(
      { ...input, horses: input.horses.map((item) => ({ ...item, archive: { id: 'a', archivedAt: TODAY } })) },
      now,
    ).length,
    0,
  );
});
test('a saved snooze survives reload, expires on the chosen date and never completes its source', () => {
  const storage = memoryStorage();
  const until = addTaskDays(TODAY, 3);
  assert.equal(writeTaskDeferral(storage, 'scope', task, until, TODAY).ok, true);
  const reloaded = loadTaskDeferrals(storage, 'scope', [task], TODAY);
  assert.equal(taskIsDeferred(reloaded, task, TODAY), true);
  assert.equal(taskIsDeferred(reloaded, task, until), false);
  assert.deepEqual(loadTaskDeferrals(storage, 'scope', [task], until), {});
  assert.equal(input.salesLeads[0].nextFollowUp, TODAY);
});
test('changed work resurfaces before the deadline and resolved follow-ups disappear', () => {
  const stored = { [task.id]: { revision: task.revision, until: addTaskDays(TODAY, 7) } };
  const changed = buildCareTasks(
    { ...input, salesLeads: [{ ...input.salesLeads[0], notes: 'Call requested today' }] },
    now,
  ).find((item) => item.id === task.id)!;
  assert.notEqual(changed.revision, task.revision);
  assert.equal(taskIsDeferred(stored, changed, TODAY), false);
  assert.equal(
    buildCareTasks({ ...input, salesLeads: [{ ...input.salesLeads[0], nextFollowUp: '2026-10-10' }] }, now).some(
      (item) => item.id === task.id,
    ),
    false,
  );
});
test('same-day offer and deposit changes resurface a snoozed buyer task', () => {
  const buyer: SalesLead = {
    ...input.salesLeads[0],
    stage: 'Offer',
    lastTouch: TODAY,
    offerAmount: 10000,
    counterOfferAmount: 11000,
    offerStatus: 'Draft',
    depositAmount: 1000,
    depositStatus: 'Not Requested',
    offerUpdatedAt: `${TODAY}T10:00:00Z`,
  };
  const buyerTask = (record: SalesLead) =>
    buildCareTasks({ ...input, salesLeads: [record] }, now).find((item) => item.id === task.id)!;
  const original = buyerTask(buyer);
  const storage = memoryStorage();
  assert.equal(writeTaskDeferral(storage, 'scope', original, addTaskDays(TODAY, 7), TODAY).ok, true);
  const saved = loadTaskDeferrals(storage, 'scope', [original], TODAY);
  assert.equal(taskIsDeferred(saved, buyerTask({ ...buyer }), TODAY), true);
  const changes: Partial<SalesLead>[] = [
    { offerAmount: 12000 },
    { counterOfferAmount: 12500 },
    { offerStatus: 'Submitted' },
    { offerStatus: 'Countered' },
    { offerStatus: 'Deposit Due' },
    { depositAmount: 1500 },
    { depositStatus: 'Due' },
    { depositStatus: 'Paid' },
    { offerUpdatedAt: `${TODAY}T11:00:00Z` },
  ];
  for (const change of changes) {
    const updated = buyerTask({ ...buyer, ...change });
    assert.equal(updated.id, original.id);
    assert.equal(updated.due, original.due);
    assert.equal(taskIsDeferred(saved, updated, TODAY), false, JSON.stringify(change));
  }
});
test('malformed and oversized deadlines cannot hide work', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-05T00:00:00Z', 'tomorrow'])
    assert.equal(isCalendarDay(date), false, date);
  assert.equal(isCalendarDay('2028-02-29'), true);
  for (const raw of [
    null,
    '',
    'null',
    '[]',
    '42',
    '{broken',
    JSON.stringify({ [task.id]: { revision: task.revision, until: '2099-01-01' } }),
    JSON.stringify({ [task.id]: { revision: 'invalid', until: '2026-10-06' } }),
  ])
    assert.deepEqual(readTaskDeferrals(raw, TODAY), {});
  assert.equal(writeTaskDeferral(memoryStorage(), 'scope', task, '2026-10-13', TODAY).ok, false);
});
test('calendar addition handles DST, month/year boundaries and leap days', () => {
  for (const zone of ['America/Chicago', 'Pacific/Auckland', 'Pacific/Kiritimati'])
    inZone(zone, () => {
      assert.equal(addTaskDays('2026-10-31', 3), '2026-11-03');
      assert.equal(addTaskDays('2026-03-07', 3), '2026-03-10');
      assert.equal(addTaskDays('2026-12-31', 1), '2027-01-01');
      assert.equal(addTaskDays('2028-02-28', 1), '2028-02-29');
    });
});
test('browser keys isolate exact workspace, member and replacement local workspace', () => {
  const keys = [
    taskDeferralsKey('ranch-a', 'user-a', ''),
    taskDeferralsKey('ranch-b', 'user-a', ''),
    taskDeferralsKey('ranch-a', 'user-b', ''),
    taskDeferralsKey('', 'user-a', ''),
    taskDeferralsKey('', '', 'created-a'),
    taskDeferralsKey('', '', 'created-b'),
  ];
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(taskDeferralsKey('ranch-a', 'user-a', 'irrelevant'), keys[0]);
});
test('restoring one group preserves other groups saved deferrals', () => {
  const storage = memoryStorage();
  writeTaskDeferral(storage, 'scope', task, '2026-10-06', TODAY);
  writeTaskDeferral(storage, 'scope', other, '2026-10-07', TODAY);
  assert.deepEqual(restoreTaskDeferrals(storage, 'scope', [task], TODAY), { ok: true, restoredIds: [task.id] });
  const reloaded = loadTaskDeferrals(storage, 'scope', [task, other], TODAY);
  assert.equal(taskIsDeferred(reloaded, task, TODAY), false);
  assert.equal(taskIsDeferred(reloaded, other, TODAY), true);
});
test('blocked or silent storage failures cannot claim a saved action', () => {
  const blocked = {
    getItem: () => {
      throw Error('blocked');
    },
    setItem: () => {
      throw Error('quota');
    },
  };
  assert.equal(writeTaskDeferral(blocked, 'scope', task, '2026-10-06', TODAY).ok, false);
  assert.equal(restoreTaskDeferrals(blocked, 'scope', [task], TODAY).ok, false);
  assert.equal(
    writeTaskDeferral({ getItem: () => null, setItem: () => undefined }, 'scope', task, '2026-10-06', TODAY).ok,
    false,
  );
  const ignoredClear = {
    getItem: () => JSON.stringify({ [task.id]: { revision: task.revision, until: '2026-10-06' } }),
    setItem: () => undefined,
  };
  assert.equal(restoreTaskDeferrals(ignoredClear, 'scope', [task], TODAY).ok, false);
});
test('documents open the actual Processing/Review stage and retain horse context', () => {
  const documents = (['Queued', 'Needs Review', 'Matched'] as const).map(
    (state, i) =>
      ({
        id: `d${i}`,
        horseId: 'young',
        title: 'Paper',
        type: 'Registration',
        state,
        uploadedAt: '2026-10-05T12:00:00Z',
        entities: {},
      }) as DocumentRecord,
  );
  const tasks = buildCareTasks({ ...input, documents, segment: 'Young Stock' }, now);
  assert.equal(tasks.find((item) => item.id === 'doc-d0')?.to, '/documents?stage=Processing&horse=young');
  for (const id of ['doc-d1', 'doc-d2'])
    assert.equal(tasks.find((item) => item.id === id)?.to, '/documents?stage=Review&horse=young');
  assert.equal(
    buildCareTasks({ ...input, documents, segment: 'Broodmare' }, now).some((item) => item.id.startsWith('doc-')),
    false,
  );
});
test('interleaved writes to different tasks retain both confirmed saves', () => {
  const base = memoryStorage();
  let inner = false;
  const interleaved = {
    getItem: base.getItem,
    setItem: (key: string, value: string) => {
      if (key === taskDeferralEntryKey('scope', task.id))
        inner = writeTaskDeferral(base, 'scope', other, '2026-10-07', TODAY).ok;
      base.setItem(key, value);
    },
  };
  assert.equal(writeTaskDeferral(interleaved, 'scope', task, '2026-10-06', TODAY).ok, true);
  assert.equal(inner, true);
  assert.equal(Object.keys(loadTaskDeferrals(base, 'scope', [task, other], TODAY)).length, 2);
});
test('interleaved restores never resurrect another tab restored task', () => {
  const base = memoryStorage();
  writeTaskDeferral(base, 'scope', task, '2026-10-06', TODAY);
  writeTaskDeferral(base, 'scope', other, '2026-10-07', TODAY);
  let inner = false;
  const interleaved = {
    setItem: base.setItem,
    getItem: (key: string) => {
      const value = base.getItem(key);
      if (key === taskDeferralEntryKey('scope', task.id) && !inner)
        inner = restoreTaskDeferrals(base, 'scope', [other], TODAY).ok;
      return value;
    },
  };
  assert.equal(restoreTaskDeferrals(interleaved, 'scope', [task], TODAY).ok, true);
  assert.equal(inner, true);
  assert.deepEqual(loadTaskDeferrals(base, 'scope', [task, other], TODAY), {});
});
test('partial restore reports only verified progress', () => {
  const base = memoryStorage();
  writeTaskDeferral(base, 'scope', task, '2026-10-06', TODAY);
  writeTaskDeferral(base, 'scope', other, '2026-10-07', TODAY);
  const storage = {
    getItem: base.getItem,
    setItem: (key: string, value: string) => {
      if (key === taskDeferralEntryKey('scope', other.id)) throw Error('blocked');
      base.setItem(key, value);
    },
  };
  assert.deepEqual(restoreTaskDeferrals(storage, 'scope', [task, other], TODAY), { ok: false, restoredIds: [task.id] });
  assert.deepEqual(Object.keys(loadTaskDeferrals(base, 'scope', [task, other], TODAY)), [other.id]);
});
test('buyer reassignment reveals the task in its new group', () => {
  const stored = { [task.id]: { revision: task.revision, until: '2026-10-12' } };
  const moved = buildCareTasks(
    { ...input, segment: 'Broodmare', salesLeads: [{ ...input.salesLeads[0], horseId: 'mare' }] },
    now,
  ).find((item) => item.id === task.id)!;
  assert.notEqual(moved.revision, task.revision);
  assert.equal(taskIsDeferred(stored, moved, TODAY), false);
});
test('week-long snoozes survive westward date-line travel', () => {
  const instant = new Date('2026-10-05T10:30:00Z');
  const storage = memoryStorage();
  let until = '';
  inZone('Pacific/Kiritimati', () => {
    const day = localIsoDate(instant);
    until = addTaskDays(day, 7);
    assert.equal(writeTaskDeferral(storage, 'scope', task, until, day).ok, true);
  });
  inZone('Pacific/Pago_Pago', () => {
    const day = localIsoDate(instant);
    assert.equal(addTaskDays(day, 9), until);
    assert.equal(taskIsDeferred(loadTaskDeferrals(storage, 'scope', [task], day), task, day), true);
  });
});

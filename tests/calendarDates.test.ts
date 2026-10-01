import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildAlertDigest } from '../src/lib/alertCenter.js';
import { buildCheckpoints } from '../src/lib/breedingIntelligence.js';
import { buildBuyerOfferPatch, createBuyerOfferDraft } from '../src/lib/buyerOffers.js';
import { buildCareBoardRows } from '../src/lib/dashboardOps.js';
import { CURRENT_COGGINS_DAYS, isCurrentDatedDocument } from '../src/lib/documentCurrency.js';
import { completeFollowUp, followUpTiming, scheduleBuyerActivityFollowUp } from '../src/lib/salesFollowUp.js';
import type { BuyerRoomEvent, DocumentRecord, ExpenseReceipt, HorseRecord, SalesLead } from '../src/types/xbar.js';

/*
 * A calendar day is the user's day, wherever they are and whatever the clock
 * says. Audit F16.
 *
 * The app mixed the local start of a day with the UTC date of an instant. West
 * of UTC every evening is already tomorrow in UTC, so at 8:30pm in Chicago a
 * completed follow-up was recorded as done the next day, "same day" buyer work
 * was scheduled for tomorrow, a breeding checkpoint due today read as overdue,
 * and dismissed care tasks came back. East of UTC it went the other way each
 * morning.
 *
 * CI runs in UTC, where the two agree, which is how this went unseen. So this
 * file moves the process between zones itself — Node re-reads `TZ` whenever it
 * is assigned — and asks each question at several hours of the same local day.
 */

const ZONES = [
  'UTC',
  'America/Chicago', // UTC-5 in September: the audit's evening case
  'Pacific/Pago_Pago', // UTC-11
  'Asia/Seoul', // UTC+9: where the suite first failed
  'Pacific/Auckland', // UTC+12, +13 in its summer
  'Pacific/Kiritimati', // UTC+14
];

/** Early, morning, the audit's 8:30pm, and one minute to midnight. */
const HOURS: Array<[number, number]> = [
  [0, 30],
  [8, 0],
  [20, 30],
  [23, 59],
];

function inZone<T>(zone: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    // Assigning undefined would set the string "undefined", which is a zone.
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

/** Every hour of interest on 29 September 2026, in every zone. */
function eachLocalMoment(check: (now: Date, where: string) => void, day = 29, month = 8) {
  for (const zone of ZONES) {
    inZone(zone, () => {
      for (const [hour, minute] of HOURS) {
        check(new Date(2026, month, day, hour, minute), `${zone} ${hour}:${String(minute).padStart(2, '0')}`);
      }
    });
  }
}

const lead: SalesLead = {
  id: 'lead',
  name: 'Buyer',
  channel: 'Referral',
  horseId: 'horse',
  stage: 'Offer',
  lastTouch: '2026-09-01',
  savedListing: false,
  shareReady: false,
};

test("a completed follow-up is recorded on the seller's day, and the next one counted from it", () => {
  eachLocalMoment((now, where) => {
    const patch = completeFollowUp(lead, now);
    assert.equal(patch.lastTouch, '2026-09-29', where);
    assert.equal(patch.nextFollowUp, '2026-10-01', `${where}: an offer is followed up two days later`);
  });
});

test('buyer activity schedules same-day work on the same day', () => {
  eachLocalMoment((now, where) => {
    const event = { id: 'e', horseId: 'horse', kind: 'packet-downloaded', at: now.toISOString(), actor: 'Buyer' };
    const patch = scheduleBuyerActivityFollowUp(lead, event as BuyerRoomEvent, now);
    assert.equal(patch?.nextFollowUp, '2026-09-29', where);
  });
});

test('a follow-up due today reads as today all day, and yesterday’s as overdue', () => {
  eachLocalMoment((now, where) => {
    assert.equal(followUpTiming({ ...lead, nextFollowUp: '2026-09-29' }, now), 'Today', where);
    assert.equal(followUpTiming({ ...lead, nextFollowUp: '2026-09-28' }, now), 'Overdue', where);
    assert.equal(followUpTiming({ ...lead, nextFollowUp: '2026-09-30' }, now), 'Upcoming', where);
  });
});

test('a week out is a week on the calendar across a clock change', () => {
  // The day a clock falls back is 25 hours long, so local midnight plus seven
  // times 24 hours ends at 11pm the day before the one that was meant.
  const weekly = { ...lead, stage: 'New' as const };
  inZone('America/Chicago', () => {
    // US clocks fall back on 1 November 2026.
    assert.equal(completeFollowUp(weekly, new Date(2026, 9, 28, 0, 30)).nextFollowUp, '2026-11-04');
    // And spring forward on 8 March 2026.
    assert.equal(completeFollowUp(weekly, new Date(2026, 2, 5, 23, 30)).nextFollowUp, '2026-03-12');
  });
  inZone('Pacific/Auckland', () => {
    // New Zealand falls back on 5 April 2026.
    assert.equal(completeFollowUp(weekly, new Date(2026, 3, 1, 0, 30)).nextFollowUp, '2026-04-08');
  });
});

test("an offer is logged as touched on the seller's day", () => {
  eachLocalMoment((now, where) => {
    const result = buildBuyerOfferPatch({ ...createBuyerOfferDraft(), amount: '25000' }, now);
    assert.ok(result.ok, where);
    assert.equal(result.ok && result.patch.lastTouch, '2026-09-29', where);
  });
});

test("the alert digest is dated with the rancher's day", () => {
  eachLocalMoment((now, where) => {
    assert.match(buildAlertDigest([], now).emailBody, /digest — 2026-09-29/, where);
  });
});

test('a care item is due for the whole of its due day, not from noon', () => {
  // Wormed 1 July; wormer is due 90 days later, on 29 September.
  const horse = { id: 'h1', name: 'Bella' } as HorseRecord;
  const receipts = [
    { id: 'r1', horseId: 'h1', category: 'Wormer', amount: 20, receiptDate: '2026-07-01' } as ExpenseReceipt,
  ];
  const wormer = (now: Date) =>
    buildCareBoardRows([horse], [], receipts, now)[0]?.signals.find((signal) => signal.key === 'wormer');

  eachLocalMoment((now, where) => {
    assert.equal(wormer(now)?.status, 'due', `${where}: due on its due day`);
    assert.equal(wormer(now)?.dueDate, '2026-09-29', where);
  });
  eachLocalMoment((now, where) => {
    assert.equal(wormer(now)?.status, 'watch', `${where}: not yet due the day before`);
  }, 28);
});

test('a breeding checkpoint due today is not overdue until tomorrow', () => {
  // Bred 14 September; the day-15 ultrasound is due 29 September.
  const bredOn = new Date('2026-09-14');
  const ultrasound = (now: Date) => buildCheckpoints(bredOn, now).find((checkpoint) => checkpoint.dayOffset === 15);

  eachLocalMoment((now, where) => {
    assert.equal(ultrasound(now)?.dueDate, '2026-09-29', where);
    assert.equal(ultrasound(now)?.status, 'due', `${where}: due today is not overdue`);
  });
  eachLocalMoment((now, where) => {
    assert.equal(ultrasound(now)?.status, 'overdue', `${where}: overdue the next day`);
  }, 30);
});

test('a Coggins is current through the last day of its year, in every zone', () => {
  // The module's own suite runs in UTC, where "today" taken in UTC and today on
  // the viewer's calendar cannot be told apart.
  const coggins = { state: 'Ready', entities: { examDate: '2025-09-29' } } as Pick<
    DocumentRecord,
    'state' | 'entities'
  >;
  eachLocalMoment((now, where) => {
    assert.equal(isCurrentDatedDocument(coggins, CURRENT_COGGINS_DAYS, now), true, `${where}: last valid day`);
  });
  eachLocalMoment((now, where) => {
    assert.equal(isCurrentDatedDocument(coggins, CURRENT_COGGINS_DAYS, now), false, `${where}: a day past`);
  }, 30);
});

/*
 * The recurrence guard. Taking the UTC date of an instant is correct in a few
 * specific places and wrong everywhere a person's day is meant, and nothing
 * about the expression says which. So every use in src/ is listed here with its
 * reason, and a new one fails until someone decides which kind it is.
 */
const UTC_DATE_ALLOWED: Record<string, string> = {
  'src/lib/costPerHorse.ts': 'formats a UTC day number, whose day came from the local calendar',
  'src/lib/documentExpiry.ts': 'formats a UTC day number, whose day came from the local calendar',
  'src/lib/documentCurrency.ts': 'checks a written YYYY-MM-DD against its own UTC parse',
  'src/lib/breedingIntelligence.ts': 'record dates are UTC calendar days; countdowns use the local today',
  'src/lib/localSalePacketGenerator.ts': "the sealed stamp: the buyer's verifier recomputes it from sealedAt in UTC",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

test("no screen or record takes a person's day from the UTC date", () => {
  const found = new Map<string, number>();
  for (const file of sourceFiles('src')) {
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const uses = code.match(/toISOString\(\)\s*\.\s*(slice\(0,\s*10\)|substring\(0,\s*10\)|split\(['"]T['"]\))/g);
    if (uses) found.set(file.split(path.sep).join('/'), uses.length);
  }
  for (const [file, count] of found) {
    assert.ok(UTC_DATE_ALLOWED[file], `${file} takes a calendar day from the UTC date; use localIsoDate`);
    assert.equal(count, 1, `${file} has ${count} UTC dates; its allowance covers one`);
  }
  for (const file of Object.keys(UTC_DATE_ALLOWED)) {
    assert.ok(found.has(file), `${file} no longer takes a UTC date; drop its allowance`);
  }
});

test("the sealed packet stamp stays the UTC date the buyer's verifier recomputes", () => {
  // The one date that must NOT follow the seller's calendar: the verifier checks
  // the printed stamp against the sealed instant and cannot know the zone.
  const generator = readFileSync('src/lib/localSalePacketGenerator.ts', 'utf8');
  assert.match(generator, /sealedAt: now\.toISOString\(\),/);
  assert.match(generator, /const generatedAt = now\.toISOString\(\)\.slice\(0, 10\);/);
  const verifier = readFileSync('src/lib/packetVerifierScript.ts', 'utf8');
  assert.match(verifier, /var wantStamp = 'Generated ' \+ parsed\.sealedAt\.slice\(0, 10\);/);
});

test('dates stamped on records and screens come from the local calendar', () => {
  const runtime = readFileSync('src/lib/xbarRuntime.ts', 'utf8');
  assert.match(runtime, /export function todayStamp\(\) \{\s*return localIsoDate\(\);/);
  const todayWork = readFileSync('src/routes/TodayWork.tsx', 'utf8');
  assert.match(todayWork, /const dismissKey = `xbar-care-dismissed-\$\{localIsoDate\(\)\}`;/);
});

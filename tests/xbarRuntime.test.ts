import assert from 'node:assert/strict';
import test from 'node:test';
import { nowStamp } from '../src/lib/xbarRuntime.js';
import { compareTimestampDesc, formatDateLabel, formatDateTimeLabel } from '../src/lib/format.js';

// nowStamp feeds invitedAt, joinedAt, receivedAt, uploadedAt, offerUpdatedAt
// and the other audit stamps. They are synced across workspace members and
// sorted lexicographically, so they are absolute UTC ISO instants — not local
// wall clocks, which cannot be compared across time zones. Display readers
// parse the instant and format it in the viewer's local time.

test('nowStamp is an absolute UTC ISO instant', () => {
  assert.match(nowStamp(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('nowStamp is within a minute of now and sorts lexicographically', () => {
  const stamp = nowStamp();
  const parsed = new Date(stamp);
  assert.ok(!Number.isNaN(parsed.getTime()), 'must parse as an instant');
  assert.ok(Math.abs(parsed.getTime() - Date.now()) < 60_000, 'must be within a minute of now');
  const earlier = new Date(Date.now() - 3_600_000).toISOString();
  assert.ok(earlier < stamp, 'lexicographic order must match chronological order (offerUpdatedAt sorts this way)');
});

test('nowStamp round-trips through the display formatters as viewer-local time', () => {
  const stamp = nowStamp();
  assert.notEqual(formatDateTimeLabel(stamp), 'Not available');
  assert.notEqual(formatDateLabel(stamp), 'Not scheduled');
  // The UTC instant must display as the viewer's own wall clock, not as UTC.
  const expected = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date());
  assert.equal(formatDateTimeLabel(stamp), expected);
});

/*
 * The nowStamp() format transition: new writes are absolute ISO UTC instants,
 * but records written before the transition — or synced from a stale PWA tab
 * that still writes the old form — are local `YYYY-MM-DD HH:mm` wall-clock
 * with no recorded offset. Raw lexicographic order mis-sorts a later legacy
 * value behind an earlier ISO one (`'2026-09-24 20:00'` <
 * `'2026-09-24T19:40:00.000Z'` as strings, later as instants), which is
 * exactly the offerUpdatedAt ordering profitIntelligence.ts depends on. The
 * comparator interprets the legacy form AS UTC: deterministic and identical
 * on every client, where a viewer-local parse made Chicago and Los Angeles
 * order the same synced data differently. These assertions hold under any
 * TZ because they pin the UTC interpretation, not the viewer's clock.
 */
test('compareTimestampDesc interprets legacy wall-clock as UTC', () => {
  // Legacy 20:00 interpreted as UTC is EARLIER than ISO 21:00Z the same day.
  // A viewer-local parse west of UTC would order them the other way — which
  // is the cross-client disagreement this pins down.
  const legacy = '2026-09-24 20:00';
  const iso = '2026-09-24T21:00:00.000Z';
  const sorted = [legacy, iso].sort(compareTimestampDesc);
  assert.deepEqual(sorted, [iso, legacy], 'legacy wall-clock orders as its UTC instant');
});

test('compareTimestampDesc orders a later legacy stamp ahead of an earlier ISO one', () => {
  // The original lexicographic bug: '2026-09-24 20:00' < '2026-09-24T19:40'
  // as strings, but the legacy instant is later.
  const legacyLater = '2026-09-24 20:00';
  const isoEarlier = '2026-09-24T19:40:00.000Z';
  assert.ok(legacyLater < isoEarlier, 'the fixture must actually invert under lexicographic order');
  const leads = [{ offerUpdatedAt: isoEarlier }, { offerUpdatedAt: legacyLater }];
  const sorted = [...leads].sort((left, right) => compareTimestampDesc(left.offerUpdatedAt, right.offerUpdatedAt));
  assert.equal(sorted[0].offerUpdatedAt, legacyLater, 'the later instant sorts first regardless of format');
});

test('compareTimestampDesc keeps same-format order and sorts blanks last', () => {
  const a = '2026-09-24T19:40:00.000Z';
  const b = '2026-09-24T20:00:00.000Z';
  assert.ok(compareTimestampDesc(b, a) < 0, 'later instant first');
  assert.ok(compareTimestampDesc(a, b) > 0, 'earlier instant last');
  assert.ok(compareTimestampDesc(a, '') < 0, 'a real stamp beats a blank');
  assert.ok(compareTimestampDesc('', a) > 0, 'a blank sorts last');
  assert.equal(compareTimestampDesc(a, a), 0, 'equal stamps tie');
});

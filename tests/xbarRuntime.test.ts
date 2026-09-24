import assert from 'node:assert/strict';
import test from 'node:test';
import { nowStamp } from '../src/lib/xbarRuntime.js';
import { formatDateLabel, formatDateTimeLabel } from '../src/lib/format.js';

// nowStamp feeds invitedAt, joinedAt, receivedAt, uploadedAt, offerUpdatedAt
// and the other audit stamps. Every reader parses them as the viewer's LOCAL
// time, so the stamp itself must be local: the previous version stamped UTC
// without a label and arrived up to 14 hours off on screen.

function localStamp(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

test('nowStamp keeps the YYYY-MM-DD HH:MM shape', () => {
  assert.match(nowStamp(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('nowStamp reads the viewer clock, not UTC', () => {
  const stamp = nowStamp();
  assert.equal(stamp, localStamp(), 'must match the local wall clock');
  const utcShape = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const offsetMinutes = new Date().getTimezoneOffset();
  if (offsetMinutes !== 0) {
    assert.notEqual(stamp, utcShape, 'must not be the UTC stamp');
  }
});

test('nowStamp round-trips through the display formatters', () => {
  const stamp = nowStamp();
  const parsed = new Date(stamp.replace(' ', 'T'));
  assert.ok(!Number.isNaN(parsed.getTime()), 'must parse as a local datetime');
  assert.ok(Math.abs(parsed.getTime() - Date.now()) < 60_000, 'must be within a minute of now');
  assert.notEqual(formatDateTimeLabel(stamp), 'Not available');
  assert.notEqual(formatDateLabel(stamp), 'Not scheduled');
});

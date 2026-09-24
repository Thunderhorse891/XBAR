import assert from 'node:assert/strict';
import test from 'node:test';
import { nowStamp } from '../src/lib/xbarRuntime.js';
import { formatDateLabel, formatDateTimeLabel } from '../src/lib/format.js';

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

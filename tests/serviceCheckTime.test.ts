import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceCheckTime } from '../src/lib/serviceCheckTime.js';

test('the server timestamp is rendered with a timezone, including Nov 27 2026', () => {
  const utc = serviceCheckTime('2026-11-27T00:15:00Z', 'en-US', 'UTC');
  assert.equal(utc?.iso, '2026-11-27T00:15:00.000Z');
  assert.match(utc?.label ?? '', /Nov 27, 2026/);
  assert.match(utc?.label ?? '', /UTC/);
  const west = serviceCheckTime('2026-11-27T00:15:00Z', 'en-US', 'America/Los_Angeles');
  assert.match(west?.label ?? '', /Nov 26, 2026/);
  assert.match(west?.label ?? '', /PST/);
  assert.match(serviceCheckTime('2026-11-27T00:15:00Z', 'de-DE', 'UTC')?.label ?? '', /2026/);
});
test('missing, invalid and ambiguous unzoned values never become a misleading current date', () => {
  for (const value of [undefined, null, '', 'invalid', '2026-11-27', '2026-11-27T12:00:00'])
    assert.equal(serviceCheckTime(value), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/*
 * A "packet downloaded" event is a claim about the BUYER'S device.
 *
 * Every other buyer action -- a question, an offer, a proof request -- is a
 * message to the seller, and is true the moment it is sent. This one asserts
 * that a file arrived somewhere the app cannot see. So it is the one action
 * whose event must not be recorded until the save has actually reported back.
 *
 * It was recorded first. `onDownloadPacket` was a `() => void` callback invoked
 * AFTER onLocalLog had already written the event (and after the inquiry POST
 * had already been sent), then the panel announced "Buyer packet downloaded and
 * seller notified." A void callback cannot contradict a claim already made. On
 * iOS a cancelled share sheet meant no file existed, while the seller had been
 * told a buyer was holding their packet -- worse than a failed download,
 * because a seller acts on it.
 */
const source = readFileSync(path.join(process.cwd(), 'src/routes/BuyerProfile.tsx'), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('the packet download reports its outcome instead of returning void', () => {
  assert.doesNotMatch(
    code,
    /onDownloadPacket:\s*\(\)\s*=>\s*void/,
    'onDownloadPacket is void again, so the panel cannot know whether the file was saved',
  );
  assert.match(
    code,
    /onDownloadPacket:\s*\(\)\s*=>\s*Promise</,
    'onDownloadPacket no longer returns a result the caller can act on',
  );
  assert.match(code, /await onDownloadPacket\(\)/, 'the save is no longer awaited before the event is recorded');
});

test('the save is attempted before the seller is notified', () => {
  const submit = code.slice(code.indexOf('const submit'));
  const savedAt = submit.indexOf('await onDownloadPacket()');
  const loggedAt = submit.indexOf('onLocalLog({');
  const postedAt = submit.indexOf('/api/buyer/inquiries');

  assert.ok(savedAt >= 0, 'the packet save is gone from submit entirely');
  assert.ok(loggedAt >= 0 && postedAt >= 0, 'this guard is stale: submit no longer logs or posts');

  assert.ok(
    savedAt < loggedAt,
    'the local event is recorded before the save is attempted, so a cancelled save still notifies the seller',
  );
  assert.ok(
    savedAt < postedAt,
    'the inquiry is posted before the save is attempted, so a cancelled save still notifies the seller',
  );
});

test('a failed save stops the flow rather than falling through to success', () => {
  const submit = code.slice(code.indexOf('const submit'));
  const guard = submit.slice(submit.indexOf('await onDownloadPacket()'));
  const earlyReturn = guard.slice(0, guard.indexOf('if (source ==='));

  assert.match(earlyReturn, /if \(!saved\.ok\)/, 'the save result is not checked');
  assert.match(
    earlyReturn,
    /return;/,
    'a failed save does not return, so the code continues on to record the event and announce success',
  );
});

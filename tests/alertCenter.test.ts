import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAlertDigest, buildAlertMailto } from '../src/lib/alertCenter.js';
import type { OperationsPriorityItem } from '../src/lib/operationsPriority.js';

const item = (overrides: Partial<OperationsPriorityItem>): OperationsPriorityItem => ({
  id: 'alert-1',
  kind: 'Care',
  urgency: 'Due',
  title: 'Coggins for Blue',
  horseId: 'horse-1',
  horseName: 'Blue',
  dueDate: '2026-06-01',
  detail: 'Coggins overdue',
  route: '/medical?horse=horse-1',
  score: 100,
  timing: 'Overdue',
  ...overrides,
});

test('alert digest includes overdue and due-soon operational alerts', () => {
  const digest = buildAlertDigest([
    item({ id: 'overdue', timing: 'Overdue' }),
    item({ id: 'soon', timing: 'This week', urgency: 'Watch', dueDate: '2026-06-12' }),
    item({ id: 'later', timing: 'Later', urgency: 'Watch', dueDate: '2026-08-01' }),
  ], new Date('2026-06-09T12:00:00Z'));

  assert.equal(digest.alerts.length, 2);
  assert.equal(digest.overdueCount, 1);
  assert.equal(digest.dueSoonCount, 1);
  assert.match(digest.emailSubject, /1 overdue, 1 due soon/);
  assert.match(digest.emailBody, /Coggins for Blue/);
});

test('alert mailto encodes digest subject and body', () => {
  const digest = buildAlertDigest([item({})], new Date('2026-06-09T12:00:00Z'));
  const mailto = buildAlertMailto(digest, 'barn@example.com');

  assert.match(mailto, /^mailto:barn%40example\.com\?/);
  assert.match(mailto, /subject=/);
  assert.match(mailto, /body=/);
});

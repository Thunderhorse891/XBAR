import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDueDate, reminderAppOrigin } from '../../api/_lib/reminders-run.js';

/*
 * Reminder emails are buyer-facing professionalism: "Coggins test due
 * 2026-10-01" reads like a database dump, and "Open XBAR" without a link is a
 * dead end. These pin the human-readable date and the app link resolution.
 */

test('formatDueDate renders a calendar day as "October 1, 2026"', () => {
  assert.equal(formatDueDate('2026-10-01'), 'October 1, 2026');
  assert.equal(formatDueDate('2026-01-05'), 'January 5, 2026');
});

test('formatDueDate cannot shift the day in another timezone', () => {
  // Parsed at UTC noon on purpose: a bare date parsed as UTC midnight formats
  // as the previous day on servers west of UTC.
  assert.equal(formatDueDate('2026-12-31'), 'December 31, 2026');
});

test('formatDueDate passes unparseable input through rather than crashing', () => {
  assert.equal(formatDueDate('soon'), 'soon');
  assert.equal(formatDueDate(''), '');
  assert.equal(formatDueDate(null), '');
});

test('reminderAppOrigin prefers the documented server var', () => {
  const saved = { ...process.env };
  try {
    process.env.PUBLIC_APP_URL = 'https://app.example.com';
    process.env.VITE_PUBLIC_APP_URL = 'https://vite.example.com';
    process.env.VERCEL_URL = 'deploy.example.com';
    assert.equal(reminderAppOrigin(), 'https://app.example.com');

    delete process.env.PUBLIC_APP_URL;
    assert.equal(reminderAppOrigin(), 'https://vite.example.com');

    delete process.env.VITE_PUBLIC_APP_URL;
    assert.equal(reminderAppOrigin(), 'https://deploy.example.com');

    delete process.env.VERCEL_URL;
    assert.equal(reminderAppOrigin(), 'https://xbar.app');
  } finally {
    process.env = saved;
  }
});

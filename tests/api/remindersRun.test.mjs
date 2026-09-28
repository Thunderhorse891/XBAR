import assert from 'node:assert/strict';
import test from 'node:test';

import { register } from 'node:module';
register(new URL('./fixtures/remindersLoader.mjs', import.meta.url));
const { default: handler, formatDueDate, reminderAppOrigin } = await import('../../api/_lib/reminders-run.js');
const { setScenario, writes, notificationCount } = await import('./fixtures/remindersBoundary.mjs');

async function runReminder(scenario, email = false) {
  if (scenario !== undefined) setScenario(scenario);
  const saved = { ...process.env };
  process.env.CRON_SECRET = 'fixture-secret';
  delete process.env.RESEND_API_KEY;
  delete process.env.SENDGRID_API_KEY;
  if (email) process.env.RESEND_API_KEY = 'fixture-only';
  try {
    return await invokeReminder();
  } finally {
    process.env = saved;
  }
}

async function invokeReminder() {
  const res = {
    statusCode: 200,
    setHeader() {},
    end(body) {
      this.payload = JSON.parse(body);
    },
  };
  await handler({ method: 'GET', headers: { authorization: 'Bearer fixture-secret' } }, res);
  return res;
}

for (const scenario of [
  { insertResult: { data: null, error: { message: 'insert failed' } } },
  { updateResult: { data: null, error: { message: 'completion failed' } } },
  { acceptError: true },
  { claimError: true },
]) {
  test(`repeated and concurrent runs cannot resend mail after ${JSON.stringify(scenario)}`, async () => {
    setScenario(scenario);
    const savedFetch = globalThis.fetch;
    const savedEnv = { ...process.env };
    process.env.CRON_SECRET = 'fixture-secret';
    process.env.RESEND_API_KEY = 'fixture-only';
    let sends = 0;
    globalThis.fetch = async () => {
      sends += 1;
      return new Response('{}', { status: 200 });
    };
    try {
      await Promise.all([invokeReminder(), invokeReminder()]);
      await invokeReminder();
      assert.equal(sends, scenario.insertResult || scenario.claimError ? 0 : 1);
      assert.equal(notificationCount(), scenario.insertResult ? 0 : 1);
    } finally {
      globalThis.fetch = savedFetch;
      process.env = savedEnv;
    }
  });
}

test('an ambiguous provider result is held for reconciliation instead of resent', async () => {
  setScenario({});
  const savedFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async () => {
    sends += 1;
    throw new Error('connection lost after provider accepted');
  };
  try {
    const first = await runReminder(undefined, true);
    const retry = await runReminder(undefined, true);
    assert.equal(first.statusCode, 500);
    assert.equal(retry.statusCode, 500);
    assert.match(retry.payload.failures[0].message, /reconcil/i);
    assert.equal(sends, 1);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('a saved provider acceptance completes a retry without another email or notification', async () => {
  setScenario({});
  const savedFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async () => {
    sends += 1;
    return new Response('{}', { status: 200 });
  };
  try {
    const first = await runReminder(undefined, true);
    const retry = await runReminder(undefined, true);
    assert.equal(first.payload.emailed, 1);
    assert.equal(retry.payload.emailed, 0);
    assert.equal(retry.payload.completed, 1);
    assert.equal(retry.statusCode, 200);
    assert.equal(notificationCount(), 1);
    assert.equal(sends, 1);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('notification insert error is a failure and leaves the reminder retryable', async () => {
  const res = await runReminder({ insertResult: { data: null, error: { message: 'insert failed' } } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.inAppOnly, 0);
  assert.equal(res.payload.failures.length, 1);
  assert.equal(writes.filter((write) => write.table === 'reminders').length, 0);
});

for (const updateResult of [
  { data: null, error: { message: 'update failed' } },
  { data: [], error: null },
]) {
  test(`reminder completion refuses ${updateResult.error ? 'an error' : 'zero affected rows'}`, async () => {
    const res = await runReminder({ updateResult });
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.inAppOnly, 0);
    assert.equal(res.payload.failures.length, 1);
  });
}

test('only confirmed notification and reminder writes count as completed', async () => {
  const res = await runReminder({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.inAppOnly, 1);
  assert.equal(res.payload.completed, 1);
});

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

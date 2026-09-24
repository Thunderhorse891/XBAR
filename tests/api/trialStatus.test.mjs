import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TRIAL_LENGTH_DAYS,
  TRIAL_LENGTH_MS,
  TRIAL_PLAN_TIER,
  buildTrialRecord,
  decideTrialStart,
  getTrialState,
  hasTrialRecord,
  readTrialFromPayload,
  startWorkspaceTrial,
  trialDaysRemaining,
} from '../../api/_lib/trial-status.js';

/*
 * The 14-day Professional trial, server side.
 *
 * No Stripe involvement: no card, no subscription object, no webhook. The
 * trial is a record on the workspace's subscription profile, and every
 * entitlement read evaluates the window at that moment — expiry needs no job.
 */

const NOW_MS = Date.parse('2026-09-24T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function trialPayload(startedAt, endsAt, plan = 'Professional') {
  return { trial: { startedAt, endsAt, plan } };
}

function activePayload() {
  const startedAt = new Date(NOW_MS).toISOString();
  const endsAt = new Date(NOW_MS + TRIAL_LENGTH_MS).toISOString();
  return trialPayload(startedAt, endsAt);
}

test('the trial policy is a 14-day Professional grant', () => {
  assert.equal(TRIAL_PLAN_TIER, 'Professional');
  assert.equal(TRIAL_LENGTH_DAYS, 14);
  assert.equal(TRIAL_LENGTH_MS, 14 * DAY_MS);
});

test('buildTrialRecord derives the window from the server clock', () => {
  const trial = buildTrialRecord(NOW_MS);
  assert.equal(trial.plan, 'Professional');
  assert.equal(Date.parse(trial.endsAt) - Date.parse(trial.startedAt), TRIAL_LENGTH_MS);
  assert.equal(trial.startedAt, new Date(NOW_MS).toISOString());
});

test('an active trial reads active with the right days remaining', () => {
  const trial = readTrialFromPayload(activePayload());
  assert.ok(trial);
  assert.equal(getTrialState(trial, NOW_MS), 'active');
  assert.equal(trialDaysRemaining(trial, NOW_MS), 14);
  assert.equal(getTrialState(trial, NOW_MS + 13.5 * DAY_MS), 'active');
  assert.equal(trialDaysRemaining(trial, NOW_MS + 13.5 * DAY_MS), 1);
});

test('the trial lapses the instant the window passes', () => {
  const trial = readTrialFromPayload(activePayload());
  assert.ok(trial);
  const end = trial.endsAt.getTime();
  assert.equal(getTrialState(trial, end - 1), 'active');
  assert.equal(getTrialState(trial, end), 'expired');
  assert.equal(getTrialState(trial, end + DAY_MS), 'expired');
  assert.equal(trialDaysRemaining(trial, end), 0);
});

test('a future-dated trial has not started', () => {
  const payload = trialPayload(new Date(NOW_MS + DAY_MS).toISOString(), new Date(NOW_MS + 15 * DAY_MS).toISOString());
  const trial = readTrialFromPayload(payload);
  assert.ok(trial);
  assert.equal(getTrialState(trial, NOW_MS), 'none');
});

test('malformed records grant nothing', () => {
  assert.equal(readTrialFromPayload({}), null);
  assert.equal(readTrialFromPayload({ trial: 'yes' }), null);
  assert.equal(readTrialFromPayload({ trial: { startedAt: 'garbage' } }), null);
  assert.equal(readTrialFromPayload(trialPayload('2026-09-24T12:00:00Z', 'not-a-date')), null);
  // The wrong plan is not a trial.
  assert.equal(
    readTrialFromPayload(
      trialPayload(new Date(NOW_MS).toISOString(), new Date(NOW_MS + DAY_MS).toISOString(), 'Enterprise'),
    ),
    null,
  );
  // A window longer than the policy allows was not written by the server.
  assert.equal(
    readTrialFromPayload(trialPayload(new Date(NOW_MS).toISOString(), new Date(NOW_MS + 90 * DAY_MS).toISOString())),
    null,
  );
  // Ends before it starts.
  assert.equal(
    readTrialFromPayload(trialPayload(new Date(NOW_MS).toISOString(), new Date(NOW_MS - DAY_MS).toISOString())),
    null,
  );
});

test('hasTrialRecord blocks restarts even for malformed records', () => {
  assert.equal(hasTrialRecord({}), false);
  assert.equal(hasTrialRecord({ trial: { startedAt: 'garbage', endsAt: 'worse' } }), true);
  assert.equal(hasTrialRecord(activePayload()), true);
  assert.equal(hasTrialRecord({ trial: 'yes' }), false);
});

test('decideTrialStart allows a fresh workspace', () => {
  assert.deepEqual(decideTrialStart(null), { ok: true });
  assert.deepEqual(decideTrialStart(undefined), { ok: true });
  assert.deepEqual(decideTrialStart({ tier: 'Starter', billing_state: 'Inactive', payload: {} }), { ok: true });
});

test('decideTrialStart refuses an already-used trial, active or expired', () => {
  const active = decideTrialStart({ tier: 'Starter', billing_state: 'Inactive', payload: activePayload() });
  assert.equal(active.ok, false);
  assert.equal(active.code, 'trial_already_used');
  assert.equal(active.status, 409);

  const oldStart = new Date(NOW_MS - 30 * DAY_MS).toISOString();
  const oldEnd = new Date(NOW_MS - 16 * DAY_MS).toISOString();
  const expired = decideTrialStart({
    tier: 'Starter',
    billing_state: 'Inactive',
    payload: trialPayload(oldStart, oldEnd),
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'trial_already_used');

  // Malformed but present: still used.
  const malformed = decideTrialStart({
    tier: 'Starter',
    billing_state: 'Inactive',
    payload: { trial: { startedAt: 'garbage' } },
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, 'trial_already_used');
});

test('decideTrialStart refuses a workspace already entitled to paid features', () => {
  const active = decideTrialStart({ tier: 'Professional', billing_state: 'Active', payload: {} });
  assert.equal(active.ok, false);
  assert.equal(active.code, 'already_entitled');
  assert.equal(active.status, 409);

  const comped = decideTrialStart({ tier: 'Enterprise', billing_state: 'Manual Billing', payload: {} });
  assert.equal(comped.ok, false);
  assert.equal(comped.code, 'already_entitled');
});

test('decideTrialStart allows a lapsed subscription to trial', () => {
  // Past Due / Inactive resolve to the baseline, so a former customer may trial.
  assert.deepEqual(decideTrialStart({ tier: 'Ranch Ops', billing_state: 'Past Due', payload: {} }), { ok: true });
  assert.deepEqual(decideTrialStart({ tier: 'Professional', billing_state: 'Inactive', payload: {} }), { ok: true });
});

/*
 * startWorkspaceTrial with a fake supabase client.
 *
 * The fake speaks the chained query-builder dialect the function uses
 * (from/select/eq/maybeSingle/update/filter/insert). Anything unexpected
 * throws, so a change in the query shape fails loudly here instead of
 * silently issuing a different query.
 */

function fakeSupabase(
  {
    row = null,
    readError = null,
    updateResult = [{ workspace_id: 'ws-1' }],
    updateError = null,
    insertError = null,
  } = {},
  observed = {},
) {
  const builder = {
    select(columns) {
      observed.select = columns;
      return builder;
    },
    eq(field, value) {
      observed.eq = [field, value];
      return builder;
    },
    filter(column, operator, value) {
      observed.filter = [column, operator, value];
      return builder;
    },
    maybeSingle() {
      if (readError) return Promise.resolve({ data: null, error: readError });
      return Promise.resolve({ data: row, error: null });
    },
  };
  return {
    from(table) {
      observed.table = table;
      assert.equal(table, 'workspace_subscription_profiles');
      return {
        select(columns) {
          return builder.select(columns);
        },
        update(values) {
          observed.update = values;
          return {
            eq: () => ({
              filter: (column, operator, fvalue) => ({
                select: () => {
                  observed.updateFilter = [column, operator, fvalue];
                  if (updateError) return Promise.resolve({ data: null, error: updateError });
                  return Promise.resolve({ data: updateResult, error: null });
                },
              }),
            }),
          };
        },
        insert(values) {
          observed.insert = values;
          if (insertError) return Promise.resolve({ data: null, error: insertError });
          return Promise.resolve({ data: [values], error: null });
        },
      };
    },
  };
}

test('startWorkspaceTrial writes the trial onto an existing row', async () => {
  const observed = {};
  const supabase = fakeSupabase(
    { row: { tier: 'Starter', billing_state: 'Inactive', monthly_rate: 0, payload: { usage: { horsesUsed: 2 } } } },
    observed,
  );
  const result = await startWorkspaceTrial(supabase, 'ws-1', NOW_MS);

  assert.equal(result.ok, true);
  assert.equal(result.trial.plan, 'Professional');
  assert.equal(Date.parse(result.trial.endsAt) - Date.parse(result.trial.startedAt), TRIAL_LENGTH_MS);

  // The existing payload is preserved, not replaced.
  assert.deepEqual(observed.update.payload.usage, { horsesUsed: 2 });
  assert.deepEqual(observed.update.payload.trial, result.trial);
  assert.ok(observed.update.updated_at);
  // The write is guarded against a concurrent start.
  assert.deepEqual(observed.updateFilter, ['payload->trial->>startedAt', 'is', null]);
});

test('startWorkspaceTrial creates a baseline row when none exists', async () => {
  const observed = {};
  const supabase = fakeSupabase({ row: null }, observed);
  const result = await startWorkspaceTrial(supabase, 'ws-1', NOW_MS);

  assert.equal(result.ok, true);
  assert.equal(observed.insert.workspace_id, 'ws-1');
  assert.equal(observed.insert.tier, 'Starter');
  assert.equal(observed.insert.billing_state, 'Inactive');
  assert.equal(observed.insert.monthly_rate, 0);
  assert.deepEqual(observed.insert.payload.trial, result.trial);
});

test('startWorkspaceTrial fails closed when the read fails', async () => {
  const supabase = fakeSupabase({ readError: { message: 'boom' } });
  const result = await startWorkspaceTrial(supabase, 'ws-1', NOW_MS);
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('startWorkspaceTrial refuses an already-trialed workspace', async () => {
  const supabase = fakeSupabase({
    row: { tier: 'Starter', billing_state: 'Inactive', monthly_rate: 0, payload: activePayload() },
  });
  const result = await startWorkspaceTrial(supabase, 'ws-1', NOW_MS);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'trial_already_used');
  assert.equal(result.status, 409);
});

test('startWorkspaceTrial reports a lost race as already-used, not an error', async () => {
  // The update's row guard filtered the write out: someone else started first.
  const supabase = fakeSupabase({
    row: { tier: 'Starter', billing_state: 'Inactive', monthly_rate: 0, payload: {} },
    updateResult: [],
  });
  const result = await startWorkspaceTrial(supabase, 'ws-1', NOW_MS);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'trial_already_used');
  assert.equal(result.status, 409);
});

test('startWorkspaceTrial refuses a workspace already paying', async () => {
  const supabase = fakeSupabase({
    row: { tier: 'Professional', billing_state: 'Active', monthly_rate: 29, payload: {} },
  });
  const result = await startWorkspaceTrial(supabase, 'ws-1', NOW_MS);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'already_entitled');
});

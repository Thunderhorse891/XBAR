import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWelcomeEmail,
  buildTrialEndingEmail,
  buildTrialExpiredEmail,
  buildPaymentFailedEmail,
  escapeHtml,
  resolveTrialEndDate,
  trialReminderKind,
  lifecycleEventKey,
  SUPPORT_EMAIL,
  TRIAL_LENGTH_DAYS,
  TRIAL_ENDING_SOON_DAYS,
} from '../../api/_lib/lifecycleEmails.js';

import {
  claimLifecycleEmail,
  releaseLifecycleEmail,
  selectTrialReminders,
  sendWelcomeForUser,
  processTrialReminders,
  handleInvoicePaymentFailed,
} from '../../api/_lib/lifecycleTriggers.js';

/*
 * Lifecycle emails: welcome, trial-ending-soon, trial-expired, dunning.
 *
 * These tests pin:
 *  - copy content (subjects, support contact, trial facts, expiry facts),
 *  - the trial-state field contract shared with the trial-mechanics build,
 *  - the trigger windows (no early, no late, no paid-workspace emails),
 *  - idempotency: a claim that already exists never sends twice, and a
 *    failed send releases its claim so the next run retries.
 */

// ---------------------------------------------------------------------------
// Link assertions: compare exact hrefs/hosts, never URL substrings.
// (Substring host checks trip js/incomplete-url-substring-sanitization.)
// ---------------------------------------------------------------------------

function hrefsOf(html) {
  return [...String(html).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

function hostsOf(html) {
  return hrefsOf(html).map((h) => {
    try {
      return new URL(h).host;
    } catch {
      return '';
    }
  });
}

// ---------------------------------------------------------------------------
// Minimal fake supabase: only the query shapes the triggers use.
// ---------------------------------------------------------------------------

function makeFakeSupabase({
  profiles = [],
  billingCustomers = [],
  workspaces = [],
  workspaceProfiles = [],
  ownerEmails = {},
} = {}) {
  const tables = {
    workspace_subscription_profiles: profiles,
    workspace_billing_customers: billingCustomers,
    workspaces,
    workspace_profiles: workspaceProfiles,
  };
  const claims = new Map();

  function runSelect(table, filters, orderBy, limitN) {
    let rows = (tables[table] || []).filter((row) => filters.every(([col, val]) => row[col] === val));
    if (orderBy) {
      const [col, asc] = orderBy;
      rows = [...rows].sort((a, b) => (a[col] < b[col] ? (asc ? -1 : 1) : a[col] > b[col] ? (asc ? 1 : -1) : 0));
    }
    if (limitN != null) rows = rows.slice(0, limitN);
    return rows;
  }

  function from(table) {
    const state = { filters: [], orderBy: null, limitN: null, deleting: false };
    const api = {
      select() {
        return api;
      },
      eq(col, val) {
        state.filters.push([col, val]);
        return api;
      },
      order(col, opts) {
        state.orderBy = [col, opts?.ascending !== false];
        return api;
      },
      limit(n) {
        state.limitN = n;
        return api;
      },
      delete() {
        state.deleting = true;
        return api;
      },
      async maybeSingle() {
        return { data: runSelect(table, state.filters)[0] ?? null, error: null };
      },
      async insert(row) {
        if (table === 'workspace_subscription_events') {
          if (claims.has(row.stripe_event_id)) {
            return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          claims.set(row.stripe_event_id, row);
          return { error: null };
        }
        throw new Error(`insert not stubbed for ${table}`);
      },
      then(resolve, reject) {
        try {
          if (state.deleting) {
            const key = state.filters.find(([col]) => col === 'stripe_event_id')?.[1];
            if (key) claims.delete(key);
            resolve({ error: null });
          } else {
            resolve({ data: runSelect(table, state.filters, state.orderBy, state.limitN), error: null });
          }
        } catch (error) {
          reject(error);
        }
      },
    };
    return api;
  }

  return {
    from,
    claims,
    auth: {
      admin: {
        async getUserById(id) {
          const email = ownerEmails[id];
          return email ? { data: { user: { id, email } }, error: null } : { data: { user: null }, error: null };
        },
      },
    },
  };
}

const okSender = async () => ({ ok: true });
const skippedSender = async () => ({ ok: false, skipped: true });
const failingSender = async () => ({ ok: false, message: 'boom' });

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

test('welcome email states what XBAR is, the first three steps, and support', () => {
  const email = buildWelcomeEmail({ recipientName: 'Erin', ranchName: 'Still Haven' });
  assert.match(email.subject, /Welcome to XBAR/);
  for (const body of [email.text, email.html]) {
    assert.match(body, /one trustworthy record per horse/);
    assert.match(body, /Add your first horse/);
    assert.match(body, /Upload a document/);
    assert.match(body, /Set one reminder/);
    assert.match(body, new RegExp(SUPPORT_EMAIL.replace('.', '\\.')));
    assert.match(body, /14-day Professional trial/);
    assert.match(body, /no card/);
  }
  assert.match(email.html, /Still Haven/);
  assert.match(email.text, /Still Haven/);
});

test('welcome email works without personalization', () => {
  const email = buildWelcomeEmail();
  assert.match(email.subject, /Welcome to XBAR/);
  assert.match(email.text, new RegExp(SUPPORT_EMAIL.replace('.', '\\.')));
});

test('trial-ending email names the end date and what happens at expiry', () => {
  const email = buildTrialEndingEmail({ ranchName: 'Still Haven', trialEndDate: '2026-10-08', daysLeft: 3 });
  assert.match(email.subject, /October 8, 2026/);
  for (const body of [email.text, email.html]) {
    assert.match(body, /full Professional/);
    assert.match(body, /sale packets/);
    assert.match(body, /free baseline/);
    assert.match(body, /stay exactly as they are/);
    assert.match(body, /Nothing is charged automatically/);
    assert.match(body, new RegExp(SUPPORT_EMAIL.replace('.', '\\.')));
  }
});

test('trial-expired email says records are safe and names the baseline', () => {
  const email = buildTrialExpiredEmail({ ranchName: 'Still Haven' });
  assert.match(email.subject, /trial has ended/);
  assert.match(email.subject, /records are safe/);
  for (const body of [email.text, email.html]) {
    assert.match(body, /free baseline/);
    assert.match(body, /Nothing you entered is gone/);
    assert.match(body, /5 horses, 250 documents/);
    assert.match(body, new RegExp(SUPPORT_EMAIL.replace('.', '\\.')));
  }
});

test('dunning email with a portal URL links the portal, without one links Billing', () => {
  const withPortal = buildPaymentFailedEmail({
    ranchName: 'Still Haven',
    planName: 'Professional',
    billingPortalUrl: 'https://billing.stripe.com/session/abc',
  });
  assert.match(withPortal.subject, /payment didn't go through/);
  assert.ok(hrefsOf(withPortal.html).some((h) => h === 'https://billing.stripe.com/session/abc'));
  assert.match(withPortal.text, /Professional/);
  assert.match(withPortal.text, /records are unaffected/);
  assert.match(withPortal.text, new RegExp(SUPPORT_EMAIL.replace('.', '\\.')));

  const withoutPortal = buildPaymentFailedEmail({ billingPortalUrl: '' });
  assert.ok(!hostsOf(withoutPortal.html).some((h) => h === 'billing.stripe.com'));
  assert.match(withoutPortal.text, /Billing page in XBAR/);
  assert.match(withoutPortal.html, /\/billing/);
});

test('user-controlled names are HTML-escaped in email bodies', () => {
  const evil = '<img src=x onerror=alert(1)>';
  assert.equal(escapeHtml(evil), '&lt;img src=x onerror=alert(1)&gt;', 'escapeHtml neutralizes tag markup');

  // Every builder that takes a name must escape it in HTML. The plain-text
  // versions keep the raw value — there is nothing to escape in plain text.
  const welcome = buildWelcomeEmail({ recipientName: evil, ranchName: evil });
  assert.ok(!welcome.html.includes(evil), 'welcome html has no raw markup');
  assert.ok(welcome.html.includes('&lt;img'), 'welcome html escapes the name');
  assert.ok(welcome.text.includes(evil), 'welcome text keeps the raw name');

  const ending = buildTrialEndingEmail({ ranchName: evil, trialEndDate: '2026-10-08', daysLeft: 3 });
  assert.ok(!ending.html.includes(evil), 'trial-ending html has no raw markup');

  const expired = buildTrialExpiredEmail({ ranchName: evil });
  assert.ok(!expired.html.includes(evil), 'trial-expired html has no raw markup');

  const failed = buildPaymentFailedEmail({ ranchName: evil, planName: evil, billingPortalUrl: '' });
  assert.ok(!failed.html.includes(evil), 'payment-failed html has no raw markup');
});

test('lifecycle copy carries no hype', () => {
  const bodies = [
    buildWelcomeEmail().text,
    buildTrialEndingEmail({ trialEndDate: '2026-10-08', daysLeft: 2 }).text,
    buildTrialExpiredEmail().text,
    buildPaymentFailedEmail().text,
  ].join('\n');
  for (const word of ['revolutionary', 'game-changing', 'unlock your', 'supercharge', 'act now', 'limited-time']) {
    assert.doesNotMatch(bodies, new RegExp(word, 'i'), `hype word present: ${word}`);
  }
});

// ---------------------------------------------------------------------------
// Trial-state field contract
// ---------------------------------------------------------------------------

test('resolveTrialEndDate honors the documented precedence', () => {
  // the real trial contract: payload.trial = { startedAt, endsAt, plan }
  assert.equal(
    resolveTrialEndDate({
      trial: { startedAt: '2026-09-24T00:00:00.000Z', endsAt: '2026-10-08T00:00:00.000Z', plan: 'Professional' },
    }),
    '2026-10-08',
  );
  assert.equal(
    resolveTrialEndDate({
      payload: { trial: { startedAt: '2026-09-24T00:00:00.000Z', endsAt: '2026-10-08T00:00:00.000Z' } },
    }),
    '2026-10-08',
  );
  assert.equal(resolveTrialEndDate({ trial_end: '2026-10-08' }), '2026-10-08');
  assert.equal(resolveTrialEndDate({ trialEnd: '2026-10-09' }), '2026-10-09');
  assert.equal(resolveTrialEndDate({ trial: { end: '2026-10-10' } }), '2026-10-10');
  assert.equal(resolveTrialEndDate({ trial: { trial_end: '2026-10-11' } }), '2026-10-11');
  // trial_end beats trialEnd
  assert.equal(resolveTrialEndDate({ trial_end: '2026-10-08', trialEnd: '2026-10-09' }), '2026-10-08');
  // explicit end beats a derivable start
  assert.equal(resolveTrialEndDate({ trial_end: '2026-10-08', trial_start: '2026-09-24' }), '2026-10-08');
  // trial_start + 14 days = trial_end
  assert.equal(resolveTrialEndDate({ trial_start: '2026-09-24' }), '2026-10-08');
  assert.equal(resolveTrialEndDate({ trialStart: '2026-09-24' }), '2026-10-08');
  assert.equal(resolveTrialEndDate({ trial: { start: '2026-09-24' } }), '2026-10-08');
  assert.equal(TRIAL_LENGTH_DAYS, 14);
  // garbage in, null out
  assert.equal(resolveTrialEndDate(null), null);
  assert.equal(resolveTrialEndDate({}), null);
  assert.equal(resolveTrialEndDate({ trial_end: 'not-a-date' }), null);
});

test('trialReminderKind windows: ending-soon, expired, or nothing', () => {
  const at = (day) => `${day}T12:00:00Z`;
  const kind = (trialEndDate, nowDay) => trialReminderKind({ trialEndDate, nowIso: at(nowDay) });
  assert.equal(kind('2026-10-08', '2026-10-05'), 'ending-soon');
  assert.equal(kind('2026-10-08', '2026-10-06'), 'ending-soon');
  assert.equal(kind('2026-10-08', '2026-10-07'), 'ending-soon');
  assert.equal(kind('2026-10-08', '2026-10-04'), null, 'four days out is too early');
  assert.equal(kind('2026-10-08', '2026-10-08'), 'expired', 'expiry day counts as expired');
  assert.equal(kind('2026-10-08', '2026-10-09'), 'expired');
  assert.equal(kind('2026-10-08', '2026-10-11'), 'expired', 'three days past still in grace');
  assert.equal(kind('2026-10-08', '2026-10-12'), null, 'four days past is out of grace');
  assert.equal(kind('2026-10-08', '2026-01-01'), null, 'long past stays silent');
  assert.equal(kind('', '2026-10-05'), null);
  assert.equal(kind('garbage', '2026-10-05'), null);
  assert.equal(kind('2026-10-08', 'garbage'), null);
  assert.equal(TRIAL_ENDING_SOON_DAYS, 3);
});

test('lifecycleEventKey is deterministic and namespaced', () => {
  assert.equal(
    lifecycleEventKey('trial-ending-soon', 'ws-1', '2026-10-08'),
    'xbar:lifecycle:trial-ending-soon:ws-1:2026-10-08',
  );
  assert.equal(
    lifecycleEventKey('trial-ending-soon', 'ws-1', '2026-10-08'),
    lifecycleEventKey('trial-ending-soon', 'ws-1', '2026-10-08'),
  );
  assert.notEqual(
    lifecycleEventKey('trial-ending-soon', 'ws-1', '2026-10-08'),
    lifecycleEventKey('trial-ending-soon', 'ws-1', '2026-11-08'),
    'a renewed trial gets its own key',
  );
});

// ---------------------------------------------------------------------------
// Idempotency claims
// ---------------------------------------------------------------------------

test('claim is atomic: second claim loses, release reopens', async () => {
  const supabase = makeFakeSupabase();
  const first = await claimLifecycleEmail(supabase, {
    key: 'xbar:lifecycle:welcome:user:u1',
    workspaceId: null,
    eventType: 'welcome',
    payload: {},
  });
  assert.equal(first.claimed, true);
  const second = await claimLifecycleEmail(supabase, {
    key: 'xbar:lifecycle:welcome:user:u1',
    workspaceId: null,
    eventType: 'welcome',
    payload: {},
  });
  assert.equal(second.claimed, false);
  assert.equal(second.alreadySent, true);
  await releaseLifecycleEmail(supabase, 'xbar:lifecycle:welcome:user:u1');
  const third = await claimLifecycleEmail(supabase, {
    key: 'xbar:lifecycle:welcome:user:u1',
    workspaceId: null,
    eventType: 'welcome',
    payload: {},
  });
  assert.equal(third.claimed, true);
});

test('welcome sends once per user; a failed send releases the claim', async () => {
  const supabase = makeFakeSupabase();
  const user = { id: 'u1', email: 'erin@example.com', user_metadata: { full_name: 'Erin Cole' } };
  const sent = [];
  const sender = async (args) => {
    sent.push(args);
    return { ok: true };
  };
  const first = await sendWelcomeForUser({ supabase, user, sendEmailFn: sender });
  assert.equal(first.ok, true);
  assert.equal(first.sent, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Welcome to XBAR/);
  assert.equal(sent[0].to, 'erin@example.com');

  const second = await sendWelcomeForUser({ supabase, user, sendEmailFn: sender });
  assert.equal(second.ok, true);
  assert.equal(second.alreadySent, true);
  assert.equal(sent.length, 1, 'no double-send');

  // A failed send releases the claim so the next attempt retries.
  const supabase2 = makeFakeSupabase();
  const failed = await sendWelcomeForUser({ supabase: supabase2, user, sendEmailFn: failingSender });
  assert.equal(failed.ok, false);
  assert.equal(supabase2.claims.size, 0, 'claim released after failure');
  const retried = await sendWelcomeForUser({ supabase: supabase2, user, sendEmailFn: sender });
  assert.equal(retried.sent, true);
  assert.equal(sent.length, 2);
});

test('welcome with no provider configured releases the claim for a later run', async () => {
  const supabase = makeFakeSupabase();
  const user = { id: 'u1', email: 'erin@example.com' };
  const result = await sendWelcomeForUser({ supabase, user, sendEmailFn: skippedSender });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(supabase.claims.size, 0);
});

test('a throwing sender releases the claim instead of burning the email', async () => {
  const throwingSender = async () => {
    throw new Error('network down');
  };
  const supabase = makeFakeSupabase();
  const user = { id: 'u1', email: 'erin@example.com' };
  const result = await sendWelcomeForUser({ supabase, user, sendEmailFn: throwingSender });
  assert.equal(result.ok, false);
  assert.match(result.message, /threw/);
  assert.equal(supabase.claims.size, 0, 'claim released after throw');

  // And the trial cron releases the claim when the sender throws, too.
  const supabase2 = makeFakeSupabase({
    profiles: [{ workspace_id: 'ws-1', billing_state: 'Inactive', payload: { trial_end: '2026-10-07' } }],
    workspaces: [{ id: 'ws-1', name: 'Still Haven', owner_user_id: 'u1' }],
    ownerEmails: { u1: 'owner@example.com' },
  });
  const cronResult = await processTrialReminders({
    supabase: supabase2,
    nowIso: '2026-10-05T12:00:00Z',
    sendEmailFn: throwingSender,
  });
  assert.equal(cronResult.emailed, 0);
  assert.equal(cronResult.failures.length, 1);
  assert.equal(supabase2.claims.size, 0, 'cron claim released after throw');
});

// ---------------------------------------------------------------------------
// Trial selection + processing
// ---------------------------------------------------------------------------

test('selectTrialReminders picks windows and skips paid workspaces', () => {
  const nowIso = '2026-10-05T12:00:00Z';
  const rows = [
    { workspace_id: 'soon', billing_state: 'Inactive', payload: { trial_end: '2026-10-07' } },
    { workspace_id: 'just-expired', billing_state: 'Inactive', payload: { trial_end: '2026-10-04' } },
    { workspace_id: 'too-early', billing_state: 'Inactive', payload: { trial_end: '2026-10-20' } },
    { workspace_id: 'long-expired', billing_state: 'Inactive', payload: { trial_end: '2026-09-01' } },
    { workspace_id: 'paying', billing_state: 'Active', payload: { trial_end: '2026-10-07' } },
    { workspace_id: 'no-trial', billing_state: 'Inactive', payload: { tier: 'Starter' } },
    { workspace_id: 'from-start', billing_state: 'Inactive', payload: { trial_start: '2026-09-24' } },
  ];
  const selected = selectTrialReminders({ rows, nowIso });
  const byId = Object.fromEntries(selected.map((s) => [s.workspaceId, s]));
  assert.equal(byId.soon.kind, 'ending-soon');
  assert.equal(byId['just-expired'].kind, 'expired');
  assert.ok(!byId['too-early'], 'too early');
  assert.ok(!byId['long-expired'], 'out of grace');
  assert.ok(!byId.paying, 'paying workspaces never get trial mail');
  assert.ok(!byId['no-trial'], 'no trial state');
  assert.equal(byId['from-start'].kind, 'ending-soon', '2026-09-24 + 14d = 2026-10-08, three days out on 2026-10-05');
  assert.equal(byId['from-start'].trialEndDate, '2026-10-08');
});

test('processTrialReminders sends once per trial period and never double-sends', async () => {
  const profiles = [
    { workspace_id: 'ws-soon', billing_state: 'Inactive', payload: { trial_end: '2026-10-07' } },
    { workspace_id: 'ws-expired', billing_state: 'Inactive', payload: { trial_end: '2026-10-04' } },
  ];
  const supabase = makeFakeSupabase({
    profiles,
    workspaces: [
      { id: 'ws-soon', name: 'Still Haven', owner_user_id: 'u1' },
      { id: 'ws-expired', name: 'Still Haven', owner_user_id: 'u1' },
    ],
    workspaceProfiles: [{ workspace_id: 'ws-soon', operations_email: 'ops@example.com' }],
    ownerEmails: { u1: 'owner@example.com' },
  });
  const sent = [];
  const nowIso = '2026-10-05T12:00:00Z';

  const first = await processTrialReminders({
    supabase,
    nowIso,
    sendEmailFn: async (args) => {
      sent.push(args);
      return { ok: true };
    },
  });
  assert.equal(first.ok, true);
  assert.equal(first.emailed, 2);
  assert.equal(sent.length, 2);
  assert.equal(sent.find((s) => s.to === 'ops@example.com')?.subject.includes('ends'), true);
  assert.equal(sent.find((s) => s.to === 'owner@example.com')?.subject.includes('has ended'), true);

  // Second run: claims already exist, nothing re-sends.
  const second = await processTrialReminders({
    supabase,
    nowIso,
    sendEmailFn: async (args) => {
      sent.push(args);
      return { ok: true };
    },
  });
  assert.equal(second.emailed, 0);
  assert.equal(second.alreadySent, 2);
  assert.equal(sent.length, 2);
});

test('processTrialReminders releases the claim when sending fails', async () => {
  const supabase = makeFakeSupabase({
    profiles: [{ workspace_id: 'ws-1', billing_state: 'Inactive', payload: { trial_end: '2026-10-07' } }],
    workspaces: [{ id: 'ws-1', name: 'Still Haven', owner_user_id: 'u1' }],
    ownerEmails: { u1: 'owner@example.com' },
  });
  const result = await processTrialReminders({
    supabase,
    nowIso: '2026-10-05T12:00:00Z',
    sendEmailFn: failingSender,
  });
  assert.equal(result.emailed, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(supabase.claims.size, 0, 'failed send released its claim');
});

// ---------------------------------------------------------------------------
// Dunning
// ---------------------------------------------------------------------------

test('dunning resolves the workspace, sends once per invoice', async () => {
  const supabase = makeFakeSupabase({
    billingCustomers: [{ stripe_customer_id: 'cus_1', workspace_id: 'ws-1' }],
    workspaces: [{ id: 'ws-1', name: 'Still Haven', owner_user_id: 'u1' }],
    ownerEmails: { u1: 'owner@example.com' },
  });
  const sent = [];
  const invoice = { id: 'in_1', customer: 'cus_1', lines: { data: [{ price: { nickname: 'Professional' } }] } };
  const args = {
    supabase,
    stripe: null,
    invoice,
    eventId: 'evt_1',
    billingPortalUrl: 'https://billing.stripe.com/session/abc',
    sendEmailFn: async (a) => {
      sent.push(a);
      return { ok: true };
    },
  };
  const first = await handleInvoicePaymentFailed(args);
  assert.equal(first.ok, true);
  assert.equal(first.sent, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /payment didn't go through/);
  assert.ok(hostsOf(sent[0].html).some((h) => h === 'billing.stripe.com'));

  // A second failed attempt for the same invoice does not re-send.
  const second = await handleInvoicePaymentFailed({ ...args, eventId: 'evt_2' });
  assert.equal(second.ok, true);
  assert.equal(second.alreadySent, true);
  assert.equal(sent.length, 1);
});

test('dunning resolves workspace from the subscription metadata fallback', async () => {
  const supabase = makeFakeSupabase({
    workspaces: [{ id: 'ws-9', name: 'Still Haven', owner_user_id: 'u1' }],
    ownerEmails: { u1: 'owner@example.com' },
  });
  const stripe = {
    subscriptions: {
      retrieve: async () => ({ metadata: { workspace_id: 'ws-9' } }),
    },
  };
  const sent = [];
  const result = await handleInvoicePaymentFailed({
    supabase,
    stripe,
    invoice: { id: 'in_9', customer: 'cus_9', subscription: 'sub_9' },
    eventId: 'evt_9',
    billingPortalUrl: '',
    sendEmailFn: async (a) => {
      sent.push(a);
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.sent, true);
  assert.equal(sent.length, 1);
  // No portal URL: the copy points at the in-app Billing page instead.
  assert.match(sent[0].text, /Billing page in XBAR/);
});

test('dunning refuses honestly when the workspace cannot be resolved', async () => {
  const supabase = makeFakeSupabase();
  const result = await handleInvoicePaymentFailed({
    supabase,
    stripe: null,
    invoice: { id: 'in_x', customer: 'cus_unknown' },
    eventId: 'evt_x',
    sendEmailFn: okSender,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /Could not resolve a workspace/);
});

test('dunning with no email provider releases the claim', async () => {
  const supabase = makeFakeSupabase({
    billingCustomers: [{ stripe_customer_id: 'cus_1', workspace_id: 'ws-1' }],
    workspaces: [{ id: 'ws-1', name: 'Still Haven', owner_user_id: 'u1' }],
    ownerEmails: { u1: 'owner@example.com' },
  });
  const result = await handleInvoicePaymentFailed({
    supabase,
    stripe: null,
    invoice: { id: 'in_1', customer: 'cus_1' },
    eventId: 'evt_1',
    sendEmailFn: skippedSender,
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(supabase.claims.size, 0);
});

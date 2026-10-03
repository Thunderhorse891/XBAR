/*
 * Behavioral coverage for the webhook's grant path: a successful
 * `checkout.session.completed` event must write the correct tier AND
 * billing state to the subscription profile.
 *
 * This is the single most consequential untested path in billing. Existing
 * coverage was only the refusal case (unconfigured webhook) and source-text
 * assertions; nothing exercised what a paid checkout actually WRITES.
 *
 * The test drives the real api/stripe/webhook.js handler with a genuinely
 * signed event (the fixture's constructEvent performs the real HMAC check),
 * a scripted Stripe boundary (subscription retrieve) and a scripted Supabase
 * boundary (idempotency check, profile read, xbar_apply_subscription_event
 * RPC). It asserts the tier + billing state that reach the RPC, the
 * idempotency ordering, duplicate delivery, and fail-closed on an unknown
 * price id.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { register } from 'node:module';

// Module-scope reads: env must be set before the handler is imported.
process.env.STRIPE_SECRET_KEY = 'sk_test_webhook_grant';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_webhook_grant';
process.env.STRIPE_PRICE_ID_STARTER = 'price_starter_m';
process.env.STRIPE_PRICE_ID_PROFESSIONAL = 'price_pro_m';
process.env.STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL = 'price_pro_a';
process.env.STRIPE_PRICE_ID_RANCH_OPS = 'price_ranch_m';
process.env.STRIPE_PRICE_ID_ENTERPRISE = 'price_ent_m';
process.env.SUPABASE_URL = 'https://billing-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';

register(new URL('./fixtures/billingLoader.mjs', import.meta.url));

const { __setBillingStripe, signTestWebhookEvent, verifyTestWebhookSignature } =
  await import('./fixtures/billingStripeStub.mjs');
const { __setBillingSupabase, makeClient } = await import('./fixtures/billingSupabaseStub.mjs');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PRICE_PRO_MONTHLY = process.env.STRIPE_PRICE_ID_PROFESSIONAL;
const PRICE_PRO_ANNUAL = process.env.STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL;

/* Per-test scenario dispatch for the scripted Stripe boundary. */
const stripeScenario = {
  calls: [],
  retrieveSubscription: async (id) => {
    throw new Error(`unexpected subscriptions.retrieve(${id})`);
  },
};

__setBillingStripe({
  webhooks: {
    constructEvent: (rawBody, signature, secret) => verifyTestWebhookSignature(rawBody, signature, secret),
  },
  subscriptions: {
    retrieve: async (id) => {
      stripeScenario.calls.push(['retrieve', id]);
      return stripeScenario.retrieveSubscription(id);
    },
  },
});

const { default: handler } = await import('../../api/stripe/webhook.js');

function invoke(rawBody, signature) {
  const req = Readable.from([rawBody]);
  req.method = 'POST';
  req.url = '/api/stripe/webhook';
  req.headers = signature ? { 'stripe-signature': signature } : {};
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      end(payload) {
        let parsed;
        try {
          parsed = payload ? JSON.parse(payload) : null;
        } catch {
          parsed = null;
        }
        resolve({ statusCode: this.statusCode, body: parsed });
      },
    };
    void handler(req, res);
  });
}

function completedEvent({ eventId = 'evt_test_completed', workspaceId = 'ws_test_1' } = {}) {
  return {
    id: eventId,
    object: 'event',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        mode: 'subscription',
        customer: 'cus_test_1',
        subscription: 'sub_test_1',
        metadata: { workspace_id: workspaceId },
      },
    },
  };
}

function deliver(event, { secret = WEBHOOK_SECRET } = {}) {
  const rawBody = JSON.stringify(event);
  return invoke(rawBody, signTestWebhookEvent(rawBody, secret));
}

/*
 * Scripted Supabase boundary. `order` records the cross-boundary call order
 * so the idempotency/ordering assertions are behavioral, not textual.
 */
function supabaseFor({
  processedEventIds = [],
  profileRow = null,
  profileError = null,
  rpcImpl = null,
  billingCustomers = { data: [], error: null },
} = {}) {
  const calls = { order: [], rpcParams: [] };
  const client = makeClient({
    tables: {
      workspace_billing_customers: async (mode) => {
        calls.order.push('customer-lookup');
        assert.equal(mode, 'rows', 'every matching row is read, so two workspaces cannot hide behind one');
        return billingCustomers;
      },
      workspace_subscription_events: async (mode, ops) => {
        calls.order.push('events-check');
        const eqOp = ops.find(([name]) => name === 'eq');
        const seen = eqOp ? processedEventIds.includes(eqOp[2]) : false;
        return { data: seen ? [{ id: 'row_1' }] : [], error: null };
      },
      workspace_subscription_profiles: async (mode) => {
        calls.order.push('profile-read');
        if (mode === 'maybeSingle') return { data: profileRow, error: profileError };
        return { data: [], error: null };
      },
    },
    rpcImpl: async (name, params) => {
      calls.order.push(`rpc:${name}`);
      calls.rpcParams.push(params);
      if (rpcImpl) return rpcImpl(name, params);
      assert.equal(name, 'xbar_apply_subscription_event');
      return { data: true, error: null };
    },
  });
  __setBillingSupabase(client);
  return calls;
}

function activeSubscription(priceId, { quantity = 1 } = {}) {
  return {
    id: 'sub_test_1',
    status: 'active',
    customer: 'cus_test_1',
    current_period_end: 1790000000,
    items: { data: [{ price: { id: priceId }, quantity }] },
  };
}

test('a completed checkout writes the purchased tier and an Active billing state', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => activeSubscription(PRICE_PRO_MONTHLY);
  const calls = supabaseFor();

  const response = await deliver(completedEvent());

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);

  // Idempotency first, then the Stripe read, then the atomic write — the
  // ordering the advisory-lock design depends on.
  assert.deepEqual(calls.order, ['events-check', 'profile-read', 'rpc:xbar_apply_subscription_event']);
  assert.deepEqual(
    stripeScenario.calls,
    [['retrieve', 'sub_test_1']],
    'one Stripe read for the subscription the event is about',
  );

  const [params] = calls.rpcParams;
  assert.equal(params.p_workspace_id, 'ws_test_1');
  assert.equal(params.p_event_id, 'evt_test_completed');
  assert.equal(params.p_event_type, 'checkout.session.completed');
  assert.equal(params.p_tier, 'Professional', 'the tier the price id maps to');
  assert.equal(params.p_billing_state, 'Active', 'an active Stripe subscription entitles');
  assert.equal(params.p_monthly_rate, 29, 'Professional monthly rate');
  assert.equal(params.p_customer_id, 'cus_test_1');
  assert.equal(params.p_subscription_id, 'sub_test_1');
  assert.equal(params.p_price_id, PRICE_PRO_MONTHLY);
  assert.equal(params.p_seat_count, 1);
  assert.equal(params.p_from_sibling, false);
  assert.ok(params.p_event_created_at, 'the event timestamp is carried for ordering');

  // The full profile the workspace will gate on carries the same answer.
  assert.equal(params.p_profile.tier, 'Professional');
  assert.equal(params.p_profile.billingState, 'Active');
  assert.equal(params.p_profile.monthlyRate, 29);
  assert.equal(params.p_profile.usage.horseLimit, 30, 'Professional capacity, not the Starter baseline');
});

/*
 * Audit F14: on the pinned API (2026-02-25.clover) a subscription's period end
 * lives on its items. Reading the old top-level field stored a blank renewal
 * date for every current purchase while the write itself succeeded.
 */
test('a current-shape subscription stores its renewal date from the line item', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => ({
    id: 'sub_test_1',
    status: 'active',
    customer: 'cus_test_1',
    items: { data: [{ price: { id: PRICE_PRO_MONTHLY }, quantity: 1, current_period_end: 1793000000 }] },
  });
  const calls = supabaseFor();

  const response = await deliver(completedEvent({ eventId: 'evt_test_item_period' }));

  assert.equal(response.statusCode, 200);
  const [params] = calls.rpcParams;
  assert.equal(params.p_profile.renewalDate, new Date(1793000000 * 1000).toISOString().slice(0, 10));
});

test('an event without a period end keeps the renewal date already on file', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => ({
    id: 'sub_test_1',
    status: 'active',
    customer: 'cus_test_1',
    items: { data: [{ price: { id: PRICE_PRO_MONTHLY }, quantity: 1 }] },
  });
  const calls = supabaseFor({ profileRow: { tier: 'Professional', payload: { renewalDate: '2026-11-02' } } });

  const response = await deliver(completedEvent({ eventId: 'evt_test_no_period' }));

  assert.equal(response.statusCode, 200);
  const [params] = calls.rpcParams;
  assert.equal(params.p_profile.renewalDate, '2026-11-02', 'not knowing the date is not a reason to erase it');
});

/*
 * Audit F14: repricing replaces STRIPE_PRICE_ID_*. A customer still billed on
 * the old price must stay entitled -- the webhook refuses an entitling event
 * whose price it cannot place, so without the approved-legacy table a price
 * change would lock out paying customers at their next renewal.
 */
test('a subscriber on an approved legacy price keeps the plan they pay for', async () => {
  const previous = process.env.STRIPE_LEGACY_PRICE_IDS;
  process.env.STRIPE_LEGACY_PRICE_IDS = 'price_pro_2025=Professional:annual';
  try {
    stripeScenario.calls = [];
    stripeScenario.retrieveSubscription = async () => activeSubscription('price_pro_2025');
    const calls = supabaseFor();

    const response = await deliver(completedEvent({ eventId: 'evt_test_legacy_price' }));

    assert.equal(response.statusCode, 200);
    const [params] = calls.rpcParams;
    assert.equal(params.p_tier, 'Professional');
    assert.equal(params.p_billing_state, 'Active');
    assert.equal(params.p_profile.billingPeriod, 'annual', 'the legacy entry carries its cadence');
  } finally {
    if (previous === undefined) delete process.env.STRIPE_LEGACY_PRICE_IDS;
    else process.env.STRIPE_LEGACY_PRICE_IDS = previous;
  }
});

test('an annual purchase grants the tier through the annual price id', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => activeSubscription(PRICE_PRO_ANNUAL, { quantity: 3 });
  const calls = supabaseFor();

  const response = await deliver(completedEvent({ eventId: 'evt_test_annual' }));

  assert.equal(response.statusCode, 200);
  const [params] = calls.rpcParams;
  assert.equal(params.p_tier, 'Professional', 'annual price ids resolve to the same tier');
  assert.equal(params.p_billing_state, 'Active');
  assert.equal(params.p_seat_count, 3, 'the subscription quantity becomes the seat count');
});

test('a purchase preserves the stored trial record so the one-trial rule survives billing', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => activeSubscription(PRICE_PRO_MONTHLY);
  const trial = {
    startedAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2026-09-15T00:00:00.000Z',
    plan: 'Professional',
  };
  const calls = supabaseFor({
    profileRow: { tier: 'Starter', payload: { trial } },
  });

  const response = await deliver(completedEvent({ eventId: 'evt_test_trial_carry' }));

  assert.equal(response.statusCode, 200);
  const [params] = calls.rpcParams;
  assert.deepEqual(
    params.p_profile.trial,
    trial,
    'the webhook must not wipe the trial record: trial, buy, cancel must not reopen a second trial',
  );
});

test('a trial that starts between the profile read and the billing RPC is not erased', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => activeSubscription(PRICE_PRO_MONTHLY);

  const trial = {
    startedAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2026-09-15T00:00:00.000Z',
    plan: 'Professional',
  };
  // The stored row as the database sees it. The handler's read snapshots it
  // BEFORE the concurrent trial start lands.
  const dbRow = { tier: 'Starter', billing_state: 'Inactive', payload: {} };
  const rpcParams = [];
  let writtenPayload = null;

  const client = makeClient({
    tables: {
      workspace_subscription_events: async () => ({ data: [], error: null }),
      workspace_subscription_profiles: async (mode) => {
        if (mode !== 'maybeSingle') return { data: [], error: null };
        // Snapshot the row for the handler, then land the concurrent trial
        // start: startWorkspaceTrial's conditional write commits between the
        // handler's SELECT and the RPC's locked write.
        const snapshot = JSON.parse(JSON.stringify(dbRow));
        dbRow.payload = { trial };
        return { data: snapshot, error: null };
      },
    },
    rpcImpl: async (name, params) => {
      assert.equal(name, 'xbar_apply_subscription_event');
      rpcParams.push(params);
      // The real RPC merges payload.trial from the row it holds the advisory
      // lock on — not from the handler's pre-lock snapshot. This mock encodes
      // that contract; supabase/migrations/20260924223000 is the authoritative
      // implementation.
      const lockedTrial = dbRow.payload ? dbRow.payload.trial : undefined;
      const merged = { ...params.p_profile };
      if (lockedTrial && merged.trial == null) merged.trial = lockedTrial;
      writtenPayload = merged;
      return { data: true, error: null };
    },
  });
  __setBillingSupabase(client);

  const response = await deliver(completedEvent({ eventId: 'evt_test_trial_race' }));

  assert.equal(response.statusCode, 200);
  assert.equal(
    rpcParams[0].p_profile.trial,
    undefined,
    'the handler snapshot genuinely predates the trial: only the under-lock merge can save it',
  );
  assert.deepEqual(
    writtenPayload.trial,
    trial,
    'the trial that landed between the read and the RPC must survive the payload replace',
  );
});

test('a duplicate delivery is acknowledged without re-granting', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => activeSubscription(PRICE_PRO_MONTHLY);
  const calls = supabaseFor({ processedEventIds: ['evt_test_duplicate'] });

  const response = await deliver(completedEvent({ eventId: 'evt_test_duplicate' }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, duplicate: true });
  assert.deepEqual(calls.order, ['events-check'], 'the replay guard answers before any Stripe call');
  assert.deepEqual(stripeScenario.calls, [], 'no subscription re-read on a replay');
  assert.deepEqual(calls.rpcParams, [], 'no second grant on a replay');
});

test('an unrecognized price id fails closed: no entitlement is written', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => activeSubscription('price_unknown_xyz');
  const calls = supabaseFor();

  const response = await deliver(completedEvent({ eventId: 'evt_test_unknown_price' }));

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /Unrecognized Stripe price id/);
  assert.deepEqual(calls.rpcParams, [], 'an unknown price must not grant anything');
});

test('a delivery signed with the wrong secret is refused', async () => {
  stripeScenario.calls = [];
  const calls = supabaseFor();

  const response = await deliver(completedEvent({ eventId: 'evt_test_bad_sig' }), { secret: 'whsec_wrong' });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(calls.order, [], 'a bad signature reaches neither Stripe nor the database');
  assert.deepEqual(stripeScenario.calls, []);
});

test('a delivery with no signature is refused', async () => {
  stripeScenario.calls = [];
  const calls = supabaseFor();

  const response = await invoke(JSON.stringify(completedEvent({ eventId: 'evt_test_no_sig' })), null);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(calls.order, []);
});

/*
 * A subscription event with no workspace in its metadata is routed through
 * `workspace_billing_customers`. That lookup used to discard its error, so a
 * timeout read as "this customer has no workspace": the event was acknowledged
 * with 200, nothing was written, and Stripe never redelivered it.
 */
function updatedEventWithoutWorkspace({ eventId }) {
  return {
    id: eventId,
    object: 'event',
    type: 'customer.subscription.updated',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'sub_test_1',
        object: 'subscription',
        status: 'active',
        customer: 'cus_test_1',
        metadata: {},
        items: { data: [{ price: { id: PRICE_PRO_MONTHLY }, quantity: 1 }] },
      },
    },
  };
}

test('a subscription event finds its workspace through the billing customer', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => activeSubscription(PRICE_PRO_MONTHLY);
  const calls = supabaseFor({ billingCustomers: { data: [{ workspace_id: 'ws_by_customer' }], error: null } });

  const response = await deliver(updatedEventWithoutWorkspace({ eventId: 'evt_test_by_customer' }));

  assert.equal(response.statusCode, 200);
  assert.equal(calls.rpcParams.length, 1);
  assert.equal(calls.rpcParams[0].p_workspace_id, 'ws_by_customer');
  assert.equal(calls.rpcParams[0].p_billing_state, 'Active');
});

test('a customer with no workspace is acknowledged and changes nothing', async () => {
  stripeScenario.calls = [];
  const calls = supabaseFor({ billingCustomers: { data: [], error: null } });

  const response = await deliver(updatedEventWithoutWorkspace({ eventId: 'evt_test_no_workspace' }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.order, ['events-check', 'customer-lookup']);
  assert.deepEqual(calls.rpcParams, []);
  assert.deepEqual(stripeScenario.calls, []);
});

test('a failed customer lookup is retried by Stripe, not acknowledged as "no workspace"', async () => {
  stripeScenario.calls = [];
  const calls = supabaseFor({
    billingCustomers: { data: null, error: { message: 'canceling statement due to statement timeout' } },
  });

  const response = await deliver(updatedEventWithoutWorkspace({ eventId: 'evt_test_lookup_timeout' }));

  assert.ok(response.statusCode >= 500, `a non-2xx makes Stripe redeliver; got ${response.statusCode}`);
  assert.deepEqual(calls.rpcParams, [], 'nothing is written on an unanswered lookup');
  assert.deepEqual(stripeScenario.calls, [], 'no Stripe read for a workspace that was never resolved');
  assert.doesNotMatch(
    JSON.stringify(response.body),
    /statement timeout/,
    "the database's own text stays out of the body Stripe stores in its delivery log",
  );
});

test('a customer linked to two workspaces is refused, not assigned to whichever row came first', async () => {
  stripeScenario.calls = [];
  const calls = supabaseFor({
    billingCustomers: { data: [{ workspace_id: 'ws_a' }, { workspace_id: 'ws_b' }], error: null },
  });

  const response = await deliver(updatedEventWithoutWorkspace({ eventId: 'evt_test_two_workspaces' }));

  assert.ok(response.statusCode >= 400, `the refusal must be a non-2xx; got ${response.statusCode}`);
  assert.equal(response.body.ok, false);
  assert.match(response.body.message, /more than one workspace/);
  assert.deepEqual(calls.rpcParams, [], 'neither workspace is written');
});

test("a failed profile read keeps the database's text out of the response", async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => activeSubscription(PRICE_PRO_MONTHLY);
  const calls = supabaseFor({
    profileError: { message: 'relation "workspace_subscription_profiles" column "tier" does not exist' },
  });

  const response = await deliver(completedEvent({ eventId: 'evt_test_profile_read_error' }));

  assert.ok(response.statusCode >= 400, 'still a non-2xx, so Stripe retries');
  assert.deepEqual(calls.rpcParams, [], 'nothing is written without the stored tier');
  assert.doesNotMatch(JSON.stringify(response.body), /relation|column|does not exist/);
});

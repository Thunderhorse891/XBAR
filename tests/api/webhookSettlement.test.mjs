/*
 * A subscription's first payment must SETTLE before it grants paid access.
 *
 * Stripe documents that with delayed-confirmation methods (ACH Direct Debit
 * and the like) a new subscription "can bypass incomplete and move directly to
 * active upon creation", and that "if the payment later fails, Stripe voids the
 * invoice while the subscription remains active". So `subscription.status`
 * alone cannot decide the first grant: an unpaid checkout was writing Active
 * Professional, and the failure that followed was acknowledged with nothing
 * revoked.
 *
 * The rule under test: while the subscription's CREATION invoice is not paid,
 * the subscription is treated the way Stripe treats a card payment that has
 * not gone through — incomplete, not entitled. Renewals are unchanged: a
 * paying customer keeps access while a renewal payment settles, and Stripe's
 * own past_due handles a renewal that fails.
 *
 * Also here: a failed customer→workspace lookup must fail the delivery so
 * Stripe retries it, instead of acknowledging an event that changed nothing;
 * and the renewal date is read where the pinned API version puts it — on the
 * subscription item, not the top-level field Stripe removed in 2025.
 *
 * Drives the real api/stripe/webhook.js with genuinely signed events and
 * scripted Stripe and Supabase boundaries, as webhookCheckoutGrant does.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { register } from 'node:module';

process.env.STRIPE_SECRET_KEY = 'sk_test_webhook_settlement';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_webhook_settlement';
process.env.STRIPE_PRICE_ID_STARTER = 'price_starter_m';
process.env.STRIPE_PRICE_ID_PROFESSIONAL = 'price_pro_m';
process.env.STRIPE_PRICE_ID_RANCH_OPS = 'price_ranch_m';
process.env.STRIPE_PRICE_ID_ENTERPRISE = 'price_ent_m';
process.env.SUPABASE_URL = 'https://billing-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';

register(new URL('./fixtures/billingLoader.mjs', import.meta.url));

const { __setBillingStripe, signTestWebhookEvent, verifyTestWebhookSignature } =
  await import('./fixtures/billingStripeStub.mjs');
const { __setBillingSupabase, makeClient } = await import('./fixtures/billingSupabaseStub.mjs');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PRICE_PRO = process.env.STRIPE_PRICE_ID_PROFESSIONAL;
const PERIOD_END = 1790000000; // 2026-09-21 UTC
const PERIOD_END_DATE = new Date(PERIOD_END * 1000).toISOString().slice(0, 10);

const stripeScenario = {
  calls: [],
  retrieveSubscription: async (id) => {
    throw new Error(`unexpected subscriptions.retrieve(${id})`);
  },
  listSubscriptions: async () => ({ data: [], has_more: false }),
};

__setBillingStripe({
  webhooks: {
    constructEvent: (rawBody, signature, secret) => verifyTestWebhookSignature(rawBody, signature, secret),
  },
  subscriptions: {
    retrieve: async (id, params) => {
      stripeScenario.calls.push(['retrieve', id, params ?? null]);
      return stripeScenario.retrieveSubscription(id);
    },
    list: async (params) => {
      stripeScenario.calls.push(['list', params]);
      return stripeScenario.listSubscriptions(params);
    },
  },
});

const { default: handler } = await import('../../api/stripe/webhook.js');

function invoke(rawBody, signature) {
  const req = Readable.from([rawBody]);
  req.method = 'POST';
  req.url = '/api/stripe/webhook';
  req.headers = { 'stripe-signature': signature };
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

function deliver(event) {
  const rawBody = JSON.stringify(event);
  return invoke(rawBody, signTestWebhookEvent(rawBody, WEBHOOK_SECRET));
}

function checkoutEvent(type, { eventId, paymentStatus = 'paid', invoice = null } = {}) {
  return {
    id: eventId,
    object: 'event',
    type,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_test_settle',
        object: 'checkout.session',
        mode: 'subscription',
        payment_status: paymentStatus,
        invoice,
        customer: 'cus_test_settle',
        subscription: 'sub_test_settle',
        metadata: { workspace_id: 'ws_settle' },
      },
    },
  };
}

function subscriptionEvent(type, { eventId, subscription, workspaceId = 'ws_settle' }) {
  return {
    id: eventId,
    object: 'event',
    type,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        ...subscription,
        metadata: workspaceId ? { workspace_id: workspaceId } : {},
      },
    },
  };
}

/*
 * A subscription as the pinned API version returns it: the billing period on
 * the item, no top-level current_period_end.
 */
function subscription({
  id = 'sub_test_settle',
  status = 'active',
  invoiceReason = 'subscription_create',
  invoiceStatus = 'paid',
} = {}) {
  return {
    id,
    object: 'subscription',
    status,
    customer: 'cus_test_settle',
    latest_invoice: { id: `in_${id}`, object: 'invoice', billing_reason: invoiceReason, status: invoiceStatus },
    items: { data: [{ price: { id: PRICE_PRO }, quantity: 1, current_period_end: PERIOD_END }] },
  };
}

function supabaseFor({ billingCustomer = null, billingCustomerError = null } = {}) {
  const calls = { rpcParams: [], lookups: 0 };
  __setBillingSupabase(
    makeClient({
      tables: {
        workspace_subscription_events: async () => ({ data: [], error: null }),
        workspace_subscription_profiles: async (mode) =>
          mode === 'maybeSingle' ? { data: null, error: null } : { data: [], error: null },
        workspace_billing_customers: async () => {
          calls.lookups += 1;
          return { data: billingCustomer, error: billingCustomerError };
        },
      },
      rpcImpl: async (name, params) => {
        assert.equal(name, 'xbar_apply_subscription_event');
        calls.rpcParams.push(params);
        return { data: true, error: null };
      },
    }),
  );
  return calls;
}

function retrievesAskedForTheInvoice() {
  return stripeScenario.calls
    .filter(([kind]) => kind === 'retrieve')
    .every(([, , params]) => Array.isArray(params?.expand) && params.expand.includes('latest_invoice'));
}

test('an unpaid checkout (payment still settling) does not grant paid access, as reviewed', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => subscription({ invoiceStatus: 'open' });
  const calls = supabaseFor();

  const response = await deliver(
    checkoutEvent('checkout.session.completed', { eventId: 'evt_unpaid_completed', paymentStatus: 'unpaid' }),
  );

  assert.equal(response.statusCode, 200, 'the event is handled, not retried: settlement arrives as its own event');
  assert.ok(retrievesAskedForTheInvoice(), 'the subscription is read with its first invoice');
  assert.equal(calls.rpcParams.length, 1);
  assert.notEqual(calls.rpcParams[0].p_billing_state, 'Active', 'Stripe says active; the money has not arrived');
  assert.equal(calls.rpcParams[0].p_billing_state, 'Inactive');
});

test('the settled payment grants the purchase', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => subscription({ invoiceStatus: 'paid' });
  const calls = supabaseFor();

  const response = await deliver(
    checkoutEvent('checkout.session.async_payment_succeeded', { eventId: 'evt_async_ok' }),
  );

  assert.equal(response.statusCode, 200);
  assert.ok(retrievesAskedForTheInvoice());
  assert.equal(calls.rpcParams.length, 1, 'async_payment_succeeded is handled, not ignored');
  assert.equal(calls.rpcParams[0].p_billing_state, 'Active');
  assert.equal(calls.rpcParams[0].p_tier, 'Professional');
});

test('a session Stripe reports paid grants even if its invoice reads open a moment longer', async () => {
  stripeScenario.calls = [];
  // The race: the payment succeeded, the re-read invoice has not caught up.
  stripeScenario.retrieveSubscription = async () => subscription({ invoiceStatus: 'open' });
  const calls = supabaseFor();

  const response = await deliver(
    checkoutEvent('checkout.session.async_payment_succeeded', {
      eventId: 'evt_async_ok_race',
      paymentStatus: 'paid',
      invoice: 'in_sub_test_settle',
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(calls.rpcParams[0].p_billing_state, 'Active', "the session's own settlement is the evidence");
});

test('a paid session does not vouch for a different invoice', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => subscription({ invoiceStatus: 'open' });
  const calls = supabaseFor();

  const response = await deliver(
    checkoutEvent('checkout.session.completed', {
      eventId: 'evt_paid_other_invoice',
      paymentStatus: 'paid',
      invoice: 'in_some_other_invoice',
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(calls.rpcParams[0].p_billing_state, 'Inactive');
});

test('a failed settlement does not leave paid access standing, as reviewed', async () => {
  stripeScenario.calls = [];
  // Stripe voids the first invoice and leaves the subscription active.
  stripeScenario.retrieveSubscription = async () => subscription({ invoiceStatus: 'void' });
  const calls = supabaseFor();

  const response = await deliver(
    checkoutEvent('checkout.session.async_payment_failed', { eventId: 'evt_async_failed', paymentStatus: 'unpaid' }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(calls.rpcParams.length, 1, 'async_payment_failed is handled, not acknowledged with nothing written');
  assert.equal(calls.rpcParams[0].p_billing_state, 'Inactive');
});

test('a subscription update cannot grant what the unsettled checkout did not', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => subscription({ invoiceStatus: 'open' });
  const calls = supabaseFor();

  const response = await deliver(
    subscriptionEvent('customer.subscription.updated', {
      eventId: 'evt_update_while_settling',
      subscription: subscription({ invoiceStatus: 'open' }),
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.ok(retrievesAskedForTheInvoice(), 'the update re-reads the subscription with its first invoice');
  assert.equal(calls.rpcParams[0].p_billing_state, 'Inactive');
});

test('a renewal still settling keeps a paying customer entitled', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () =>
    subscription({ invoiceReason: 'subscription_cycle', invoiceStatus: 'open' });
  const calls = supabaseFor();

  const response = await deliver(
    subscriptionEvent('customer.subscription.updated', {
      eventId: 'evt_renewal_settling',
      subscription: subscription({ invoiceReason: 'subscription_cycle', invoiceStatus: 'open' }),
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(calls.rpcParams[0].p_billing_state, 'Active', 'renewals are not held back while they settle');
});

test('a card checkout and a trial still grant at once', async () => {
  for (const [label, sub] of [
    ['card', subscription({ invoiceStatus: 'paid' })],
    ['trial', subscription({ status: 'trialing', invoiceStatus: 'paid' })],
  ]) {
    stripeScenario.calls = [];
    stripeScenario.retrieveSubscription = async () => sub;
    const calls = supabaseFor();
    const response = await deliver(checkoutEvent('checkout.session.completed', { eventId: `evt_grant_${label}` }));
    assert.equal(response.statusCode, 200, label);
    assert.equal(calls.rpcParams[0].p_billing_state, 'Active', `${label} checkout grants`);
  }
});

test('a sibling whose first payment has not settled does not keep a workspace entitled', async () => {
  stripeScenario.calls = [];
  const canceled = subscription({ id: 'sub_canceled', status: 'canceled' });
  stripeScenario.listSubscriptions = async () => ({
    data: [canceled, subscription({ id: 'sub_sibling', invoiceStatus: 'open' })],
    has_more: false,
  });
  const calls = supabaseFor();

  const response = await deliver(
    subscriptionEvent('customer.subscription.deleted', { eventId: 'evt_deleted_sibling', subscription: canceled }),
  );

  assert.equal(response.statusCode, 200);
  const listCall = stripeScenario.calls.find(([kind]) => kind === 'list');
  assert.ok(listCall?.[1]?.expand?.includes('data.latest_invoice'), 'the sibling list carries first invoices');
  assert.equal(calls.rpcParams[0].p_billing_state, 'Inactive', 'an unsettled sibling pays for nothing yet');
  // Nor is it adopted: the row keeps describing the canceled subscription, and
  // the sibling is written by its own events once its payment settles.
  assert.equal(calls.rpcParams[0].p_subscription_id, 'sub_canceled');
  assert.equal(calls.rpcParams[0].p_from_sibling, false);
  stripeScenario.listSubscriptions = async () => ({ data: [], has_more: false });
});

test('a failed customer lookup fails the delivery so Stripe retries it, as reviewed', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => subscription({ status: 'canceled' });
  const calls = supabaseFor({ billingCustomerError: { message: 'canceling statement due to statement timeout' } });

  const response = await deliver(
    subscriptionEvent('customer.subscription.deleted', {
      eventId: 'evt_lookup_timeout',
      subscription: subscription({ status: 'canceled' }),
      workspaceId: null,
    }),
  );

  assert.equal(calls.lookups, 1, 'the event had no workspace metadata, so the customer mapping was consulted');
  assert.ok(response.statusCode >= 500, `a transient lookup failure is retryable, got ${response.statusCode}`);
  assert.deepEqual(calls.rpcParams, [], 'nothing was written');
});

test('a customer with no workspace mapping is still acknowledged', async () => {
  stripeScenario.calls = [];
  const calls = supabaseFor({ billingCustomer: null });

  const response = await deliver(
    subscriptionEvent('customer.subscription.deleted', {
      eventId: 'evt_unmapped_customer',
      subscription: subscription({ status: 'canceled' }),
      workspaceId: null,
    }),
  );

  assert.equal(response.statusCode, 200, 'a subscription this app does not own is not an error');
  assert.deepEqual(calls.rpcParams, []);
});

test('the renewal date is read from the subscription item the pinned API returns, as reviewed', async () => {
  stripeScenario.calls = [];
  stripeScenario.retrieveSubscription = async () => subscription({ invoiceStatus: 'paid' });
  const calls = supabaseFor();

  const response = await deliver(checkoutEvent('checkout.session.completed', { eventId: 'evt_renewal_date' }));

  assert.equal(response.statusCode, 200);
  assert.equal(calls.rpcParams[0].p_profile.renewalDate, PERIOD_END_DATE, 'not blank when the field moved to items');
});

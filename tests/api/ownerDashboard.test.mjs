import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerHandler } from '../../api/_lib/owner-dashboard.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const customer = {
  id: 'cus_customer',
  name: 'Synthetic Ranch',
  email: 'customer@example.invalid',
  address: { secret: 'PRIVATE' },
  metadata: { secret: 'PRIVATE' },
};
const subscription = {
  id: 'sub_first',
  customer,
  status: 'active',
  livemode: true,
  items: {
    data: [
      {
        price: {
          id: 'price_first',
          unit_amount: 2900,
          currency: 'usd',
          recurring: { interval: 'month', interval_count: 1 },
        },
        quantity: 1,
        current_period_end: 1800000000,
      },
    ],
    has_more: false,
  },
  metadata: { secret: 'PRIVATE' },
};

function rig(options = {}) {
  const calls = [];
  const env = {
    XBAR_OWNER_USER_ID: ownerId,
    STRIPE_SECRET_KEY: 'sk_live_synthetic',
    STRIPE_ACCOUNT_ID: 'acct_owner',
    VERCEL_ENV: 'production',
    ...options.env,
  };
  const user = options.user === undefined ? { id: ownerId, email_confirmed_at: '2026-01-01' } : options.user;
  const admin = {
    auth: {
      getUser: async (token) => {
        calls.push(['auth', token]);
        if (options.authThrows) throw new Error('PRIVATE');
        return { data: { user }, error: options.authError };
      },
    },
    from(table) {
      calls.push(['db', table]);
      const query = {
        select() {
          return query;
        },
        in() {
          return query;
        },
        async limit() {
          return {
            error: !options.dbErrorTable || options.dbErrorTable === table ? options.dbError : null,
            count: options.rowCount ?? options.tables?.[table]?.length ?? 1,
            data:
              options.tables?.[table] ??
              {
                workspace_billing_customers: [
                  {
                    workspace_id: 'workspace1',
                    stripe_customer_id: customer.id,
                    stripe_subscription_id: subscription.id,
                  },
                ],
                workspaces: [
                  { id: 'workspace1', name: 'Real mapping', business_name: 'Business name', private: 'PRIVATE' },
                ],
                workspace_subscription_profiles: [
                  {
                    workspace_id: 'workspace1',
                    tier: 'Professional',
                    billing_state: 'Active',
                    updated_at: '2026-01-01',
                  },
                ],
              }[table],
          };
        },
      };
      return query;
    },
  };
  const handler = createOwnerHandler({
    env,
    getAdmin: () => (options.missingAdmin ? null : admin),
    rateLimit: async () => true,
    readReadiness: () => {
      if (options.readinessThrows) throw new Error('PRIVATE');
      return { ok: true };
    },
    makeStripe: () => {
      calls.push(['stripe']);
      return {
        accounts: {
          retrieve: async () => {
            if (options.accountError) throw options.accountError;
            return { id: options.accountId || 'acct_owner' };
          },
        },
        subscriptions: {
          list: async (params) => {
            calls.push(['list', params]);
            if (options.subscriptionError) throw options.subscriptionError;
            if (options.stripeThrows) throw new Error('PRIVATE');
            return options.page ?? { data: [subscription], has_more: true };
          },
        },
      };
    },
  });
  async function request({ token = 'verified-token', method = 'GET', query = '', accessOnly = false } = {}) {
    const res = {
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(body) {
        this.body = body ? JSON.parse(body) : null;
      },
    };
    await handler(
      {
        method,
        url: `/api/account/owner-dashboard${query}`,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      },
      res,
      { accessOnly },
    );
    return res;
  }
  return { request, calls };
}

test('no token, invalid configuration, unverified identities and forged roles cannot read customer data', async () => {
  for (const [options, request, status] of [
    [{}, { token: '' }, 401],
    [{ env: { XBAR_OWNER_USER_ID: '' } }, {}, 503],
    [{ env: { XBAR_OWNER_USER_ID: 'owner@example.invalid' } }, {}, 503],
    [{ user: null }, {}, 401],
    [{ authError: { message: 'PRIVATE' } }, {}, 401],
    [
      {
        user: {
          id: '22222222-2222-4222-8222-222222222222',
          email_confirmed_at: 'now',
          role: 'Admin',
          user_metadata: { owner: true, id: ownerId },
          app_metadata: { role: 'owner' },
        },
      },
      {},
      403,
    ],
    [{ user: { id: ownerId } }, {}, 403],
    [{ authThrows: true }, {}, 503],
    [{ missingAdmin: true }, {}, 503],
  ]) {
    const r = rig(options);
    const res = await r.request(request);
    assert.equal(res.statusCode, status);
    assert.equal(
      r.calls.some(([name]) => ['db', 'stripe', 'list'].includes(name)),
      false,
    );
    assert.equal(JSON.stringify(res.body).includes('PRIVATE'), false);
    assert.match(res.headers['Cache-Control'], /no-store/);
  }
});

test('capability probe verifies the actual token and reads no customer data', async () => {
  const r = rig();
  const res = await r.request({ accessOnly: true });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, owner: true });
  assert.deepEqual(r.calls, [['auth', 'verified-token']]);
  assert.equal(res.headers.Vary, 'Origin, Authorization');
});

test('all statuses and cursor pagination are explicit; customer output is minimized and links bind to the Stripe account', async () => {
  const r = rig();
  const res = await r.request({ query: '?status=past_due&after=sub_prior' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(r.calls.find(([name]) => name === 'list')[1], {
    status: 'past_due',
    limit: 25,
    expand: ['data.customer'],
    starting_after: 'sub_prior',
  });
  assert.equal(res.body.nextCursor, 'sub_first');
  assert.equal(res.body.subscriptions[0].workspaces[0].name, 'Business name');
  assert.equal(res.body.subscriptions[0].prices[0].periodEnd, 1800000000);
  assert.equal(res.body.subscriptions[0].customerUrl, 'https://dashboard.stripe.com/acct_owner/customers/cus_customer');
  assert.equal(JSON.stringify(res.body).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(res.body).includes('stripe_customer_id'), false);
});

test('empty inventory is distinguishable from a failed read and never fabricates totals', async () => {
  const r = rig({ page: { data: [], has_more: false } });
  const res = await r.request();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.subscriptions, []);
  assert.equal(res.body.nextCursor, null);
  assert.equal(
    r.calls.some(([name]) => name === 'db'),
    false,
  );
  for (const options of [
    { dbError: { message: 'PRIVATE' } },
    { rowCount: 1001 },
    { stripeThrows: true },
    { page: { data: [], has_more: true } },
    { page: { data: [] } },
  ]) {
    const failure = await rig(options).request();
    assert.equal(failure.statusCode, 503);
    assert.equal('subscriptions' in failure.body, false);
  }
});

test('an old subscription is not attributed to the current workspace subscription', async () => {
  const res = await rig({
    tables: {
      workspace_billing_customers: [
        { workspace_id: 'workspace1', stripe_customer_id: customer.id, stripe_subscription_id: 'sub_new' },
      ],
    },
  }).request();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.subscriptions[0].workspaces, []);
});

test('wrong Stripe account or mode fails closed, including live credentials in preview', async () => {
  for (const options of [
    { accountId: 'acct_wrong' },
    { env: { VERCEL_ENV: 'preview' } },
    { env: { STRIPE_SECRET_KEY: 'sk_test_synthetic' } },
    { page: { data: [{ ...subscription, livemode: false }], has_more: false } },
  ]) {
    const res = await rig(options).request();
    assert.equal(res.statusCode, 503);
    assert.equal('subscriptions' in res.body, false);
  }
  const res = await rig({
    env: { VERCEL_ENV: 'preview', STRIPE_SECRET_KEY: 'sk_test_synthetic' },
    page: { data: [{ ...subscription, livemode: false }], has_more: false },
  }).request();
  assert.equal(res.statusCode, 200);
  assert.equal(
    res.body.subscriptions[0].subscriptionUrl,
    'https://dashboard.stripe.com/acct_owner/test/subscriptions/sub_first',
  );
});

test('invalid filters, unsupported methods and preflight do not reach billing', async () => {
  for (const [request, expected] of [
    [{ method: 'POST' }, 405],
    [{ method: 'DELETE' }, 405],
    [{ method: 'OPTIONS' }, 204],
    [{ query: '?status=madeup' }, 400],
    [{ query: '?after=sub_bad/path' }, 400],
  ]) {
    const r = rig();
    const res = await r.request(request);
    assert.equal(res.statusCode, expected);
    assert.equal(
      r.calls.some(([name]) => name === 'stripe'),
      false,
    );
  }
});

test('failed owner reads record only fixed diagnostic categories and keep the response private', async () => {
  const privateError = (type) => ({
    type,
    message: 'PRIVATE sk_live_private customer@example.invalid',
    raw: { authorization: 'Bearer PRIVATE', customer: 'cus_private' },
  });
  for (const [options, stage, reason] of [
    [{ missingAdmin: true }, 'identity', 'read_failed'],
    [{ authThrows: true }, 'identity', 'read_failed'],
    [{ accountError: privateError('StripeAuthenticationError') }, 'billing_account', 'authentication_failed'],
    [{ accountError: privateError('PRIVATE') }, 'billing_account', 'read_failed'],
    [{ accountId: 'acct_wrong' }, 'billing_account', 'account_mismatch'],
    [{ subscriptionError: privateError('StripePermissionError') }, 'subscriptions', 'permission_denied'],
    [{ subscriptionError: privateError('StripeConnectionError') }, 'subscriptions', 'connection_failed'],
    [{ subscriptionError: privateError('StripeRateLimitError') }, 'subscriptions', 'rate_limited'],
    [{ subscriptionError: privateError('StripeInvalidRequestError') }, 'subscriptions', 'invalid_request'],
    [{ stripeThrows: true }, 'subscriptions', 'read_failed'],
    [{ page: { data: [], has_more: true } }, 'subscription_validation', 'incomplete_page'],
    [
      { page: { data: [{ ...subscription, livemode: false }], has_more: false } },
      'subscription_validation',
      'unverified_subscription',
    ],
    [
      { page: { data: [{ ...subscription, customer: 'PRIVATE' }], has_more: false } },
      'subscription_validation',
      'missing_customer_identity',
    ],
    [{ rowCount: 1001 }, 'workspace_bindings', 'incomplete_bindings'],
    [{ dbError: privateError('PRIVATE') }, 'workspace_bindings', 'incomplete_bindings'],
    [{ dbError: privateError('PRIVATE'), dbErrorTable: 'workspaces' }, 'workspace_lookup', 'lookup_failed'],
    [{ readinessThrows: true }, 'readiness', 'read_failed'],
  ]) {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      const res = await rig(options).request();
      assert.equal(res.statusCode, 503);
      assert.deepEqual(res.body, {
        ok: false,
        message: 'Customer data could not be verified. Refresh to try again; no accounts or payments were changed.',
      });
      assert.match(res.headers['Cache-Control'], /no-store/);
      assert.deepEqual(warnings, [['Owner dashboard verification refused.', { stage, reason }]]);
    } finally {
      console.warn = originalWarn;
    }
  }
});

test('successful requests and rejected identities do not emit customer-read diagnostics', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    assert.equal((await rig().request()).statusCode, 200);
    assert.equal((await rig().request({ accessOnly: true })).statusCode, 200);
    assert.equal((await rig().request({ token: '' })).statusCode, 401);
    assert.equal((await rig({ user: null }).request()).statusCode, 401);
    assert.equal((await rig({ user: { id: 'someone-else', email_confirmed_at: 'now' } }).request()).statusCode, 403);
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = originalWarn;
  }
});

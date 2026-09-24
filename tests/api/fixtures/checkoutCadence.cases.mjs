// Execute the actual HTTP handler and billing helpers. Only external services
// are substituted; no network, real customer records or credentials are used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const sourceUrl = new URL('../../../api/stripe/checkout.js', import.meta.url);
const clone = (value) => JSON.parse(JSON.stringify(value));
const prices = { Starter: 'STARTER', Professional: 'PROFESSIONAL', 'Ranch Ops': 'RANCH_OPS', Enterprise: 'ENTERPRISE' };
const priceFor = (tier, period) => `price_${prices[tier]}_${period}`;

async function fixture(options = {}) {
  const events = [];
  const sessions = [];
  let row = { stripe_customer_id: 'cus_test', stripe_subscription_id: '', entitlement_payload: {} };
  const env = {
    MANAGED_BILLING_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_test_fixture',
    PUBLIC_APP_URL: 'https://xbar.test',
  };
  for (const [tier, key] of Object.entries(prices)) {
    env[`STRIPE_PRICE_ID_${key}`] = priceFor(tier, 'monthly');
    if (!options.noAnnual) env[`STRIPE_PRICE_ID_${key}_ANNUAL`] = priceFor(tier, 'annual');
  }
  const database = {
    async rpc(name) {
      assert.equal(name, 'xbar_claim_checkout_lock');
      events.push('claim');
      return { data: true, error: null };
    },
    from(table) {
      assert.equal(table, 'workspace_billing_customers');
      let operation = 'read';
      let value;
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        update(payload) {
          operation = 'update';
          value = payload;
          return builder;
        },
        async upsert(payload) {
          events.push('write');
          row = { ...row, ...clone(payload) };
          return { error: null };
        },
        async maybeSingle() {
          return { data: clone(row), error: null };
        },
        then(resolve, reject) {
          assert.equal(operation, 'update');
          events.push(value.checkout_lock_at ? 'renew' : 'release');
          return Promise.resolve({ data: [{ workspace_id: 'ws-test' }], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const stripe = {
    subscriptions: {
      async list() {
        return { data: [], has_more: false };
      },
    },
    customers: {
      async create() {
        throw new Error('Existing customer must be preserved');
      },
    },
    checkout: {
      sessions: {
        async list() {
          return { data: sessions.filter((session) => session.status === 'open').map(clone), has_more: false };
        },
        async create(params) {
          events.push('create');
          const session = {
            ...clone(params),
            id: `cs_${sessions.length}`,
            status: 'open',
            url: `https://checkout.test/${sessions.length}`,
          };
          sessions.push(session);
          return clone(session);
        },
        async expire(id) {
          events.push(`expire:${id}`);
          const session = sessions.find((entry) => entry.id === id);
          assert.ok(session);
          if (options.expireRace) {
            session.status = options.expireRace;
            throw new Error('Injected expiry race');
          }
          session.status = 'expired';
          return clone(session);
        },
        async retrieve(id) {
          return clone(sessions.find((entry) => entry.id === id));
        },
      },
    },
  };
  const context = createContext({ process: { env }, URL, Buffer, console: { warn() {}, error() {} } });
  const services = {
    stripe: {
      default: class {
        constructor() {
          return stripe;
        }
      },
    },
    '../_lib/supabase-admin.js': {
      requireWorkspaceAccess: async () => ({
        ok: true,
        role: options.role ?? 'Admin',
        user: { id: 'u-test' },
        supabase: database,
      }),
    },
    '../_lib/cors.js': { applyCors: () => true },
    '../_lib/rate-limit.js': { enforceRateLimit: async () => true },
  };
  const modules = new Map();
  async function load(specifier, parent) {
    const key = specifier.startsWith('.') ? new URL(specifier, parent).href : specifier;
    if (modules.has(key)) return modules.get(key);
    let module;
    if (services[specifier] || !specifier.startsWith('.')) {
      const exports = services[specifier] ?? (await import(specifier));
      module = new SyntheticModule(
        Object.keys(exports),
        function () {
          for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
        },
        { context, identifier: key },
      );
    } else {
      module = new SourceTextModule(await readFile(new URL(key), 'utf8'), { context, identifier: key });
    }
    modules.set(key, module);
    return module;
  }
  const module = new SourceTextModule(await readFile(sourceUrl, 'utf8'), { context, identifier: sourceUrl.href });
  await module.link((specifier, parent) => load(specifier, parent.identifier));
  await module.evaluate();
  return {
    sessions,
    events,
    async request(tier = 'Professional', billingPeriod = 'monthly', extra = {}) {
      const body = {
        workspaceId: 'ws-test',
        tier,
        billingPeriod,
        returnUrl: 'https://xbar.test/app/billing',
        ...extra,
      };
      const req = {
        method: 'POST',
        headers: { authorization: 'Bearer synthetic' },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify(body));
        },
      };
      const res = {
        setHeader() {},
        end(value) {
          this.body = JSON.parse(value);
        },
      };
      await module.namespace.default(req, res);
      return { status: res.statusCode, ...res.body };
    },
  };
}

for (const tier of Object.keys(prices)) {
  for (const first of ['monthly', 'annual']) {
    test(`${tier}: ${first} checkout, opposite period, then a retry`, async () => {
      const app = await fixture();
      const second = first === 'monthly' ? 'annual' : 'monthly';
      assert.equal((await app.request(tier, first)).status, 200);
      const response = await app.request(tier, second, { priceId: 'price_client_must_not_choose' });
      assert.equal(response.status, 200);
      assert.equal(app.sessions.length, 2);
      assert.equal(app.sessions[0].status, 'expired');
      const current = app.sessions[1];
      assert.deepEqual(current.line_items, [{ price: priceFor(tier, second), quantity: 1 }]);
      assert.equal(current.metadata.workspace_price_id, priceFor(tier, second));
      assert.equal(current.metadata.workspace_billing_period, second);
      assert.equal(response.url, current.url);
      assert.ok(app.events.indexOf('expire:cs_0') < app.events.lastIndexOf('create'));
      const writes = app.events.filter((event) => event === 'write').length;
      assert.equal((await app.request(tier, second)).url, current.url);
      assert.equal(app.sessions.length, 2, 'retry must not create another billable session');
      assert.equal(
        app.events.filter((event) => event === 'write').length,
        writes,
        'reuse must not overwrite webhook state',
      );
    });
  }
}

test('an old session without cadence metadata is closed before replacement', async () => {
  const app = await fixture();
  await app.request();
  delete app.sessions[0].metadata.workspace_price_id;
  delete app.sessions[0].metadata.workspace_billing_period;
  const response = await app.request();
  assert.equal(response.status, 200);
  assert.equal(app.sessions[0].status, 'expired');
  assert.equal(app.sessions.length, 2);
});

test('missing annual configuration never falls back to a monthly checkout', async () => {
  const app = await fixture({ noAnnual: true });
  assert.equal((await app.request('Professional', 'annual')).status, 400);
  assert.equal(app.sessions.length, 0);
  assert.deepEqual(app.events, []);
});

for (const [race, status, code] of [
  ['complete', 409, 'subscription_active'],
  ['open', 503, 'billing_unavailable'],
]) {
  test(`switching periods refuses when the old session is ${race} after expiry fails`, async () => {
    const app = await fixture({ expireRace: race });
    await app.request();
    const response = await app.request('Professional', 'annual');
    assert.equal(response.status, status);
    assert.equal(response.code, code);
    assert.equal(app.sessions.length, 1, 'no second subscription may be created');
    assert.equal(app.events.at(-1), 'release');
  });
}

test('non-admin requests cannot start or replace a checkout', async () => {
  const app = await fixture({ role: 'Owner' });
  assert.equal((await app.request()).status, 403);
  assert.deepEqual(app.events, []);
});

// Real-handler stale-request interleaving with synthetic provider boundaries.
import assert from 'node:assert/strict';

export async function assertDeletionRace(t, handler) {
  const USER = '11111111-1111-4111-8111-111111111111';
  const state = { holds: false, checkoutToken: '', members: [], deletedWithNewMember: false, log: [] };
  let billingReads = 0;
  const resumes = [],
    notifies = [];
  const reached = [0, 1].map(
    (i) =>
      new Promise((resolve) => {
        notifies[i] = resolve;
      }),
  );
  const paused = [0, 1].map(
    (i) =>
      new Promise((resolve) => {
        resumes[i] = resolve;
      }),
  );
  const reply = (data, status = 200) =>
    new Response(status === 204 ? null : JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, 'deletion-fixture.invalid');
    const method = init.method ?? 'GET';
    if (url.pathname === '/auth/v1/user') return reply({ id: USER, email: 'owner@example.invalid' });
    if (url.pathname === '/rest/v1/workspaces' && method === 'GET') return reply([{ id: 'ws1' }]);
    if (url.pathname === '/rest/v1/workspace_memberships' && method === 'GET') return reply(state.members);
    if (url.pathname === '/rest/v1/rpc/xbar_hold_account_deletion_request') {
      if (state.requestToken && !state.requestExpired)
        return reply({ ok: false, reason: 'deletion_in_progress', shared: [], held: [] });
      if (state.members.length) return reply({ ok: false, shared: ['ws1'], held: [] });
      state.requestToken = JSON.parse(init.body).p_request_token;
      state.requestExpired = false;
      state.holds = true;
      state.log.push('placed/refreshed membership holds');
      return reply({ ok: true, shared: [], held: ['ws1'] });
    }
    if (url.pathname === '/rest/v1/rpc/xbar_release_account_deletion_request') {
      if (JSON.parse(init.body).p_request_token !== state.requestToken) {
        state.log.push('stale request cannot release newer membership fence');
        return reply(0);
      }
      state.requestToken = '';
      state.holds = false;
      state.log.push('released own membership holds');
      return reply(1);
    }
    if (url.pathname === '/rest/v1/rpc/xbar_claim_checkout_lock') {
      if (state.requestToken && !state.requestExpired) return reply(false);
      if (state.checkoutToken && !state.expired) {
        state.log.push('second request denied checkout claim');
        return reply(false);
      }
      if (state.expired) state.log.push('second request legitimately takes expired checkout lease');
      state.expired = false;
      state.checkoutToken = JSON.parse(init.body).p_token;
      state.log.push('first request claimed checkout');
      return reply(true);
    }
    if (url.pathname === '/rest/v1/workspace_billing_customers' && method === 'GET') {
      const index = billingReads++;
      notifies[index]();
      await paused[index];
      return reply({ workspace_id: 'ws1', stripe_customer_id: '', stripe_subscription_id: '' });
    }
    if (url.pathname === '/rest/v1/workspace_billing_customers' && method === 'PATCH') {
      const token = url.searchParams.get('checkout_lock_token');
      if (token !== `eq.${state.checkoutToken}`) {
        state.log.push('stale request does not own checkout token');
        return reply([]);
      }
      if (JSON.parse(init.body).checkout_lock_token === null) {
        state.checkoutToken = '';
        return reply(null, 204);
      }
      state.log.push('first request successfully renewed checkout');
      return reply([{ workspace_id: 'ws1' }]);
    }
    if (url.pathname === '/rest/v1/account_deletion_receipts' && method === 'POST')
      return reply({ id: 'receipt-1' }, 201);
    if (url.pathname === '/rest/v1/account_deletion_receipts' && method === 'PATCH') return reply(null, 204);
    if (url.pathname === '/rest/v1/workspace_subscription_profiles') return reply(null);
    if (url.pathname === '/rest/v1/rpc/xbar_confirm_account_deletion_request')
      return reply(
        JSON.parse(init.body).p_request_token === state.requestToken &&
          state.holds &&
          !state.requestExpired &&
          state.members.length === 0,
      );
    if (url.pathname === '/rest/v1/documents') return reply([]);
    if (url.pathname === `/auth/v1/admin/users/${USER}` && method === 'DELETE') {
      state.deletedWithNewMember = state.members.length > 0;
      state.log.push(`auth deleted, membership hold=${state.holds}, other members=${state.members.length}`);
      return reply({});
    }
    if (url.pathname === '/rest/v1/workspaces' && method === 'DELETE') return reply(null, 204);
    if (url.pathname.startsWith('/storage/v1/object/list/')) return reply([]);
    throw new Error(`Unexpected mock call ${method} ${url.pathname}`);
  });
  async function invoke(ip) {
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-token', 'x-real-ip': ip },
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({ confirmation: 'owner@example.invalid' });
      },
    };
    const res = {
      statusCode: 0,
      body: '',
      setHeader() {},
      end(body) {
        this.body = body;
      },
    };
    await handler(req, res);
    return { status: res.statusCode, body: JSON.parse(res.body) };
  }
  const firstPromise = invoke('review-A');
  await reached[0];
  // Simulate more than CHECKOUT_LOCK_MS elapsing; RPC permits takeover.
  state.expired = true;
  state.requestExpired = true;
  const secondPromise = invoke('review-B');
  await reached[1];
  resumes[0]();
  const first = await firstPromise;
  assert.equal(first.status, 503);
  assert.equal(state.holds, true, 'stale first request must not release second request membership fence');
  if (!state.holds) state.members.push({ user_id: '22222222-2222-4222-8222-222222222222', role: 'Admin' });
  else state.log.push('membership insertion denied by surviving hold');
  resumes[1]();
  const second = await secondPromise;
  assert.equal(second.status, 200);
  assert.equal(state.deletedWithNewMember, false);
  assert.ok(state.log.includes('stale request cannot release newer membership fence'));
  assert.ok(state.log.includes('membership insertion denied by surviving hold'));
}

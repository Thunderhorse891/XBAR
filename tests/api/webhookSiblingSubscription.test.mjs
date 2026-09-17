import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { findEntitlingSibling } from '../../api/stripe/webhook.js';

/*
 * A workspace must not be deactivated while another subscription still pays.
 *
 * The workspace billing row is per-workspace; Stripe subscriptions are per
 * CUSTOMER, and a customer can have more than one. The checkout lock in this
 * change exists because the previous flow could create a second Checkout
 * Session for the same workspace, so duplicates are the state this branch was
 * written without rather than a hypothetical one.
 *
 * Cancelling either one used to deactivate the whole workspace: the deleted
 * payload was the final word, the row was overwritten with `Inactive` and the
 * canceled id, and the sibling went on charging. The customer keeps paying and
 * loses access — the worse of the two directions to be wrong in.
 */
/*
 * A fake that PAGES, because the real endpoint does. `pageSize` splits the
 * subscriptions across pages and reports `has_more` exactly as Stripe would —
 * a fake that always answers in one page cannot fail when the code forgets to
 * look past the first.
 */
function stripeWith(subscriptions, { pageSize = 100, truncate = false } = {}) {
  const calls = [];
  return {
    calls,
    subscriptions: {
      list: async (params) => {
        calls.push(params);
        const after = params.starting_after;
        const from = after ? subscriptions.findIndex((s) => s.id === after) + 1 : 0;
        const data = subscriptions.slice(from, from + pageSize);
        const hasMore = truncate || from + pageSize < subscriptions.length;
        return { data, has_more: hasMore };
      },
    },
  };
}

test('an active sibling is found when another subscription is canceled', async () => {
  const stripe = stripeWith([
    { id: 'sub_canceled', status: 'canceled' },
    { id: 'sub_live', status: 'active' },
  ]);

  const sibling = await findEntitlingSibling(stripe, 'cus_1', 'sub_canceled');
  assert.equal(sibling?.id, 'sub_live', 'the paying subscription must be preserved');
});

test('the canceled subscription is never its own sibling', async () => {
  // `status: 'all'` returns the subscription the event is about, and a
  // just-canceled one can still read as `active` for a moment. Matching it
  // would keep a workspace entitled by the very subscription that ended.
  const stripe = stripeWith([{ id: 'sub_canceled', status: 'active' }]);

  assert.equal(await findEntitlingSibling(stripe, 'cus_1', 'sub_canceled'), null);
});

test('trialing entitles, and the entitlement policy decides which statuses do', async () => {
  // Not a hardcoded list here: `billingStateForStripeStatus` is the one place
  // that decides, so a status added there is honoured here without editing this.
  const stripe = stripeWith([
    { id: 'sub_dead', status: 'canceled' },
    { id: 'sub_trial', status: 'trialing' },
  ]);

  assert.equal((await findEntitlingSibling(stripe, 'cus_1', 'sub_dead'))?.id, 'sub_trial');
});

test('a past-due sibling does not keep a workspace entitled', async () => {
  // Past Due is its own billing state and is NOT entitling. Treating it as a
  // reason to stay active would grant paid features to an account that is
  // failing to pay — the over-correction this guard must not make.
  const stripe = stripeWith([
    { id: 'sub_dead', status: 'canceled' },
    { id: 'sub_late', status: 'past_due' },
  ]);

  assert.equal(await findEntitlingSibling(stripe, 'cus_1', 'sub_dead'), null);
});

test('the ordinary single-subscription cancellation still deactivates', async () => {
  const stripe = stripeWith([{ id: 'sub_only', status: 'canceled' }]);

  assert.equal(
    await findEntitlingSibling(stripe, 'cus_1', 'sub_only'),
    null,
    'no sibling means the cancellation is applied, which is the common case',
  );
});

test('every subscription on the customer is considered, not just the first page', async () => {
  const stripe = stripeWith([{ id: 'sub_dead', status: 'canceled' }]);
  await findEntitlingSibling(stripe, 'cus_1', 'sub_dead');

  const [params] = stripe.calls;
  assert.equal(params.customer, 'cus_1');
  assert.equal(params.status, 'all', 'a canceled-only filter would miss the active sibling entirely');
});

/*
 * The paying sibling on page two.
 *
 * The first version of this asked for one page of 100 and ignored `has_more` —
 * the identical mistake `collectStripePages` was written to fix for open
 * Checkout Sessions. A customer with a long subscription history would have had
 * the live subscription sitting past the page boundary and been deactivated
 * anyway, which is the whole failure this function exists to prevent.
 */
test('a sibling beyond the first page is still found', async () => {
  const history = Array.from({ length: 7 }, (_, i) => ({ id: `sub_old_${i}`, status: 'canceled' }));
  const stripe = stripeWith([...history, { id: 'sub_live', status: 'active' }], { pageSize: 3 });

  const sibling = await findEntitlingSibling(stripe, 'cus_1', 'sub_old_0');
  assert.equal(sibling?.id, 'sub_live', 'the walk must continue while has_more is set');
  assert.ok(stripe.calls.length > 1, 'one call is one page, not the answer');
  assert.equal(stripe.calls[1].starting_after, 'sub_old_2', 'each page continues from the last id');
});

/*
 * A walk that could not finish must NOT read as "no sibling". A partial list
 * cannot show that nothing else is paying, and the rule this flow already
 * follows is that unknown is not permission — there, not permission to charge;
 * here, not permission to cut off access.
 */
test('an incomplete walk refuses rather than deactivating', async () => {
  const stripe = stripeWith([{ id: 'sub_dead', status: 'canceled' }], { truncate: true });

  await assert.rejects(() => findEntitlingSibling(stripe, 'cus_1', 'sub_dead'), /refusing to deactivate/);
});

/*
 * A list call that fails leaves the question unanswered, and answering it
 * wrongly deactivates a paying customer. It must throw so nothing is written
 * and Stripe retries — the same choice the profile read makes.
 */
test('a failed lookup is not treated as "no sibling"', async () => {
  const stripe = {
    subscriptions: {
      list: async () => {
        throw new Error('stripe unreachable');
      },
    },
  };

  await assert.rejects(() => findEntitlingSibling(stripe, 'cus_1', 'sub_dead'), /stripe unreachable/);
});

test('the sibling lookup runs only when the event would deactivate', () => {
  const source = readFileSync('api/stripe/webhook.js', 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  assert.match(
    code,
    /if \(customerId && !isEntitledBillingState\(billingStateForStripeStatus\(effective\.status\)\)\) \{/,
    'an entitling event must not pay for an extra Stripe round trip',
  );
  // The row has to name the subscription it describes, or a workspace kept
  // alive by a sibling would store the canceled subscription's id.
  assert.match(code, /subscriptionId: effective\.id \|\| payload\.id,/, 'the adopted sibling must be what is recorded');
  assert.doesNotMatch(code, /subscriptionId: payload\.id,/, 'the canceled id must not be written over the live one');
});

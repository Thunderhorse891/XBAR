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
function stripeWith(subscriptions) {
  const calls = [];
  return {
    calls,
    subscriptions: {
      list: async (params) => {
        calls.push(params);
        return { data: subscriptions };
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
  assert.ok(params.limit >= 100, 'a small page could hide the paying subscription behind the dead ones');
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

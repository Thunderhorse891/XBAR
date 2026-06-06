import assert from 'node:assert/strict';
import test from 'node:test';
import { productEvent, productEventNames } from '../src/lib/productEvents.js';

test('subscriber journey events use stable names and structured payloads', () => { const event = productEvent(productEventNames.checkoutStarted, { tier: 'Ranch Ops', source: 'subscriptions' }); assert.deepEqual(event, { eventName: 'billing.checkout_started', payload: { tier: 'Ranch Ops', source: 'subscriptions' } }); });
test('follow-up action event name stays stable for retention reporting', () => { assert.equal(productEventNames.followUpAction, 'sales.follow_up_action'); });

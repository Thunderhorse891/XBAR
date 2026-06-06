import assert from 'node:assert/strict';
import test from 'node:test';
import { productEvent, productEventNames } from '../src/lib/productEvents.js';

test('subscriber journey events use stable names and structured payloads', () => { const event = productEvent(productEventNames.checkoutStarted, { tier: 'Ranch Ops', source: 'subscriptions' }); assert.deepEqual(event, { eventName: 'billing.checkout_started', payload: { tier: 'Ranch Ops', source: 'subscriptions' } }); });
test('follow-up action event name stays stable for retention reporting', () => { assert.equal(productEventNames.followUpAction, 'sales.follow_up_action'); });
test('public acquisition events distinguish general calls to action from plan selections', () => { assert.equal(productEventNames.landingCtaClicked, 'acquisition.landing_cta_clicked'); assert.equal(productEventNames.landingPlanSelected, 'acquisition.landing_plan_selected'); });
test('first-value activation has a stable retention event', () => { assert.equal(productEventNames.activationFirstValueReached, 'activation.first_value_reached'); });
test('local evaluation entry is measurable without implying an account', () => { assert.equal(productEventNames.localWorkspaceEntered, 'acquisition.local_workspace_entered'); });

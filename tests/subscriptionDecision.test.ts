import assert from 'node:assert/strict';
import test from 'node:test';
import { getCheckoutReadiness, planOutcomes, recommendedTier } from '../src/lib/subscriptionDecision.js';

test('checkout is unavailable without billing permission', () => { const result = getCheckoutReadiness({ canManageBilling: false, hasManagedIdentity: true, hasPaymentLink: true, checkoutInProgress: false }); assert.equal(result.ready, false); assert.match(result.reason, /workspace owner/); });
test('local workspaces need a payment link before checkout is offered', () => { const result = getCheckoutReadiness({ canManageBilling: true, hasManagedIdentity: false, hasPaymentLink: false, checkoutInProgress: false }); assert.equal(result.ready, false); assert.match(result.reason, /Sign in/); });
test('managed identity or a payment link makes checkout available', () => { assert.equal(getCheckoutReadiness({ canManageBilling: true, hasManagedIdentity: true, hasPaymentLink: false, checkoutInProgress: false }).ready, true); assert.equal(getCheckoutReadiness({ canManageBilling: true, hasManagedIdentity: false, hasPaymentLink: true, checkoutInProgress: false }).ready, true); });
test('recommendation moves one operating level at a time and respects selection', () => { assert.equal(recommendedTier('Starter'), 'Professional'); assert.equal(recommendedTier('Enterprise'), 'Enterprise'); assert.equal(recommendedTier('Starter', 'Ranch Ops'), 'Ranch Ops'); assert.match(planOutcomes['Ranch Ops'].join(' '), /one rhythm/); });

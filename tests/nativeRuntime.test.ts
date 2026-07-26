import assert from 'node:assert/strict';
import test from 'node:test';
import { detectNativeRuntime } from '../src/lib/nativeRuntime.js';
import { getCheckoutReadiness, inAppPurchaseUnavailableReason } from '../src/lib/subscriptionDecision.js';

function capacitorGlobal(platform: string, isNative: boolean) {
  return { Capacitor: { getPlatform: () => platform, isNativePlatform: () => isNative } };
}

test('a plain browser window is never treated as a native shell', () => {
  const runtime = detectNativeRuntime({});
  assert.deepEqual(runtime, { isNative: false, platform: 'web', isNativeIos: false, isNativeAndroid: false });
});

test('missing or non-object globals fall back to the web runtime', () => {
  for (const value of [undefined, null, 'window', 42]) {
    assert.equal(detectNativeRuntime(value).isNative, false);
  }
  assert.equal(detectNativeRuntime({ Capacitor: undefined }).isNative, false);
  assert.equal(detectNativeRuntime({ Capacitor: 'yes' }).isNative, false);
});

test('the iOS binary is detected as a native iOS runtime', () => {
  const runtime = detectNativeRuntime(capacitorGlobal('ios', true));
  assert.deepEqual(runtime, { isNative: true, platform: 'ios', isNativeIos: true, isNativeAndroid: false });
});

test('the Android binary is native but not iOS', () => {
  const runtime = detectNativeRuntime(capacitorGlobal('android', true));
  assert.equal(runtime.isNative, true);
  assert.equal(runtime.isNativeIos, false);
  assert.equal(runtime.isNativeAndroid, true);
});

test('a live Capacitor bridge served to a browser (cap serve) stays web', () => {
  // Capacitor injects its global during `cap serve` too, reporting platform
  // 'web'. Treating that as native would hide checkout from a desktop browser.
  const runtime = detectNativeRuntime(capacitorGlobal('web', false));
  assert.equal(runtime.isNative, false);
  assert.equal(runtime.platform, 'web');
});

test('an unknown platform name is not trusted even when the native flag is set', () => {
  const runtime = detectNativeRuntime(capacitorGlobal('electron', true));
  assert.equal(runtime.isNative, false);
  assert.equal(runtime.platform, 'web');
});

test('a throwing Capacitor bridge degrades to the property fallbacks', () => {
  const runtime = detectNativeRuntime({
    Capacitor: {
      getPlatform: () => {
        throw new Error('bridge not ready');
      },
      isNativePlatform: () => {
        throw new Error('bridge not ready');
      },
      platform: 'ios',
      isNative: true,
    },
  });
  assert.equal(runtime.isNativeIos, true);
});

test('older Capacitor globals without the accessor functions still resolve', () => {
  const runtime = detectNativeRuntime({ Capacitor: { platform: 'ios', isNative: true } });
  assert.equal(runtime.isNativeIos, true);
});

test('Guideline 3.1.1: the iOS build never offers a purchase, whatever else is configured', () => {
  const readiness = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
    purchaseBlockedInApp: true,
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.mode, 'unavailable-in-app');
  assert.equal(readiness.reason, inAppPurchaseUnavailableReason);
});

test('the in-app block outranks every other checkout condition', () => {
  // Each of these on its own produces a different mode on the web. Inside the
  // iOS build they must all collapse to the same "not sold here" answer, so no
  // combination of role, session, or Stripe state can surface a buy path.
  const variations = [
    { canManageBilling: false, hasManagedIdentity: true, hasPaymentLink: true, billingEnabled: true },
    { canManageBilling: true, hasManagedIdentity: false, hasPaymentLink: false, billingEnabled: false },
    { canManageBilling: true, hasManagedIdentity: false, hasPaymentLink: false, billingEnabled: true },
    { canManageBilling: true, hasManagedIdentity: true, hasPaymentLink: false, billingEnabled: false },
  ];

  for (const variation of variations) {
    const readiness = getCheckoutReadiness({ ...variation, checkoutInProgress: false, purchaseBlockedInApp: true });
    assert.equal(readiness.ready, false);
    assert.equal(readiness.mode, 'unavailable-in-app');
  }
});

test('the web build is unaffected by the new flag', () => {
  const explicitlyAllowed = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
    purchaseBlockedInApp: false,
  });
  const omitted = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
  });

  assert.equal(explicitlyAllowed.ready, true);
  assert.deepEqual(omitted, explicitlyAllowed);
});

test('the unavailable copy tells the user where their plan actually lives', () => {
  // App Review reads this string. It must not read as a broken feature, and it
  // must not be a link or instruction to buy elsewhere in the app.
  assert.match(inAppPurchaseUnavailableReason, /not sold in the iOS app/i);
  assert.match(inAppPurchaseUnavailableReason, /web browser/i);
  assert.doesNotMatch(inAppPurchaseUnavailableReason, /https?:\/\//);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { canPresentPurchaseFlow, isNativeApp, nativePlatform } from '../src/lib/nativePlatform.js';

// These run under plain node, where there is no import.meta.env and no window,
// so they exercise the runtime-detection half of the module: the fallbacks must
// be safe (a bare web page is not a store build) and window.Capacitor must be
// honored when the native shell injects it.

type CapacitorWindow = { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };

function withWindow(value: CapacitorWindow | undefined, run: () => void) {
  const globals = globalThis as { window?: CapacitorWindow };
  const had = 'window' in globals;
  const previous = globals.window;
  if (value === undefined) delete globals.window;
  else globals.window = value;
  try {
    run();
  } finally {
    if (had) globals.window = previous;
    else delete globals.window;
  }
}

test('no window and no build flag is treated as web, not native', () => {
  withWindow(undefined, () => {
    assert.equal(isNativeApp(), false);
    assert.equal(nativePlatform(), 'web');
    assert.equal(canPresentPurchaseFlow(), true);
  });
});

test('a plain browser page without Capacitor is web', () => {
  withWindow({}, () => {
    assert.equal(isNativeApp(), false);
    assert.equal(canPresentPurchaseFlow(), true);
  });
});

test('the Capacitor native shell closes the purchase flow', () => {
  withWindow({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }, () => {
    assert.equal(isNativeApp(), true);
    assert.equal(nativePlatform(), 'ios');
    assert.equal(canPresentPurchaseFlow(), false);
  });
});

test('android is detected as a store build too', () => {
  withWindow({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }, () => {
    assert.equal(isNativeApp(), true);
    assert.equal(nativePlatform(), 'android');
    assert.equal(canPresentPurchaseFlow(), false);
  });
});

test('Capacitor present but reporting web (a browser preview) keeps checkout open', () => {
  withWindow({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }, () => {
    assert.equal(isNativeApp(), false);
    assert.equal(nativePlatform(), 'web');
    assert.equal(canPresentPurchaseFlow(), true);
  });
});

test('a throwing Capacitor shim never crashes the paywall decision', () => {
  withWindow(
    {
      Capacitor: {
        isNativePlatform: () => {
          throw new Error('bridge not ready');
        },
      },
    },
    () => {
      assert.equal(isNativeApp(), false);
      assert.equal(canPresentPurchaseFlow(), true);
    },
  );
});

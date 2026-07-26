// Native (Capacitor) shell detection.
//
// XBAR ships the same Vite bundle to three places: the browser, an installed
// PWA, and a Capacitor WKWebView/WebView wrapped as an App Store / Play Store
// binary. A few behaviours must differ in the native shell — most importantly
// Apple's Guideline 3.1.1, which forbids selling digital subscriptions inside
// an iOS app through anything other than In-App Purchase.
//
// Capacitor injects a `window.Capacitor` global into the WebView before the
// app bundle runs. Reading that global directly (instead of importing
// `@capacitor/core`) keeps this module dependency-free, keeps the web bundle
// from carrying the native bridge, and makes the detection a pure function
// that unit tests can drive with a fake global.

export type NativePlatform = 'ios' | 'android' | 'web';

export type NativeRuntime = {
  /** True only inside a Capacitor native binary (never in a browser or PWA). */
  isNative: boolean;
  platform: NativePlatform;
  /** True inside the iOS binary — the platform Guideline 3.1.1 applies to. */
  isNativeIos: boolean;
  isNativeAndroid: boolean;
};

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  /** Set by older Capacitor versions; kept as a fallback. */
  platform?: string;
  isNative?: boolean;
};

type RuntimeGlobal = {
  Capacitor?: CapacitorGlobal;
};

const webRuntime: NativeRuntime = {
  isNative: false,
  platform: 'web',
  isNativeIos: false,
  isNativeAndroid: false,
};

function normalizePlatform(value: unknown): NativePlatform {
  return value === 'ios' || value === 'android' ? value : 'web';
}

function readNativeFlag(capacitor: CapacitorGlobal) {
  if (typeof capacitor.isNativePlatform === 'function') {
    try {
      return capacitor.isNativePlatform() === true;
    } catch {
      // Fall through to the property fallbacks below.
    }
  }

  return capacitor.isNative === true;
}

function readPlatform(capacitor: CapacitorGlobal): NativePlatform {
  if (typeof capacitor.getPlatform === 'function') {
    try {
      return normalizePlatform(capacitor.getPlatform());
    } catch {
      // Fall through to the property fallback below.
    }
  }

  return normalizePlatform(capacitor.platform);
}

/**
 * Pure detection against an arbitrary global object. Exported for tests and
 * for the cached accessors below.
 */
export function detectNativeRuntime(globalLike: unknown): NativeRuntime {
  if (!globalLike || typeof globalLike !== 'object') {
    return webRuntime;
  }

  const capacitor = (globalLike as RuntimeGlobal).Capacitor;
  if (!capacitor || typeof capacitor !== 'object') {
    return webRuntime;
  }

  const platform = readPlatform(capacitor);
  // A native platform name alone is not proof: Capacitor reports 'web' with a
  // live bridge during `cap serve`. Require both signals, and treat a native
  // flag with an unknown platform name as web so no gate silently misfires.
  const isNative = readNativeFlag(capacitor) && platform !== 'web';

  return {
    isNative,
    platform: isNative ? platform : 'web',
    isNativeIos: isNative && platform === 'ios',
    isNativeAndroid: isNative && platform === 'android',
  };
}

let cached: NativeRuntime | null = null;

/**
 * The runtime for this page. Capacitor's global is injected before the bundle
 * evaluates and never changes for the life of the WebView, so the result is
 * cached after the first read.
 */
export function nativeRuntime(): NativeRuntime {
  if (cached) {
    return cached;
  }

  cached = detectNativeRuntime(typeof window === 'undefined' ? undefined : window);
  return cached;
}

/** Test-only: drop the memoized runtime so a fresh global can be detected. */
export function resetNativeRuntimeCache() {
  cached = null;
}

export function isNativeApp() {
  return nativeRuntime().isNative;
}

export function isNativeIosApp() {
  return nativeRuntime().isNativeIos;
}

/**
 * Apple Guideline 3.1.1: digital subscriptions unlocking features inside an
 * iOS app must use In-App Purchase. XBAR sells its plans through Stripe on the
 * web, so the iOS binary must not present a purchase — or a path to one.
 * Google Play's equivalent policy allows more, and XBAR's Android build is not
 * a submission target yet, so this is scoped to iOS only.
 */
export function isExternalPurchaseBlocked() {
  return nativeRuntime().isNativeIos;
}

/**
 * Marks the document so CSS can apply native-only chrome (safe-area insets
 * under the notch/Dynamic Island and above the home indicator). Called once at
 * boot; a no-op in the browser, where the page is laid out by the OS chrome.
 */
export function applyNativeShellFlags(
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
) {
  const runtime = nativeRuntime();
  if (!doc || !runtime.isNative) {
    return runtime;
  }

  doc.documentElement.classList.add('is-native-app');
  doc.documentElement.classList.add(`is-native-${runtime.platform}`);
  doc.documentElement.dataset.nativePlatform = runtime.platform;
  return runtime;
}

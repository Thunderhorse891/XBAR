/**
 * Native (Capacitor) runtime detection.
 *
 * The same bundle ships to the web and, wrapped in a WKWebView/WebView, to the
 * App Store and Play Store. A few things are legal on the web but not inside a
 * native store build — most importantly buying a subscription, which Apple
 * requires to go through In-App Purchase (App Store Review Guideline 3.1.1).
 *
 * Detection is deliberately belt-and-braces:
 *  - `VITE_NATIVE_APP` is set by `scripts/build-mobile.mjs`, so a mobile bundle
 *    is native even before Capacitor's runtime is injected (i.e. during the
 *    first paint, when a paywall could otherwise flash).
 *  - `window.Capacitor.isNativePlatform()` covers any bundle running inside the
 *    native shell regardless of how it was built.
 *
 * Reading `window.Capacitor` directly rather than importing `@capacitor/core`
 * keeps the Capacitor runtime out of the web bundle.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

// Same guarded access platformConfig.ts uses: these modules are compiled and
// imported by the node test suites, where import.meta.env does not exist.
const env = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}) as Record<
  string,
  string | undefined
>;

function capacitor(): CapacitorGlobal | undefined {
  return typeof window === 'undefined' ? undefined : window.Capacitor;
}

/** True inside an iOS or Android store build. */
export function isNativeApp(): boolean {
  if (env.VITE_NATIVE_APP === 'true') return true;
  try {
    return Boolean(capacitor()?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/**
 * Whether Capacitor's native bridge is actually live in this page.
 *
 * Distinct from isNativeApp(), and the distinction matters. isNativeApp() is
 * true as soon as the build-time flag is set, which is what makes purchase
 * gating safe from the first paint. Capacitor plugins, though, only work when
 * the bridge itself is present — so anything that calls a plugin must ask this
 * instead, or it will try to talk to a bridge that is not there.
 */
export function hasNativeBridge(): boolean {
  try {
    return Boolean(capacitor()?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** The native platform name, or 'web' when this is not a store build. */
export function nativePlatform(): 'ios' | 'android' | 'web' {
  try {
    const platform = capacitor()?.getPlatform?.();
    if (platform === 'ios' || platform === 'android') return platform;
  } catch {
    /* fall through to the build-time signal below */
  }
  return isNativeApp() ? 'ios' : 'web';
}

/**
 * Whether this build may present a purchase flow at all.
 *
 * False in every native store build. Apple forbids buttons, external links, or
 * other calls to action that send a customer to a non-IAP purchase mechanism,
 * so the native build shows plan state only and says billing is handled
 * outside the app — it never links out to Stripe.
 */
export function canPresentPurchaseFlow(): boolean {
  return !isNativeApp();
}

/**
 * Resolve a link that lives on the marketing site (/privacy, /terms, …).
 *
 * On the web these are same-origin paths served by the static site. A store
 * build ships only the SPA shell — the marketing pages are not in the bundle
 * and there is no server to route them — so a bare "/privacy" is a dead link,
 * and App Review rejects broken links under Guideline 2.1. Given a configured
 * public origin, resolve it to the real site instead.
 *
 * Returns the path unchanged when no origin is configured, so web behavior and
 * existing tests are untouched.
 */
export function publicSiteHref(path: string): string {
  if (!isNativeApp()) return path;
  return publicSiteOrigin() ? `${publicSiteOrigin()}${path}` : path;
}

/**
 * Origin of the MARKETING site, which is not the same thing as the app.
 *
 * These were one variable and that was wrong in a way only the deployed layout
 * shows. `npm run build` moves the SPA shell to `app.html`, served under
 * `/app/*`, and replaces `/` with static marketing HTML that has no router and
 * does nothing with a hash. So the two live at different paths on one origin:
 * `/privacy` and `/terms` are marketing pages, and every in-app route is under
 * `/app`.
 *
 * Reusing one value meant whichever consumer was wrong stayed silently wrong —
 * either legal links pointing into the SPA, or share links pointing at the
 * marketing homepage, which renders and looks fine while showing the wrong page.
 */
function publicSiteOrigin(): string {
  const site = (env.VITE_PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '');
  if (site) return site;
  // Falls back to the app origin with any `/app` base removed, so a deployment
  // that only sets the app URL still gets working legal links.
  return (env.VITE_PUBLIC_APP_URL ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/app$/, '');
}

/**
 * Whether third-party (OAuth) sign-in can be offered.
 *
 * False in a store build. `supabase.auth.signInWithOAuth` navigates the current
 * WebView to the provider, and inside Capacitor that means an embedded
 * WKWebView with a `capacitor://localhost` return URL: Google refuses OAuth in
 * embedded webviews, and that scheme is not a valid provider redirect. Offering
 * a button that cannot complete is a broken feature under Guideline 2.1, so the
 * store build shows email/password and one-time-code sign-in only.
 *
 * Restoring these on native means running the flow through
 * ASWebAuthenticationSession (e.g. @capacitor/browser) with a registered deep
 * link — native work that has to be verified on a device.
 */
export function canPresentThirdPartySignIn(): boolean {
  return !isNativeApp();
}

/**
 * Origin an emailed auth callback should return to.
 *
 * Supabase builds magic-link and password-reset URLs from whatever origin the
 * caller supplies. On the web that is correctly the current page. Inside a
 * store build the page origin is `capacitor://localhost` — a scheme no email
 * client can open and that Supabase will not accept as a redirect — so the
 * emailed link would be dead on arrival.
 *
 * Returning the public site origin at least lands the customer somewhere real.
 * It signs them in on the web rather than in the app, which is why
 * `sendEmailCode` / `verifyEmailCode` exist: a code is verified in-app and
 * needs no callback at all.
 *
 * Returns undefined when there is nothing sensible to use, which tells the
 * Supabase client to fall back to the project's configured Site URL.
 */
export function authCallbackOrigin(): string | undefined {
  if (isNativeApp()) {
    const origin = (env.VITE_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '');
    return origin || undefined;
  }
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}${window.location.pathname}`;
}

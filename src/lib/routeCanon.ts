// Canonical product routes and legacy redirects. One route per product area:
// /horses /documents /sales /buyers /sale-packets /billing /settings
// Legacy paths must stay in this map (and keep redirecting) so old links,
// bookmarks, and cached PWA shells never dead-end.
//
// The authenticated application is served under /app (the router basename).
// Every path in this file is basename-relative: "/horses" is /app/horses in
// the browser. The public marketing site owns "/" and is prerendered static
// HTML (see scripts/build-marketing.mjs) — it never loads the application.

/** Browser base path for the authenticated SPA (React Router basename). */
export const appBasePath = '/app';

/** Where a Supabase password-recovery link returns the customer. */
export const passwordResetPath = '/reset-password';
export const loginPath = '/login';

export const canonicalRoutes = {
  horses: '/horses',
  documents: '/documents',
  sales: '/sales',
  buyers: '/buyers',
  salePackets: '/sale-packets',
  financials: '/financials',
  billing: '/billing',
  settings: '/settings',
} as const;

/** Legacy path -> canonical path. Param routes are handled separately. */
export const legacyRouteRedirects: Record<string, string> = {
  '/animals': canonicalRoutes.horses,
  '/documents-vault': canonicalRoutes.documents,
  '/document-library': canonicalRoutes.documents,
  '/sales-pipeline': canonicalRoutes.sales,
  '/buyer-deal-room': canonicalRoutes.buyers,
  '/buyer-follow-up': canonicalRoutes.buyers,
  '/follow-ups': canonicalRoutes.buyers,
  '/sale-packet-studio': canonicalRoutes.salePackets,
  '/plans': canonicalRoutes.billing,
  '/subscribe': canonicalRoutes.billing,
  '/subscriptions': canonicalRoutes.billing,
};

/*
 * Where the router actually lives, for code that has to build a URL to an
 * in-app route from outside the router.
 *
 * The app runs under two routing shapes: a BrowserRouter based at /app, and a
 * HashRouter for GitHub Pages previews and the packaged mobile bundle. A link
 * built for the wrong one does not error -- it lands on the marketing site or
 * a blank page, which is how a wrong link survives review.
 *
 * This rule was already written out twice, in App.tsx and main.tsx, and a
 * third copy for the password-recovery email is how those copies start to
 * disagree. Both now call this.
 */

// Guarded access, as in nativePlatform.ts: this module is compiled and
// imported by the node test suites, where import.meta.env does not exist.
const routeEnv = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}) as Record<
  string,
  string | undefined
>;

export function usesHashRouting(): boolean {
  if (typeof window === 'undefined' || routeEnv.MODE === 'e2e') return false;
  return routeEnv.VITE_ROUTER_MODE === 'hash' || window.location.hostname.endsWith('.github.io');
}

/**
 * Where a Supabase auth email should return the customer.
 *
 * Under the browser router this is the route itself, and Supabase appends its
 * own fragment after it harmlessly.
 *
 * Under the HASH router it deliberately is NOT the route. The client runs on
 * Supabase's default implicit flow, which returns the session in the URL
 * fragment (`#access_token=...`), and on a hash router the route lives in that
 * same fragment. A link ending `#/reset-password` would come back as
 * `#/reset-password#access_token=...`: the browser treats everything after the
 * FIRST '#' as the fragment, so Supabase cannot find its token and the router
 * cannot match the route -- both halves lose, silently. So the link only has to
 * load the app shell; PASSWORD_RECOVERY then carries the customer to the reset
 * screen from inside the app, which is where that navigation belongs anyway.
 *
 * `basePath` is a defaulted parameter for the same reason the OAuth provider
 * list is: import.meta.env does not exist under the node test runner, so the
 * GitHub Pages base ('/XBAR') would otherwise be unreachable from a test and
 * the branch that needs it could not be proven.
 */
function deploymentBase(): string {
  // vite.config.ts serves the GitHub Pages build from '/XBAR/', so the shell
  // is not at the host root there and a '/#/...' link would request a page
  // that does not exist.
  const base = routeEnv.BASE_URL ?? '/';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

/**
 * Where a FAILED auth callback has to be sent under the HASH router.
 *
 * The success path is fine: the link loads the shell, auth-js consumes
 * `#access_token=...`, and the flow's own event carries the customer onwards.
 *
 * A rejected callback comes back as `#error=...` instead. auth-js stops before
 * clearing that fragment and emits nothing, so nothing navigates; and on a
 * hash router the fragment IS the route, so `#error=access_denied` is read as
 * a path, matches nothing, and the customer is shown the not-found screen at
 * the moment they most need to be told what went wrong.
 *
 * It goes to SIGN-IN, not to the reset screen. The fragment carries no flow
 * marker -- a cancelled OAuth consent, an expired signup confirmation, a
 * rejected magic link and a dead recovery link are indistinguishable in it --
 * so sending them all to the reset screen answered three of the four with
 * password-reset instructions that had nothing to do with what they were
 * doing. Sign-in is the one destination that is right for all of them, and it
 * is where the reset screen's own guidance sends people anyway. The reason
 * travels in `authError` so the screen can say it rather than leaving the
 * customer to guess.
 *
 * Returns the fragment to put in its place, or '' to leave the URL alone.
 * Anything carrying `access_token` is left ALONE deliberately: rewriting it
 * would take the token away from auth-js before it could read it, turning a
 * working callback into a broken one.
 */
const AUTH_FAILURE_FRAGMENT = /(^|&)error(_code|_description)?=/;

export function hashAuthFailureRoute(hash: string, signInPath: string = loginPath): string {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  // Already a route, empty, or a successful callback: nothing to do.
  if (!fragment || fragment.startsWith('/') || fragment.includes('access_token=')) return '';
  if (!AUTH_FAILURE_FRAGMENT.test(fragment)) return '';
  const params = new URLSearchParams(fragment);
  const reason = params.get('error_description') || params.get('error_code') || params.get('error') || '';
  return reason ? `#${signInPath}?authError=${encodeURIComponent(reason)}` : `#${signInPath}`;
}

export function authRedirectUrl(path: string, origin?: string, basePath: string = deploymentBase()): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const route = path.startsWith('/') ? path : `/${path}`;
  return usesHashRouting() ? `${base}${basePath}/` : `${base}${appBasePath}${route}`;
}

/**
 * A link that will be opened in a BROWSER against the public web deployment,
 * rather than inside whatever build produced it.
 *
 * The native recovery email is the case. It is composed inside the store build
 * -- which runs on the hash router -- but the customer opens it in the phone's
 * browser, where the public site runs the browser router under /app. Reusing
 * appRouteUrl() there would emit this build's shape and send them to a hash
 * the deployed site ignores.
 *
 * The origin is passed in because VITE_PUBLIC_APP_URL is deliberately an
 * ORIGIN with no path (scripts/build-mobile.mjs) -- a '/app' suffix on it once
 * broke the verify links in api/sale-packets.js -- so the path belongs here.
 */
export function publicAppRouteUrl(path: string, origin: string): string {
  const route = path.startsWith('/') ? path : `/${path}`;
  return `${origin.replace(/\/+$/, '')}${appBasePath}${route}`;
}

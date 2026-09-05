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
 * An absolute URL to an in-app route, correct under either routing shape.
 *
 * Used for links that leave the app and come back -- currently the Supabase
 * password-recovery email, which has to return the customer to a screen that
 * can actually set a new password.
 */
export function appRouteUrl(path: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const route = path.startsWith('/') ? path : `/${path}`;
  return usesHashRouting() ? `${base}/#${route}` : `${base}${appBasePath}${route}`;
}

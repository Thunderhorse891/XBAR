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

export const canonicalRoutes = {
  horses: '/horses',
  documents: '/documents',
  sales: '/sales',
  buyers: '/buyers',
  salePackets: '/sale-packets',
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

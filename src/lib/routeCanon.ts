// Canonical product routes and legacy redirects. One route per product area:
// /horses /documents /sales /buyers /sale-packets /billing /settings
// Legacy paths must stay in this map (and keep redirecting) so old links,
// bookmarks, and cached PWA shells never dead-end.

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
  '/sale-packet-studio': canonicalRoutes.salePackets,
  '/plans': canonicalRoutes.billing,
  '/subscribe': canonicalRoutes.billing,
  '/subscriptions': canonicalRoutes.billing,
};

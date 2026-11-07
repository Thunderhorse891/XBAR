/** Page views only need the route path. Never retain query/fragment fields or
 * arbitrary extra page metadata: buyer links and auth callbacks contain secrets.
 * Shared by both client transports and the API (including older web clients).
 */
export function privateSafeRuntimePayload(eventName, payload = {}) {
  if (eventName !== 'navigation.page_view') return payload;
  const pathname = payload?.pathname;
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) return {};
  return { pathname: pathname.split(/[?#]/, 1)[0] };
}

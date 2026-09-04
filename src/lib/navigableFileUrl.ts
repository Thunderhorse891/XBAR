/*
 * Which URLs a stored file is allowed to be opened with.
 *
 * A document's `fileUrl` comes from the workspace record, and a workspace
 * record can come from an imported backup — a file the rancher was handed.
 * `getDocumentAccessUrl` returned that string unchanged, and `openStoredFile`
 * assigned it to `previewWindow.location.href`, where `previewWindow` is an
 * `about:blank` this app opened and therefore SAME-ORIGIN.
 *
 * A `javascript:` URL assigned to a same-origin window's location runs in that
 * origin. From there it reads localStorage and IndexedDB — the workspace, the
 * session, and every document in the vault. Clearing `opener` does not help:
 * the blank document inherited the origin when it was opened, before any URL
 * was assigned.
 *
 * The deployed CSP blocks it, which is why this is a hardening fix rather than
 * a live incident. But a CSP is a deployment property, and this runs in local
 * builds, in the mobile shell, and anywhere the header is not what production
 * serves. A parser is cheaper than depending on a header.
 *
 * ALLOWED, and why each is needed:
 *
 *   https:  cloud documents, served from Supabase storage
 *   http:   the same, on a local Supabase stack
 *   blob:   every on-device file — the vault hands out `URL.createObjectURL`
 *
 * Everything else is refused, `data:` included. Nothing in this app navigates
 * to a `data:` URL — packets embed them as image sources instead — and a
 * `data:text/html` document is exactly the shape being defended against.
 */

/** Schemes a stored file may be opened with. */
const NAVIGABLE_PROTOCOLS = new Set(['https:', 'http:', 'blob:']);

/**
 * Whether `url` is safe to navigate to or download.
 *
 * Parsed rather than pattern-matched. `javascript:` has been written as
 * `JaVaScRiPt:`, with a leading newline, and with an embedded tab for as long
 * as browsers have accepted those, and every one of them defeats a
 * `startsWith('javascript:')` check while still executing. `URL` normalizes
 * all of it and reports the protocol the browser will actually use.
 *
 * A relative URL is resolved against this app's own origin, which is what the
 * browser would do with it anyway, so `/uploads/coggins.pdf` stays valid.
 */
export function isNavigableFileUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.trim()) return false;

  // A base is required for relative URLs, and there is none outside a browser.
  // Refusing there is correct rather than merely convenient: nothing navigates
  // in that environment, so an accepting answer could only mislead a caller.
  const base = typeof window !== 'undefined' ? window.location?.href : undefined;

  try {
    return NAVIGABLE_PROTOCOLS.has(new URL(url, base).protocol);
  } catch {
    // Unparseable is not navigable. This is also the relative-URL-with-no-base
    // case, which `URL` throws on.
    return false;
  }
}

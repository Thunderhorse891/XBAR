// Traveling "Verified by XBAR" badge helpers.
//
// The server-anchored seal proves a sale packet is unaltered; these helpers make
// that proof TRAVEL off-platform. A seller drops a badge + verify link into a
// Facebook post, a marketplace listing, or an email; every buyer who taps it
// lands on XBAR's public verification page. That is the loop that turns each
// sealed sale into a reason for a new buyer to come verify — and come back.
//
// Everything here is pure and honest: the badge asserts only "unaltered since
// sealing / verify against XBAR", never an appraisal or a guarantee of the
// underlying records.

/** Basename-relative verification path for a packet (the SPA lives under /app). */
export function buildVerifyPath(packetId: string): string {
  return `/app/verify/${encodeURIComponent(packetId.trim())}`;
}

/** Absolute verification URL a buyer can open. `origin` is an app origin like
 * "https://xbar.app" (trailing slash tolerated). */
export function buildVerifyUrl(origin: string, packetId: string): string {
  const base = (origin || '').replace(/\/+$/, '');
  return `${base}${buildVerifyPath(packetId)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * A paste-anywhere HTML badge for online listings. A single self-contained
 * anchor with inline styles (no script, no external asset) that renders as a
 * green "✓ Verified by XBAR · SEAL-…" pill linking to the verify page. Inputs
 * are HTML-escaped so a listing can embed it safely.
 */
export function buildBadgeSnippet(verifyUrl: string, sealCode: string): string {
  const href = escapeHtml(verifyUrl.trim());
  const code = escapeHtml(sealCode.trim());
  const label = code ? `Verified by XBAR &middot; ${code}` : 'Verified by XBAR';
  return (
    `<a href="${href}" target="_blank" rel="noopener noreferrer" ` +
    `style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;` +
    `border-radius:999px;background:#0f7a4a;color:#fff;font:600 13px/1.2 system-ui,sans-serif;` +
    `text-decoration:none">` +
    `&#10003; ${label}</a>`
  );
}

/**
 * A share caption for native share / social. Honest: says verified-unaltered,
 * points at verification, never claims an appraisal.
 */
export function buildShareText(horseName: string, sealCode?: string): string {
  const name = horseName.trim() || 'This horse';
  const seal = (sealCode || '').trim();
  const sealPhrase = seal ? ` (seal ${seal})` : '';
  return `${name}: sale packet verified by XBAR${sealPhrase}. Confirm it's unaltered before you buy:`;
}

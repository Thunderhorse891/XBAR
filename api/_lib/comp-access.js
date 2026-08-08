// Operator comp access.
//
// A comma-separated allowlist of email addresses (env XBAR_COMP_EMAILS) that are
// granted full (Enterprise) entitlements regardless of their billing tier. This
// is the sanctioned way to comp an internal / QA / owner account so the operator
// can exercise every feature. It is OFF by default: an empty or unset allowlist
// means no one is comped and behavior is unchanged for every real customer.

/** Parse a comma/space/newline-separated allowlist into lowercased emails. */
export function parseCompEmails(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/** True when `email` is present in `allowlist` (both compared case-insensitively). */
export function emailInAllowlist(email, allowlist) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return allowlist.includes(normalized);
}

/** True when `email` is comped via the XBAR_COMP_EMAILS environment allowlist. */
export function isCompedEmail(email) {
  return emailInAllowlist(email, parseCompEmails(process.env.XBAR_COMP_EMAILS));
}

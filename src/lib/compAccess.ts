// Operator comp access (client).
//
// Mirrors api/_lib/comp-access.js. An allowlisted email (env VITE_XBAR_COMP_EMAILS)
// is granted the full (Enterprise) tier so an internal / QA / owner account can
// exercise every gated feature in the UI. Off by default: an empty allowlist
// leaves every real customer's gating untouched. The server enforces the same
// allowlist for cloud actions, so this is a display/UX convenience layered on a
// server-side grant — not a way for an ordinary user to unlock paid features.

import { compConfig } from './platformConfig.js';

/** Pure allowlist check — both sides compared case-insensitively. */
export function emailInAllowlist(email: string | null | undefined, allowlist: readonly string[]): boolean {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return allowlist.includes(normalized);
}

/** True when `email` is comped via the configured VITE_XBAR_COMP_EMAILS allowlist. */
export function isCompedEmail(email: string | null | undefined): boolean {
  return emailInAllowlist(email, compConfig.emails);
}

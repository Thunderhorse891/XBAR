// A rollout policy to test before wiring any live endpoint. No Stripe, database,
// or environment access. Only server-verified Stripe scope and workspace evidence
// may be passed here; a request body or Stripe metadata is not ownership evidence.
import { stripeAccountIdReady } from '../../api/_lib/managed-billing.js';

function validAccountId(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim() && stripeAccountIdReady(value);
}

function validCustomerId(value) {
  return typeof value === 'string' && /^cus_[A-Za-z0-9]+$/.test(value);
}

function routesToWorkspace(ownership, workspaceId) {
  return typeof workspaceId === 'string' && workspaceId.length > 0 && ownership?.workspaceId === workspaceId;
}

// "off" means this policy makes no new checkout available. It does not tell a
// caller to fall back to legacy Checkout, particularly for a dedicated customer.
export function dedicatedCheckoutScope({ enabled, legacyAccountId, dedicated, verified, workspaceId, ownership } = {}) {
  if (enabled !== 'true') return { route: 'off' };

  if (
    !validAccountId(legacyAccountId) ||
    !validAccountId(dedicated?.accountId) ||
    dedicated.accountId === legacyAccountId ||
    typeof dedicated.livemode !== 'boolean' ||
    verified?.accountId !== dedicated.accountId ||
    verified.livemode !== dedicated.livemode
  ) {
    return { route: 'blocked', reason: 'account_unverified' };
  }

  if (!routesToWorkspace(ownership, workspaceId)) return { route: 'blocked', reason: 'ownership_unverified' };

  // A missing row/ID is not "verified-new". The future caller must prove no
  // legacy billing or outstanding checkout, under the workspace checkout claim.
  if (
    ownership.kind === 'verified-new' &&
    ownership.accountId == null &&
    ownership.customerId == null &&
    ownership.livemode == null
  ) {
    return { route: 'dedicated', accountId: dedicated.accountId, customerId: null };
  }

  if (
    ownership.kind === 'bound' &&
    ownership.accountId === dedicated.accountId &&
    ownership.livemode === dedicated.livemode &&
    validCustomerId(ownership.customerId)
  ) {
    return { route: 'dedicated', accountId: dedicated.accountId, customerId: ownership.customerId };
  }

  return { route: 'blocked', reason: 'ownership_unverified' };
}

// The source must come from an allowlisted endpoint after signature and mode
// verification, and the customer must come from the authenticated Stripe object
// graph. At integration, enforce this match atomically at the write, too.
export function scopedEventMatchesOwnership({ source, workspaceId, ownership, customerId } = {}) {
  return (
    validAccountId(source?.accountId) &&
    typeof source.livemode === 'boolean' &&
    validCustomerId(customerId) &&
    routesToWorkspace(ownership, workspaceId) &&
    ownership.kind === 'bound' &&
    ownership.accountId === source.accountId &&
    ownership.livemode === source.livemode &&
    ownership.customerId === customerId
  );
}

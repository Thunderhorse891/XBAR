import { subscriptionPlans, isKnownTier } from './subscription-plans.js';
import { BASELINE_TIER, entitledTierForBillingState, isKnownBillingState } from './subscription-status.js';
import { isCompedEmail } from './comp-access.js';

const TIER_ORDER = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

/*
 * Shown whenever the database cannot tell us what a workspace has or is using.
 *
 * Deliberately not upgrade copy. "Upgrade to continue" asserts that the
 * customer is over their limit, and at this point nothing establishes that —
 * the query failed, so the usage is unknown. Telling a customer to pay because
 * a database call errored is both wrong and expensive to un-say.
 */
const CLOUD_UNAVAILABLE_MESSAGE =
  'Cloud services are unavailable right now, so this action was not applied. Try again in a moment.';

function usageUnavailable(subject) {
  return {
    ok: false,
    retryable: true,
    status: 503,
    message: `Current ${subject} could not be verified, so this action was not applied. Try again in a moment.`,
  };
}

/**
 * Resolve what a workspace is entitled to.
 *
 * Returns `{ ok: false }` when the lookup itself fails. That case used to be
 * indistinguishable from a workspace on the baseline plan: the error was
 * discarded, `data` came back null, and the caller proceeded as though it had
 * read a real subscription. Callers must check `ok` before reading `limits`.
 *
 * Neither a missing row nor an unrecognized value resolves to 'Manual Billing'
 * any more. That state grants the paid tier, so it is reachable only when an
 * operator has deliberately written it.
 */
export async function getWorkspaceEntitlements(supabase, workspaceId, userEmail) {
  const { data, error } = await supabase
    .from('workspace_subscription_profiles')
    .select('tier, billing_state')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) {
    return { ok: false, retryable: true, status: 503, message: CLOUD_UNAVAILABLE_MESSAGE };
  }

  // No row means the workspace has never had a subscription synced. That is a
  // normal state, not an error, and it resolves to the baseline.
  const tierRecognized = isKnownTier(data?.tier);
  const tier = tierRecognized ? data.tier : BASELINE_TIER;

  // An unrecognized string in this column is treated as inactive rather than
  // trusted or coerced to the friendliest neighbouring value.
  const storedBillingState = data?.billing_state;
  const billingState = isKnownBillingState(storedBillingState) ? storedBillingState : 'Inactive';

  let effectiveTier = entitledTierForBillingState(tier, billingState);

  // Operator comp: an allowlisted email (env XBAR_COMP_EMAILS) resolves to full
  // entitlements so internal/QA/owner accounts can exercise every feature. Off
  // by default — an empty allowlist changes nothing for real customers.
  const comped = isCompedEmail(userEmail);
  if (comped) {
    effectiveTier = 'Enterprise';
  }

  return {
    ok: true,
    tier,
    tierRecognized,
    effectiveTier,
    billingState,
    comped,
    limits: subscriptionPlans[effectiveTier].limits,
  };
}

export function tierIncludesPlan(tier, minimumPlan) {
  const tierIndex = TIER_ORDER.indexOf(tier);
  const requiredIndex = TIER_ORDER.indexOf(minimumPlan);
  if (tierIndex < 0 || requiredIndex < 0) return false;
  return tierIndex >= requiredIndex;
}

/*
 * Capacity gates.
 *
 * Each one used to discard the error from its usage query:
 *
 *     const { count } = await supabase.from('horses')...
 *     const used = Number(count || 0);
 *
 * On any failed read `count` is null, `used` collapses to 0, and the limit
 * stops applying — while the request returns a clean pass. Every paid tier is
 * sold on these limits, so a transient database error silently removed the
 * enforcement behind all of them, with nothing in the response to show that
 * anything had happened.
 *
 * A gate that cannot read current usage must not let the action past. Refusing
 * is recoverable; an unenforced limit is not.
 */

export async function checkDocumentCapacity(supabase, workspaceId, incomingCount, limits) {
  const { count, error } = await supabase
    .from('documents')
    .select('document_id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .neq('state', 'Archived');

  if (error) return usageUnavailable('document usage');

  const used = Number(count || 0);
  if (used + incomingCount > limits.documentLimit) {
    return {
      ok: false,
      message: `This batch would exceed the plan's ${limits.documentLimit} document limit (${used} in use). Upgrade to continue.`,
    };
  }
  return { ok: true, used };
}

export async function checkHorseCapacity(supabase, workspaceId, incomingCount, limits) {
  const { count, error } = await supabase
    .from('horses')
    .select('horse_id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if (error) return usageUnavailable('horse count');

  const used = Number(count || 0);
  if (used + incomingCount > limits.horseLimit) {
    return {
      ok: false,
      message: `This import would exceed the plan's ${limits.horseLimit} horse limit (${used} in use). Upgrade to continue.`,
    };
  }
  return { ok: true, used };
}

export async function checkSeatCapacity(supabase, workspaceId, incomingCount, limits, options = {}) {
  // The app reserves the pending invitation row BEFORE calling /api/invite,
  // so the invite being sent must be excluded from the pending count or it
  // would be double-counted (once as the row, once as incomingCount).
  let invitationQuery = supabase
    .from('workspace_invitations')
    .select('invitation_id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);
  if (options.excludeInvitationId) {
    invitationQuery = invitationQuery.neq('invitation_id', options.excludeInvitationId);
  }
  const [memberships, invitations] = await Promise.all([
    supabase
      .from('workspace_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'active'),
    invitationQuery.eq('status', 'pending'),
  ]);

  // Both halves matter: seats in use are active members plus pending invites,
  // so either query failing leaves the total unknown, not merely incomplete.
  if (memberships.error) return usageUnavailable('team seat usage');
  if (invitations.error) return usageUnavailable('pending invitation count');

  const used = Number(memberships.count || 0) + Number(invitations.count || 0);
  if (used + incomingCount > limits.seatLimit) {
    return {
      ok: false,
      message: `This invite would exceed the plan's ${limits.seatLimit} team seat limit (${used} in use, counting pending invites). Upgrade to continue.`,
    };
  }
  return { ok: true, used };
}

export async function checkSalePacketCapacity(supabase, workspaceId, incomingCount, limits) {
  const { count, error } = await supabase
    .from('sale_packets')
    .select('packet_id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if (error) return usageUnavailable('sale packet count');

  const used = Number(count || 0);
  if (used + incomingCount > limits.salePacketLimit) {
    return {
      ok: false,
      message: `This packet would exceed the plan's ${limits.salePacketLimit} sale packet limit (${used} generated). Upgrade to continue.`,
    };
  }
  return { ok: true, used };
}

// Bytes per binary gigabyte — matches the client's estimateStorageGb
// (src/lib/xbarRuntime.ts) and the DB trigger, so the cap and the displayed
// usage never disagree.
const BYTES_PER_GB = 1024 * 1024 * 1024;

export async function checkStorageCapacity(supabase, workspaceId, incomingBytes, limits) {
  // Authoritative usage comes from the DB (live documents + sale packets),
  // never a carried-forward or client-estimated figure.
  const { data, error } = await supabase.rpc('xbar_workspace_storage_bytes', { p_workspace_id: workspaceId });

  // A permission error here is a realistic failure, not a hypothetical: the
  // service role holds EXECUTE on this function through PostgreSQL's default
  // PUBLIC grant, so revoking that grant without re-granting to service_role
  // breaks this call. BYPASSRLS does not cover function EXECUTE.
  if (error) return usageUnavailable('storage usage');

  const usedBytes = Number(data || 0);
  const incoming = Math.max(0, Number(incomingBytes) || 0);
  const capBytes = Number(limits.storageLimitGb) * BYTES_PER_GB;

  if (usedBytes + incoming > capBytes) {
    const usedGb = (usedBytes / BYTES_PER_GB).toFixed(1);
    return {
      ok: false,
      message: `This upload would exceed the plan's ${limits.storageLimitGb} GB storage limit (${usedGb} GB in use). Upgrade to continue.`,
    };
  }
  return { ok: true, usedBytes };
}

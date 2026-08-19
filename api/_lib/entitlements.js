import { subscriptionPlans } from './subscription-plans.js';
import { isCompedEmail } from './comp-access.js';

const TIER_ORDER = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

export async function getWorkspaceEntitlements(supabase, workspaceId, userEmail) {
  const { data } = await supabase
    .from('workspace_subscription_profiles')
    .select('tier, billing_state')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  const tier = data?.tier && data.tier in subscriptionPlans ? data.tier : 'Starter';
  const billingState = data?.billing_state || 'Manual Billing';
  // Failed payment => the workspace keeps read access but premium generation
  // falls back to the free/Starter feature set until billing recovers.
  let effectiveTier = billingState === 'Past Due' ? 'Starter' : tier;

  // Operator comp: an allowlisted email (env XBAR_COMP_EMAILS) always resolves to
  // full entitlements so internal/QA/owner accounts can exercise every feature.
  // Off by default — an empty allowlist changes nothing for real customers.
  if (isCompedEmail(userEmail)) {
    effectiveTier = 'Enterprise';
  }

  return {
    tier,
    effectiveTier,
    billingState,
    comped: effectiveTier === 'Enterprise' && isCompedEmail(userEmail),
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
 * A capacity gate that cannot read current usage must not let the action past.
 *
 * Every query below used to discard its `error`, so a failed read produced a
 * null count, `used` became 0, and the limit silently stopped applying — the
 * plan's enforcement lost its teeth on any transient database error, and the
 * request looked like a clean pass. That is the same "success with nothing
 * behind it" failure this codebase treats as a defect, sitting on the code
 * that protects paid tiers.
 *
 * Refusing is the honest outcome. The caller turns this into a 403 the
 * customer can retry, which is recoverable; an unenforced limit is not.
 */
function usageUnavailable(subject) {
  return {
    ok: false,
    message: `Current ${subject} could not be verified, so this action was not applied. Try again in a moment.`,
  };
}

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

  if (memberships.error || invitations.error) return usageUnavailable('seat usage');

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

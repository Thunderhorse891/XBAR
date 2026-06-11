import { subscriptionPlans } from './subscription-plans.js';

const TIER_ORDER = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

export async function getWorkspaceEntitlements(supabase, workspaceId) {
  const { data } = await supabase
    .from('workspace_subscription_profiles')
    .select('tier, billing_state')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  const tier = data?.tier && data.tier in subscriptionPlans ? data.tier : 'Starter';
  const billingState = data?.billing_state || 'Manual Billing';
  // Failed payment => the workspace keeps read access but premium generation
  // falls back to the free/Starter feature set until billing recovers.
  const effectiveTier = billingState === 'Past Due' ? 'Starter' : tier;

  return {
    tier,
    effectiveTier,
    billingState,
    limits: subscriptionPlans[effectiveTier].limits,
  };
}

export function tierIncludesPlan(tier, minimumPlan) {
  const tierIndex = TIER_ORDER.indexOf(tier);
  const requiredIndex = TIER_ORDER.indexOf(minimumPlan);
  if (tierIndex < 0 || requiredIndex < 0) return false;
  return tierIndex >= requiredIndex;
}

export async function checkDocumentCapacity(supabase, workspaceId, incomingCount, limits) {
  const { count } = await supabase
    .from('documents')
    .select('document_id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .neq('state', 'Archived');

  const used = Number(count || 0);
  if (used + incomingCount > limits.documentLimit) {
    return {
      ok: false,
      message: `This batch would exceed the plan's ${limits.documentLimit} document limit (${used} in use). Upgrade to continue.`,
    };
  }
  return { ok: true, used };
}

export async function checkSalePacketCapacity(supabase, workspaceId, incomingCount, limits) {
  const { count } = await supabase
    .from('sale_packets')
    .select('packet_id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  const used = Number(count || 0);
  if (used + incomingCount > limits.salePacketLimit) {
    return {
      ok: false,
      message: `This packet would exceed the plan's ${limits.salePacketLimit} sale packet limit (${used} generated). Upgrade to continue.`,
    };
  }
  return { ok: true, used };
}

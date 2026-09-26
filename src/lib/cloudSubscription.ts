import type { SubscriptionProfile } from '../types/xbar.js';
import { isEntitledBillingState, normalizeTier } from './subscriptionDecision.js';
import { applyTrialToProfile } from './trialSubscription.js';
import { subscriptionTierConfig } from './xbarRuntime.js';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nonnegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** The same canonical columns used by API and database gates decide client access. */
export function subscriptionFromCloudRow(
  row: Record<string, unknown> | null | undefined,
): SubscriptionProfile | undefined {
  if (!row) return undefined;

  // Operators can grant a plan without a JSON payload. Conversely, a payload
  // can predate a cancellation or downgrade, so it cannot authorize a tier.
  const purchasedTier = normalizeTier(row.tier);
  const billingState =
    row.billing_state === 'Active' || row.billing_state === 'Manual Billing' || row.billing_state === 'Past Due'
      ? row.billing_state
      : 'Inactive';
  const tier = isEntitledBillingState(billingState) ? purchasedTier : 'Starter';
  const config = subscriptionTierConfig[tier];
  const payload = record(row.payload);
  const usage = record(payload.usage);
  // Preserve billing recovery metadata: an unreadable flag must not open a
  // second checkout while an existing subscription could still collect.
  const recoverable = payload.subscriptionRecoverable;
  // The trial marker rides in the same payload. Read defensively — a
  // hand-edited value is "no trial", never a crash — and resolve the
  // entitlement from it so a reload lands on the right feature set.
  const trialValue = payload.trial;
  const trialStart =
    trialValue && typeof trialValue === 'object' && !Array.isArray(trialValue)
      ? (trialValue as Record<string, unknown>).startedAt
      : undefined;

  const profile: SubscriptionProfile = {
    tier,
    purchasedTier,
    billingState,
    monthlyRate: nonnegative(row.monthly_rate),
    renewalDate: typeof payload.renewalDate === 'string' ? payload.renewalDate : '',
    ...(recoverable == null ? {} : { subscriptionRecoverable: typeof recoverable === 'boolean' ? recoverable : true }),
    ...(typeof trialStart === 'string' && trialStart.length > 0 ? { trialStart } : {}),
    sharedAccessEnabled: config.sharedAccessEnabled,
    featureFlags: [...config.featureFlags],
    usage: {
      horsesUsed: nonnegative(usage.horsesUsed),
      seatsUsed: nonnegative(usage.seatsUsed),
      documentsProcessed: nonnegative(usage.documentsProcessed),
      salePacketsGenerated: nonnegative(usage.salePacketsGenerated),
      storageUsedGb: nonnegative(usage.storageUsedGb),
      sharedAccessSeatsUsed: nonnegative(usage.sharedAccessSeatsUsed),
      ...config.limits,
    },
  };

  // An active trial grants Professional on top of whatever the billing state
  // says; an expired or absent one leaves the profile exactly as computed.
  return applyTrialToProfile(profile);
}

import { collectStripePages } from './checkout-session.js';
import { TERMINAL_STRIPE_STATUSES } from './subscription-status.js';

// These are refusals, not cancellation instructions. Deleting XBAR records does
// not cancel Stripe objects, and a local Inactive profile is not proof that
// collection stopped. Keep the account and its billing recovery path intact.
export const BILLING_UNVERIFIED = {
  ok: false,
  status: 503,
  code: 'billing_unverified',
  message:
    'Your billing could not be verified. Nothing was deleted. Try again or contact support before deleting your account.',
};
const BILLING_PENDING = {
  ok: false,
  status: 409,
  code: 'billing_pending',
  message:
    'Your workspace still has a subscription, unfinished checkout, or unsettled billing with Stripe. Manage billing first or contact support. Nothing was deleted, and this request did not cancel any payments.',
};

async function readCompleteList(fetchPage) {
  const result = await collectStripePages(async (params) => {
    const page = await fetchPage(params);
    // collectStripePages supports older callers with optional list fields. An
    // irreversible delete needs a positively verified, complete Stripe list.
    if (!Array.isArray(page?.data) || typeof page.has_more !== 'boolean' || page.data.some((item) => !item?.id)) {
      throw new Error('Invalid Stripe list response.');
    }
    return page;
  });
  if (!result.complete) throw new Error('Incomplete Stripe billing review.');
  return result.items;
}

// Called only while the deletion handler holds the SAME lease as checkout.
// Read the row after claiming: a pre-claim read can miss the customer that the
// preceding checkout just created. Claiming seeds an empty row on a new ranch,
// so a missing row here is an error, not evidence of never having purchased.
export async function verifyAccountDeletionBilling(supabase, workspaceId, stripe) {
  try {
    const { data: row, error } = await supabase
      .from('workspace_billing_customers')
      .select('workspace_id, stripe_customer_id, stripe_subscription_id, entitlement_payload')
      .eq('workspace_id', workspaceId)
      .single();
    if (error || !row || row.workspace_id !== workspaceId) return BILLING_UNVERIFIED;
    const customerId = row.stripe_customer_id;
    const subscriptionId = row.stripe_subscription_id;
    if (typeof customerId !== 'string' || typeof subscriptionId !== 'string') return BILLING_UNVERIFIED;
    if (!customerId && !subscriptionId) {
      const { data: profile, error: profileError } = await supabase
        .from('workspace_subscription_profiles')
        .select('billing_state, payload')
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (profileError) return BILLING_UNVERIFIED;
      // Claiming can seed a missing mapping. Contradictory paid/recoverable
      // evidence must not turn a lost Stripe id into permission to delete.
      const hasBillingEvidence = (payload) =>
        payload?.billingState === 'Active' ||
        payload?.billingState === 'Past Due' ||
        payload?.subscriptionRecoverable === true;
      if (
        profile?.billing_state === 'Active' ||
        profile?.billing_state === 'Past Due' ||
        hasBillingEvidence(profile?.payload) ||
        hasBillingEvidence(row.entitlement_payload)
      )
        return BILLING_UNVERIFIED;
      return { ok: true };
    }
    if (!stripe || !customerId) return BILLING_UNVERIFIED;

    const readSubscriptions = () =>
      readCompleteList((params) => stripe.subscriptions.list({ customer: customerId, status: 'all', ...params }));
    const hasUnfinishedSubscription = (items) => items.some((item) => !TERMINAL_STRIPE_STATUSES.includes(item.status));
    const subscriptions = await readSubscriptions();
    if (hasUnfinishedSubscription(subscriptions)) return BILLING_PENDING;
    // A stored id absent from a complete customer list indicates a broken
    // mapping. Do not erase the only record available to investigate it.
    if (subscriptionId && !subscriptions.some((item) => item.id === subscriptionId)) return BILLING_UNVERIFIED;

    const sessions = await readCompleteList((params) =>
      stripe.checkout.sessions.list({ customer: customerId, status: 'open', ...params }),
    );
    if (sessions.length) return BILLING_PENDING;

    // Cancellation is not settlement: a remaining invoice or future schedule
    // can still collect money after the subscription itself is terminal.
    for (const status of ['open', 'draft']) {
      const invoices = await readCompleteList((params) =>
        stripe.invoices.list({ customer: customerId, status, ...params }),
      );
      if (invoices.length) return BILLING_PENDING;
    }
    const schedules = await readCompleteList((params) =>
      stripe.subscriptionSchedules.list({ customer: customerId, ...params }),
    );
    if (schedules.some((item) => !['canceled', 'completed', 'released'].includes(item.status))) return BILLING_PENDING;

    // A hosted checkout can finish between the first subscription query and
    // the open-session query, without taking our lease. Re-read after those
    // sessions are confirmed absent so that completion cannot disappear
    // between the two different lists.
    if (hasUnfinishedSubscription(await readSubscriptions())) return BILLING_PENDING;
    return { ok: true };
  } catch {
    return BILLING_UNVERIFIED;
  }
}

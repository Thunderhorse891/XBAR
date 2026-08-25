import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { canUsePaymentLinkFallback, startManagedCheckout } from '@/lib/billingApi';
import { formatCurrency } from '@/lib/format';
import { getStripePaymentLink, stripeConfig } from '@/lib/platformConfig';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { revenuePlanMatrix } from '@/lib/revenuePlanMatrix';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import {
  getCheckoutReadiness,
  isCurrentPaidPlan,
  isEntitledBillingState,
  hasActivePaidPlan,
  isSubscriptionRecoverable,
  recommendedTier,
} from '@/lib/subscriptionDecision';
import { subscriptionPlans } from '@/lib/subscriptionPlans';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useWorkspaceReady, useXbarStore } from '@/store/useXbarStore';
import type { SubscriptionTier } from '@/types/xbar';
import './checkoutExperience.css';

const tiers: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

function planAnchor(tier: SubscriptionTier) {
  return tier.replace(/\s/g, '-').toLowerCase();
}

function formatLimit(value: number, noun: string) {
  return `${value.toLocaleString()} ${noun}`;
}

export default function Subscriptions() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedValue = params.get('plan');
  const requestedTier = tiers.find((tier) => tier === requestedValue);
  const subscription = useXbarStore((state) => state.subscription);
  const workspaceReady = useWorkspaceReady();
  const canManageBilling = useCurrentRoleCapability('manageBilling');
  const session = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const pushToast = useUiStore((state) => state.pushToast);
  const [checkoutTier, setCheckoutTier] = useState<SubscriptionTier | null>(null);
  // After a lapse, `tier` is the baseline the workspace fell back to, so
  // recommending from it offers Professional to someone who just lost
  // Enterprise. purchasedTier is what they had.
  //
  // It is selected directly rather than passed through recommendedTier, which
  // advances to the next plan up: feeding a lapsed Professional through it
  // returns Ranch Ops, and Ranch Ops returns Enterprise. Restoring what lapsed
  // is not an upgrade recommendation, so the recommender is the wrong function
  // for it — it only looked right for Enterprise, where the clamp hides the
  // advance.
  //
  // Only when the workspace is not currently entitled. An active or comped
  // workspace has purchasedTier === tier, and there the upgrade recommendation
  // is exactly what the screen should lead with.
  const lapsedTier = isEntitledBillingState(subscription.billingState) ? undefined : subscription.purchasedTier;
  const decisionTier = requestedTier ?? lapsedTier ?? recommendedTier(subscription.tier);
  const decisionConfig = subscriptionPlans[decisionTier];
  const decisionProfile = revenuePlanMatrix[decisionTier];
  const hasManagedIdentity = Boolean(session?.access_token && workspaceId);
  const billingEnabled = stripeConfig.managedBillingEnabled;
  const selectedPaymentLink = Boolean(getStripePaymentLink(decisionTier));
  const selectedCheckoutConfigured = billingEnabled || selectedPaymentLink;
  const starterSetup = subscription.tier === 'Starter' && subscription.monthlyRate === 0;
  // A workspace whose Stripe subscription can still bill it. Buying here would
  // open a second one beside it, so every checkout path is blocked.
  //
  // Read from the profile rather than derived from billingState, which cannot
  // answer this: 'Inactive' covers a canceled subscription, which is gone, and
  // a paused or unpaid one, which Stripe resumes once payment is sorted out.
  // Testing that state for the past-due value missed both of the latter and
  // left their plan buttons enabled.
  //
  // Older profiles predate the field, and reading absent as "no live
  // subscription" was wrong: the previous mapper stored past_due, unpaid and
  // incomplete_expired all as 'Past Due' and never produced 'Inactive', so
  // every legacy lapsed workspace sits in 'Past Due' with no flag — and two of
  // those three statuses can still be collected on. isSubscriptionRecoverable
  // falls back to the billing state for exactly that population.
  const subscriptionRecoverable = isSubscriptionRecoverable(subscription);
  // A paying workspace changing tiers is the other way to end up with two
  // subscriptions, and it is not recoverable, so the check above misses it
  // entirely. api/stripe/checkout.js refuses these server-side; this stops the
  // screen offering a button that would be refused.
  const subscriptionActive = hasActivePaidPlan(subscription);
  const continuePath = workspaceReady ? '/' : '/setup';
  const checkoutReadinessLabel = selectedCheckoutConfigured
    ? 'Secure checkout opens next.'
    : 'Billing is not configured yet, so plans cannot be purchased in the app.';
  const selectedReadiness = getCheckoutReadiness({
    billingEnabled,
    canManageBilling,
    hasManagedIdentity,
    hasPaymentLink: selectedPaymentLink,
    checkoutInProgress: checkoutTier !== null,
    subscriptionRecoverable,
    // The third call site. Without it the prominent CTA promised secure
    // checkout while every plan card below it was disabled and clicking the CTA
    // was refused — all three have to answer the same question.
    subscriptionActive,
  });
  // Entitlement, not price. The stored rate is the price of the plan that was
  // bought and survives a cancellation, so using it as the "this is your
  // current plan" signal marked a lapsed tier as current and disabled the
  // checkout the customer needed to resubscribe.
  const selectedPaidCurrent = isCurrentPaidPlan(subscription, decisionTier);

  const emit = (
    eventName: Parameters<typeof productEvent>[0],
    payload: Record<string, unknown>,
    severity: 'info' | 'warning' = 'info',
  ) => {
    void trackRuntimeEvent({ workspaceId, severity, ...productEvent(eventName, payload) });
  };

  const beginCheckout = async (tier: SubscriptionTier) => {
    setCheckoutTier(tier);
    emit(productEventNames.checkoutStarted, {
      tier,
      currentTier: subscription.tier,
      source: requestedTier ? 'selected_plan' : 'billing',
    });

    const readiness = getCheckoutReadiness({
      billingEnabled,
      canManageBilling,
      hasManagedIdentity,
      hasPaymentLink: Boolean(getStripePaymentLink(tier)),
      checkoutInProgress: false,
      subscriptionRecoverable,
      subscriptionActive,
    });
    if (!readiness.ready) {
      emit(productEventNames.checkoutFailed, { tier, reason: readiness.reason }, 'warning');
      pushToast({
        title:
          readiness.mode === 'manual'
            ? 'Billing not configured yet'
            : readiness.mode === 'recover'
              ? 'Payment needs to be settled first'
              : 'Checkout needs attention',
        message: `${readiness.reason} Your workspace and current plan were not changed.`,
        tone: 'warning',
      });
      setCheckoutTier(null);
      return;
    }

    const managed = await startManagedCheckout({ tier, workspaceId, accessToken: session?.access_token ?? '' });
    if (managed.ok) {
      emit(productEventNames.checkoutRedirected, { tier, method: 'managed' });
      window.location.assign(managed.url);
      return;
    }

    /*
     * The payment link is reached only when there was no identity to check.
     *
     * It is an unguarded `mode: 'subscription'` checkout that consults no
     * billing row, so following it after the endpoint refused undid the refusal
     * completely — the customer saw an ordinary Stripe page and paid twice.
     * Blocking a list of refusal codes was not enough: `fetch` rejecting or a
     * malformed body produces an UNCODED failure, and in exactly those cases the
     * endpoint's guard never ran, so a workspace with a live subscription still
     * got the link. A network error says nothing about whether a customer
     * already pays us.
     *
     * So the rule is an allowlist. Only `no_managed_identity` — no workspace id,
     * no access token, therefore no billing row that could hold a subscription —
     * falls back, which is how a local-only workspace legitimately buys a plan.
     */
    const fallback = canUsePaymentLinkFallback(managed.code) ? getStripePaymentLink(tier) : '';
    if (fallback) {
      emit(
        productEventNames.checkoutRedirected,
        { tier, method: 'payment_link', managedFailure: managed.message },
        'warning',
      );
      window.location.assign(fallback);
      return;
    }

    emit(productEventNames.checkoutFailed, { tier, reason: managed.message }, 'warning');
    pushToast({
      title: 'Checkout needs attention',
      message: `${managed.message} Your workspace and current plan were not changed.`,
      tone: 'error',
    });
    setCheckoutTier(null);
  };

  const startTrial = () => {
    navigate(continuePath);
  };

  const renderPaidPlan = (tier: SubscriptionTier) => {
    const config = subscriptionPlans[tier];
    const profile = revenuePlanMatrix[tier];
    const highlighted = tier === decisionTier;
    const paidCurrent = isCurrentPaidPlan(subscription, tier);
    const setupCurrent = tier === 'Starter' && starterSetup;
    const busy = checkoutTier === tier;
    const readiness = getCheckoutReadiness({
      billingEnabled,
      canManageBilling,
      hasManagedIdentity,
      hasPaymentLink: Boolean(getStripePaymentLink(tier)),
      checkoutInProgress: checkoutTier !== null,
      subscriptionRecoverable,
      subscriptionActive,
    });

    return (
      <article
        id={planAnchor(tier)}
        className={`checkout-plan${highlighted ? ' checkout-plan--selected' : ''}${paidCurrent || setupCurrent ? ' checkout-plan--active' : ''}`}
        key={tier}
      >
        <div>
          <span>{highlighted ? 'Selected tier' : 'Operational tier'}</span>
          <h3>{tier}</h3>
          <p>{profile.fit}</p>
        </div>
        <div className="checkout-plan__price">
          <strong>{formatCurrency(config.monthlyRate)}</strong>
          <small>/ month</small>
        </div>
        <ul>
          <li>{formatLimit(config.limits.horseLimit, 'horses')}</li>
          <li>{formatLimit(config.limits.seatLimit, 'team seats')}</li>
          <li>{formatLimit(config.limits.documentLimit, 'documents')}</li>
          <li>{formatLimit(config.limits.salePacketLimit, 'sale packets')}</li>
          <li>{`${config.limits.storageLimitGb} GB storage`}</li>
        </ul>
        {/* What the tier includes, not just how much of it. Rendered whatever
            the billing configuration is: being unable to buy a plan is no
            reason to stop showing what it contains. */}
        <ul className="checkout-plan__features">
          {config.featureFlags.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        {paidCurrent || setupCurrent ? (
          <button type="button" disabled>
            {paidCurrent ? 'Current plan' : 'Current setup'}
          </button>
        ) : (
          <button
            type="button"
            disabled={!readiness.ready}
            title={readiness.reason}
            onClick={() => void beginCheckout(tier)}
          >
            {busy
              ? 'Opening checkout...'
              : readiness.mode === 'manual'
                ? 'Billing not configured yet'
                : readiness.mode === 'recover'
                  ? 'Payment needs attention'
                  : `Choose ${tier}`}
          </button>
        )}
        <small>
          {paidCurrent
            ? 'Your active paid capacity.'
            : setupCurrent
              ? 'No paid Starter subscription is active yet.'
              : readiness.reason}
        </small>
      </article>
    );
  };

  return (
    <section className="checkout-route checkout-route--embedded">
      <div className="checkout-grid">
        <section className="checkout-panel checkout-panel--plans" aria-labelledby="checkout-title">
          <div className="checkout-heading">
            <p>Billing</p>
            <h1 id="checkout-title">Review Billing</h1>
            <span>
              Choose the tier that fits your workflow. Plans change only after checkout succeeds — nothing here changes
              your workspace on its own.
            </span>
          </div>

          <div className="checkout-trial">
            <div>
              <span>Starter setup</span>
              <h2>Start with XBAR</h2>
              <p>No payment is collected in this local setup flow. Paid plans require completed checkout.</p>
            </div>
            <button type="button" onClick={startTrial}>
              {workspaceReady ? 'Continue' : 'Continue setup'}
            </button>
            <small>
              {starterSetup
                ? 'Setup active'
                : `${formatLimit(subscriptionPlans.Starter.limits.horseLimit, 'horses')} and ${formatLimit(subscriptionPlans.Starter.limits.documentLimit, 'documents')}`}
            </small>
          </div>

          <div className="checkout-plan-list" aria-label="Paid plans">
            {tiers.map(renderPaidPlan)}
          </div>
        </section>

        <aside className="checkout-panel checkout-panel--payment" aria-label="Payment method">
          <div className="checkout-heading checkout-heading--compact">
            <p>Billing summary</p>
            <h2>{decisionTier}</h2>
            <span>{decisionProfile.fit}</span>
          </div>

          <div className="checkout-total">
            <span>{selectedCheckoutConfigured ? 'Due at checkout' : 'Monthly price'}</span>
            <strong>{formatCurrency(decisionConfig.monthlyRate)}</strong>
            <small>{selectedCheckoutConfigured ? 'then monthly' : 'not charged in app'}</small>
          </div>

          {selectedReadiness.mode === 'manual' ? (
            <div className="checkout-card-box" aria-label="Billing details">
              <div className="checkout-card-box__top">
                <span>Billing</span>
                <strong>Billing not configured yet</strong>
              </div>
              <p>
                Payment is not set up for this deployment, so no plan can be purchased here and no payment details are
                collected. Every tier below is still shown in full so you can compare what they include. Your workspace
                and current plan are unchanged.
              </p>
            </div>
          ) : (
            <div className="checkout-card-box" aria-label="Secure payment details">
              <div className="checkout-card-box__top">
                <span>Card details</span>
                <strong>Secure checkout</strong>
              </div>
              <label>
                <span>Card number</span>
                <div>Entered on the next secure step</div>
              </label>
              <div className="checkout-card-box__row">
                <label>
                  <span>Expiration</span>
                  <div>Next step</div>
                </label>
                <label>
                  <span>CVC</span>
                  <div>Next step</div>
                </label>
              </div>
              <p>Your card details are handled by the payment processor. XBAR never stores raw card numbers.</p>
            </div>
          )}

          <div className="checkout-status-list" aria-label="Billing details">
            {selectedCheckoutConfigured ? (
              <>
                <div>
                  <span>Billing</span>
                  <strong>Monthly</strong>
                </div>
                <div>
                  <span>Payment</span>
                  <strong>Handled at checkout</strong>
                </div>
                <div>
                  <span>Receipt</span>
                  <strong>After checkout</strong>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>Checkout</span>
                  <strong>Not configured</strong>
                </div>
                <div>
                  <span>Activation</span>
                  <strong>Not available in app</strong>
                </div>
                <div>
                  <span>Workspace</span>
                  <strong>No plan change</strong>
                </div>
              </>
            )}
          </div>

          <button
            className="checkout-primary-action"
            type="button"
            disabled={!selectedReadiness.ready || selectedPaidCurrent}
            title={selectedPaidCurrent ? 'This plan is already active.' : selectedReadiness.reason}
            onClick={() => void beginCheckout(decisionTier)}
          >
            {checkoutTier === decisionTier
              ? 'Opening checkout...'
              : selectedPaidCurrent
                ? 'Current plan'
                : selectedReadiness.mode === 'manual'
                  ? 'Billing not configured yet'
                  : 'Continue to secure checkout'}
          </button>
          <button className="checkout-secondary-action" type="button" onClick={startTrial}>
            Continue with Starter setup
          </button>
          <p className="checkout-note">
            {selectedPaidCurrent
              ? 'This paid plan is already active.'
              : selectedReadiness.reason || checkoutReadinessLabel}
          </p>
        </aside>
      </div>
    </section>
  );
}

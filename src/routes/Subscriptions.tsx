import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { startManagedCheckout } from '@/lib/billingApi';
import { formatCurrency } from '@/lib/format';
import { getStripePaymentLink, stripeConfig } from '@/lib/platformConfig';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { revenuePlanMatrix } from '@/lib/revenuePlanMatrix';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { getCheckoutReadiness, recommendedTier } from '@/lib/subscriptionDecision';
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
  const decisionTier = requestedTier ?? recommendedTier(subscription.tier);
  const decisionConfig = subscriptionPlans[decisionTier];
  const decisionProfile = revenuePlanMatrix[decisionTier];
  const hasManagedIdentity = Boolean(session?.access_token && workspaceId);
  const billingEnabled = stripeConfig.managedBillingEnabled;
  const selectedPaymentLink = Boolean(getStripePaymentLink(decisionTier));
  const selectedCheckoutConfigured = billingEnabled || selectedPaymentLink;
  const starterSetup = subscription.tier === 'Starter' && subscription.monthlyRate === 0;
  const continuePath = workspaceReady ? '/' : '/setup';
  const checkoutReadinessLabel = selectedCheckoutConfigured
    ? 'Secure checkout opens next.'
    : 'Online checkout is not configured. Contact support/manual billing required.';
  const selectedReadiness = getCheckoutReadiness({
    billingEnabled,
    canManageBilling,
    hasManagedIdentity,
    hasPaymentLink: selectedPaymentLink,
    checkoutInProgress: checkoutTier !== null,
  });
  const selectedPaidCurrent =
    decisionTier === subscription.tier &&
    subscription.monthlyRate === decisionConfig.monthlyRate &&
    subscription.monthlyRate > 0;

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
    });
    if (!readiness.ready) {
      emit(productEventNames.checkoutFailed, { tier, reason: readiness.reason }, 'warning');
      pushToast({
        title: readiness.mode === 'manual' ? 'Manual billing required' : 'Checkout needs attention',
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

    const fallback = getStripePaymentLink(tier);
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
    const paidCurrent =
      tier === subscription.tier && subscription.monthlyRate === config.monthlyRate && subscription.monthlyRate > 0;
    const setupCurrent = tier === 'Starter' && starterSetup;
    const busy = checkoutTier === tier;
    const readiness = getCheckoutReadiness({
      billingEnabled,
      canManageBilling,
      hasManagedIdentity,
      hasPaymentLink: Boolean(getStripePaymentLink(tier)),
      checkoutInProgress: checkoutTier !== null,
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
            {busy ? 'Opening checkout...' : readiness.mode === 'manual' ? 'Manual billing required' : `Choose ${tier}`}
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
              Choose the tier that fits your workflow. Paid plans change only after checkout succeeds or manual billing
              is explicitly activated.
            </span>
          </div>

          <div className="checkout-trial">
            <div>
              <span>Starter setup</span>
              <h2>Start with XBAR</h2>
              <p>
                No payment is collected in this local setup flow. Paid plans require checkout or manual billing
                activation.
              </p>
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
                <strong>Manual billing required</strong>
              </div>
              <p>
                Online checkout is not configured. Contact support/manual billing required. Your workspace and plan will
                not change in the app until manual billing is recorded by an admin.
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
                  <strong>Manual billing only</strong>
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
                  ? 'Manual billing required'
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

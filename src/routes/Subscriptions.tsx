import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
import { XBAR_MAIN_LOGO_SRC } from '@/components/BrandMark';
import './checkoutExperience.css';

const tiers: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

function planAnchor(tier: SubscriptionTier) {
  return tier.replace(/\s/g, '-').toLowerCase();
}

function formatLimit(value: number, noun: string) {
  return `${value.toLocaleString()} ${noun}`;
}

export default function Subscriptions() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedValue = params.get('plan');
  const requestedTier = tiers.find((tier) => tier === requestedValue);
  const standalone = location.pathname === '/subscribe';
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
  const anyPaymentLink = Object.values(stripeConfig.paymentLinks).some(Boolean);
  const billingEnabled = stripeConfig.managedBillingEnabled;
  const trialActive = subscription.tier === 'Starter' && subscription.monthlyRate === 0;
  const continuePath = workspaceReady ? '/' : '/setup';
  const billingReadinessLabel = billingEnabled
    ? hasManagedIdentity || anyPaymentLink
      ? 'Secure checkout ready'
      : 'Sign in required for checkout'
    : 'Billing not configured yet';
  const selectedReadiness = getCheckoutReadiness({
    billingEnabled,
    canManageBilling,
    hasManagedIdentity,
    hasPaymentLink: Boolean(getStripePaymentLink(decisionTier)),
    checkoutInProgress: checkoutTier !== null,
  });
  const selectedPaidCurrent = decisionTier === subscription.tier && subscription.monthlyRate === decisionConfig.monthlyRate && subscription.monthlyRate > 0;

  const emit = (eventName: Parameters<typeof productEvent>[0], payload: Record<string, unknown>, severity: 'info' | 'warning' = 'info') => {
    void trackRuntimeEvent({ workspaceId, severity, ...productEvent(eventName, payload) });
  };

  const beginCheckout = async (tier: SubscriptionTier) => {
    setCheckoutTier(tier);
    emit(productEventNames.checkoutStarted, { tier, currentTier: subscription.tier, source: requestedTier ? 'selected_plan' : standalone ? 'onboarding' : 'plans' });

    const managed = await startManagedCheckout({ tier, workspaceId, accessToken: session?.access_token ?? '' });
    if (managed.ok) {
      emit(productEventNames.checkoutRedirected, { tier, method: 'managed' });
      window.location.assign(managed.url);
      return;
    }

    const fallback = getStripePaymentLink(tier);
    if (fallback) {
      emit(productEventNames.checkoutRedirected, { tier, method: 'payment_link', managedFailure: managed.message }, 'warning');
      window.location.assign(fallback);
      return;
    }

    emit(productEventNames.checkoutFailed, { tier, reason: managed.message }, 'warning');
    pushToast({ title: 'Checkout needs attention', message: `${managed.message} Your workspace and current plan were not changed.`, tone: 'error' });
    setCheckoutTier(null);
  };

  const startTrial = () => {
    navigate(continuePath);
  };

  const renderPaidPlan = (tier: SubscriptionTier) => {
    const config = subscriptionPlans[tier];
    const profile = revenuePlanMatrix[tier];
    const highlighted = tier === decisionTier;
    const paidCurrent = tier === subscription.tier && subscription.monthlyRate === config.monthlyRate && subscription.monthlyRate > 0;
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
        className={`checkout-plan${highlighted ? ' checkout-plan--selected' : ''}${paidCurrent ? ' checkout-plan--active' : ''}`}
        key={tier}
      >
        <div>
          <span>{highlighted ? 'Selected' : 'Paid plan'}</span>
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
        {paidCurrent ? (
          <button type="button" disabled>Current plan</button>
        ) : (
          <button type="button" disabled={!readiness.ready} onClick={() => void beginCheckout(tier)}>
            {busy ? 'Opening checkout...' : `Choose ${tier}`}
          </button>
        )}
        <small>{paidCurrent ? 'Your active paid capacity.' : readiness.reason}</small>
      </article>
    );
  };

  const content = (
    <div className="checkout-grid">
      <section className="checkout-panel checkout-panel--plans" aria-labelledby="checkout-title">
        <div className="checkout-heading">
          <p>Subscription</p>
          <h1 id="checkout-title">Choose your plan.</h1>
          <span>
            Start with the free trial, or continue to secure Stripe checkout for the plan that fits your horses,
            team, documents, and buyer workflow.
          </span>
        </div>

        <div className="checkout-trial">
          <div>
            <span>Free trial</span>
            <h2>Evaluate XBAR</h2>
            <p>No card required. Use Starter capacity while you confirm the workflow.</p>
          </div>
          <button type="button" onClick={startTrial}>{workspaceReady ? 'Open workspace' : 'Start trial'}</button>
          <small>{trialActive ? 'Trial workspace active' : `${formatLimit(subscriptionPlans.Starter.limits.horseLimit, 'horses')} and ${formatLimit(subscriptionPlans.Starter.limits.documentLimit, 'documents')}`}</small>
        </div>

        <div className="checkout-plan-list" aria-label="Paid plans">
          {tiers.map(renderPaidPlan)}
        </div>
      </section>

      <aside className="checkout-panel checkout-panel--payment" aria-label="Payment method">
        <div className="checkout-heading checkout-heading--compact">
          <p>Payment</p>
          <h2>{decisionTier}</h2>
          <span>{decisionProfile.fit}</span>
        </div>

        <div className="checkout-total">
          <span>Due today</span>
          <strong>{formatCurrency(decisionConfig.monthlyRate)}</strong>
          <small>then monthly</small>
        </div>

        <div className="checkout-card-box" aria-label="Secure payment details">
          <div className="checkout-card-box__top">
            <span>Card details</span>
            <strong>Stripe Checkout</strong>
          </div>
          <label>
            <span>Card number</span>
            <div>Entered securely in Stripe</div>
          </label>
          <div className="checkout-card-box__row">
            <label>
              <span>Expiration</span>
              <div>Stripe</div>
            </label>
            <label>
              <span>CVC</span>
              <div>Stripe</div>
            </label>
          </div>
          <p>XBAR does not collect or store raw card numbers. Paid plans redirect to the configured Stripe checkout path.</p>
        </div>

        <div className="checkout-status-list" aria-label="Checkout readiness">
          <div>
            <span>Managed checkout</span>
            <strong>{billingEnabled ? 'Enabled' : 'Paused'}</strong>
          </div>
          <div>
            <span>Stripe links</span>
            <strong>{anyPaymentLink ? 'Ready' : 'Not configured'}</strong>
          </div>
          <div>
            <span>Workspace identity</span>
            <strong>{hasManagedIdentity ? 'Verified' : 'Needed'}</strong>
          </div>
        </div>

        <button
          className="checkout-primary-action"
          type="button"
          disabled={!selectedReadiness.ready || selectedPaidCurrent}
          onClick={() => void beginCheckout(decisionTier)}
        >
          {checkoutTier === decisionTier ? 'Opening secure checkout...' : selectedPaidCurrent ? 'Current plan' : `Continue to ${decisionTier} checkout`}
        </button>
        <button className="checkout-secondary-action" type="button" onClick={startTrial}>
          Start free trial instead
        </button>
        <p className="checkout-note">{selectedPaidCurrent ? 'This paid plan is already active.' : selectedReadiness.reason || billingReadinessLabel}</p>
      </aside>
    </div>
  );

  if (!standalone) {
    return <section className="checkout-route checkout-route--embedded">{content}</section>;
  }

  return (
    <main className="checkout-route">
      <header className="checkout-nav">
        <Link className="checkout-brand" to="/landing" aria-label="XBAR overview">
          <img src={XBAR_MAIN_LOGO_SRC} alt="" />
          <span>XBAR</span>
        </Link>
        <nav aria-label="Checkout sections">
          <a href="#starter">Starter</a>
          <a href="#professional">Professional</a>
          <a href="#ranch-ops">Ranch Ops</a>
          <a href="#enterprise">Enterprise</a>
        </nav>
        <Link className="checkout-nav__action" to={continuePath}>
          {workspaceReady ? 'Access workspace' : 'Setup workspace'}
        </Link>
      </header>

      <div className="checkout-container">{content}</div>
    </main>
  );
}

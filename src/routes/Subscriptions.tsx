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
import './subscriptionExperience.css';

const tiers: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

const profileCards = [
  {
    name: 'Silver Mesa',
    breed: 'AQHA mare',
    owner: 'North Barn',
    status: 'Sale ready',
    documents: '18 docs',
    care: 'Coggins clear',
    value: '$48k ask',
  },
  {
    name: 'Blue Hancock',
    breed: 'Rope horse',
    owner: 'Training string',
    status: 'Care watch',
    documents: '12 docs',
    care: 'Farrier due',
    value: '$32k insured',
  },
  {
    name: 'Mesa Drift',
    breed: 'Broodmare',
    owner: 'Breeding program',
    status: 'Foal window',
    documents: '24 docs',
    care: 'Vet packet',
    value: 'May 14 due',
  },
  {
    name: 'Copper Line',
    breed: 'Prospect',
    owner: 'Sale pen',
    status: 'Buyer room',
    documents: '9 docs',
    care: 'Video synced',
    value: '3 inquiries',
  },
  {
    name: 'Ridge Runner',
    breed: 'Gelding',
    owner: 'Client horse',
    status: 'Owner update',
    documents: '15 docs',
    care: 'Vaccines set',
    value: 'Lease option',
  },
];

const footerGroups = [
  {
    title: 'Platform',
    links: [
      { label: 'Infrastructure', to: '/landing' },
      { label: 'Plan & billing', to: '/subscribe' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', to: '/privacy' },
      { label: 'Terms', to: '/terms' },
    ],
  },
  {
    title: 'Billing',
    links: [
      { label: 'Managed checkout', to: '/subscribe' },
      { label: 'Stripe payment links', to: '/subscribe' },
    ],
  },
];

function planAnchor(tier: SubscriptionTier) {
  return tier.replace(/\s/g, '-').toLowerCase();
}

function formatLimit(value: number, noun: string) {
  return `${value.toLocaleString()} ${noun}`;
}

function HorseContour() {
  return (
    <svg className="subscription-horse-contour" viewBox="0 0 620 360" aria-hidden="true">
      <path d="M80 218c58-82 126-132 205-150 42-9 83-5 124 12 24 10 46 24 66 42l58 52" />
      <path d="M184 162c34-36 78-53 132-51 27 1 54 9 82 23" />
      <path d="M300 92c19 34 22 69 8 106-11 30-31 53-61 70" />
      <path d="M412 138c35 21 60 49 75 84" />
      <path d="M122 223c42 12 85 13 131 3 40-9 79-26 119-51" />
      <path d="M204 257c-12 34-31 58-58 73" />
      <path d="M356 222c18 37 18 72 1 105" />
      <circle cx="454" cy="127" r="4" />
    </svg>
  );
}

function HorseProfileCarousel() {
  const carouselCards = [...profileCards, ...profileCards];

  return (
    <div className="subscription-profile-stage" aria-label="Animated horse profile preview">
      <HorseContour />
      <div className="subscription-profile-stage__header">
        <span>XBAR live record rail</span>
        <strong>Profiles move from intake to sale readiness.</strong>
      </div>
      <div className="subscription-profile-viewport">
        <div className="subscription-profile-track">
          {carouselCards.map((card, index) => (
            <article className="subscription-profile-card" key={`${card.name}-${index}`}>
              <div className="subscription-profile-card__top">
                <div>
                  <strong>{card.name}</strong>
                  <span>{card.breed}</span>
                </div>
                <span>{card.status}</span>
              </div>
              <dl>
                <div>
                  <dt>Owner</dt>
                  <dd>{card.owner}</dd>
                </div>
                <div>
                  <dt>Documents</dt>
                  <dd>{card.documents}</dd>
                </div>
                <div>
                  <dt>Care</dt>
                  <dd>{card.care}</dd>
                </div>
                <div>
                  <dt>Value</dt>
                  <dd>{card.value}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </div>
      <div className="subscription-floating-box subscription-floating-box--one">
        <span>Records locked</span>
        <strong>Documents synced</strong>
      </div>
      <div className="subscription-floating-box subscription-floating-box--two">
        <span>Buyer action</span>
        <strong>Packet viewed</strong>
      </div>
      <div className="subscription-floating-box subscription-floating-box--three">
        <span>Care signal</span>
        <strong>Vet date moved</strong>
      </div>
    </div>
  );
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
  const checkoutSignals = [
    { label: 'Managed checkout', state: billingEnabled ? 'Enabled' : 'Paused', value: billingEnabled ? 100 : 28 },
    { label: 'Stripe fallback', state: anyPaymentLink ? 'Payment links ready' : 'No links configured', value: anyPaymentLink ? 100 : 36 },
    { label: 'Workspace identity', state: hasManagedIdentity ? 'Session verified' : 'Sign in needed', value: hasManagedIdentity ? 100 : 44 },
  ];

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

  const content = (
    <>
      <section className="subscription-hero" aria-labelledby="subscription-title">
        <div className="subscription-hero__copy">
          <h1 id="subscription-title">Choose your XBAR operating tier.</h1>
          <p>
            Start with the free trial, then add a card for the paid plan that matches your horse count,
            team size, document load, and buyer workflow.
          </p>
          <div className="subscription-hero__actions">
            <button type="button" onClick={startTrial}>Start free trial</button>
            <a href="#plans">Compare paid plans</a>
          </div>
          <div className="subscription-hero__trust" aria-label="Subscription assurances">
            <span>Records stay intact</span>
            <span>Managed checkout or Stripe links</span>
            <span>{billingReadinessLabel}</span>
          </div>
        </div>
        <HorseProfileCarousel />
      </section>

      <section className="subscription-readiness-console" aria-label="Checkout readiness">
        <div className="subscription-readiness-console__copy">
          <span>Stripe-ready plan engine</span>
          <strong>{billingReadinessLabel}</strong>
          <p>
            Paid plan actions still use the production path already in XBAR: managed checkout first,
            then configured Stripe payment links. The visual layer clarifies the gate without changing billing rules.
          </p>
        </div>
        <div className="subscription-readiness-console__grid">
          {checkoutSignals.map((signal) => (
            <div className="subscription-readiness-card" key={signal.label}>
              <div><span>{signal.label}</span><strong>{signal.state}</strong></div>
              <i><span style={{ width: `${signal.value}%` }} /></i>
            </div>
          ))}
        </div>
        <div className="subscription-checkout-boxes" aria-hidden="true">
          <span>Plan selected</span>
          <span>Identity checked</span>
          <span>Checkout guarded</span>
        </div>
      </section>

      <section id="plans" className="subscription-plans" aria-label="Choose a subscription tier">
        <article className={`subscription-plan-card subscription-plan-card--trial${trialActive ? ' subscription-plan-card--active' : ''}`} id="trial">
          <span className="subscription-plan-card__label">Free Trial</span>
          <h2>Evaluate XBAR</h2>
          <div className="subscription-plan-card__price">
            $0
            <small>trial</small>
          </div>
          <p>Use Starter capacity while you set up the workspace and confirm the operating fit.</p>
          <ul>
            <li>{formatLimit(subscriptionPlans.Starter.limits.horseLimit, 'horses')}</li>
            <li>{formatLimit(subscriptionPlans.Starter.limits.documentLimit, 'documents')}</li>
            <li>No card required to enter the trial workspace</li>
          </ul>
          <button type="button" onClick={startTrial}>{workspaceReady ? 'Open workspace' : 'Start trial'}</button>
        </article>

        {tiers.map((tier) => {
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
              className={`subscription-plan-card${highlighted ? ' subscription-plan-card--recommended' : ''}${paidCurrent ? ' subscription-plan-card--active' : ''}`}
              key={tier}
            >
              <span className="subscription-plan-card__label">{highlighted ? 'Recommended' : 'Paid Plan'}</span>
              <h2>{tier}</h2>
              <div className="subscription-plan-card__price">
                {formatCurrency(config.monthlyRate)}
                <small>per month</small>
              </div>
              <p>{profile.fit}</p>
              <ul>
                <li>{formatLimit(config.limits.horseLimit, 'horses')}</li>
                <li>{formatLimit(config.limits.seatLimit, 'team seats')}</li>
                <li>{formatLimit(config.limits.documentLimit, 'documents')}</li>
                <li>{config.featureFlags[1] ?? config.featureFlags[0]}</li>
              </ul>
              {paidCurrent ? (
                <button type="button" disabled>Current plan</button>
              ) : (
                <button type="button" disabled={!readiness.ready} onClick={() => void beginCheckout(tier)}>
                  {busy ? 'Opening checkout' : `Add card for ${tier}`}
                </button>
              )}
              <span className="subscription-plan-card__note">{paidCurrent ? 'Your active paid capacity.' : readiness.reason}</span>
            </article>
          );
        })}
      </section>

      <section className="subscription-payment" aria-label="Payment details">
        <div>
          <h2>Billing matches what is built today.</h2>
          <p>
            Paid plan selections use the billing integrations already in the code: managed checkout first,
            then configured Stripe payment links. If neither is configured, paid plan buttons stay disabled.
          </p>
        </div>
        <div className="subscription-payment-card" aria-hidden="true">
          <span>Card step</span>
          <strong>{billingReadinessLabel}</strong>
          <small>{trialActive ? 'Trial can continue without billing' : `${subscription.tier} account`}</small>
        </div>
      </section>

      <section className="subscription-scale" aria-label="Enterprise billing">
        <div>
          <h2>Enterprise stays inside the same plan path.</h2>
          <p>
            Enterprise is a paid tier in the subscription code. When managed billing or the Enterprise
            payment link is configured, it opens checkout through the same plan card behavior.
          </p>
        </div>
        <a href="#enterprise">Review Enterprise</a>
      </section>
    </>
  );

  if (!standalone) {
    return <div className="subscription-onboarding subscription-onboarding--embedded">{content}</div>;
  }

  return (
    <main className="subscription-onboarding">
      <div className="subscription-surface-x subscription-surface-x--hero" aria-hidden="true" />
      <div className="subscription-surface-x subscription-surface-x--footer" aria-hidden="true" />
      <header className="subscription-nav">
        <Link className="subscription-brand" to="/landing" aria-label="XBAR overview">
          <img src={XBAR_MAIN_LOGO_SRC} alt="" />
          <span>XBAR</span>
        </Link>
        <nav aria-label="Subscription sections">
          <a href="#trial">Trial</a>
          <a href="#starter">Starter</a>
          <a href="#professional">Professional</a>
          <a href="#ranch-ops">Ranch Ops</a>
          <a href="#enterprise">Enterprise</a>
        </nav>
        <Link className="subscription-nav__action" to={continuePath}>
          {workspaceReady ? 'Access workspace' : 'Setup workspace'}
        </Link>
      </header>

      <div className="subscription-body">{content}</div>

      <footer className="subscription-footer">
        <div>
          <Link className="subscription-brand" to="/landing">
            <img src={XBAR_MAIN_LOGO_SRC} alt="" />
            <span>XBAR</span>
          </Link>
          <p>Copyright 2026 XBAR LLC. Precision horse operations.</p>
        </div>
        {footerGroups.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <span>{group.title}</span>
            {group.links.map((link) => (
              <Link key={link.label} to={link.to}>
                {link.label}
              </Link>
            ))}
          </nav>
        ))}
      </footer>
    </main>
  );
}

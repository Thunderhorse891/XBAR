import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { startManagedCheckout } from '@/lib/billingApi';
import { formatCurrency, formatDateLabel } from '@/lib/format';
import { getStripePaymentLink, stripeConfig } from '@/lib/platformConfig';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { getCheckoutReadiness, planOutcomes, recommendedTier } from '@/lib/subscriptionDecision';
import { subscriptionPlans } from '@/lib/subscriptionPlans';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { SubscriptionTier } from '@/types/xbar';
import './subscriptionExperience.css';

const tiers: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];
const tierFit: Record<SubscriptionTier, string> = {
  Starter: 'For an owner building a dependable digital record.',
  Professional: 'For programs coordinating horses, buyers, and a small team.',
  'Ranch Ops': 'For working ranches managing care, assets, breeding, and spend.',
  Enterprise: 'For complex operations that need substantially more capacity.',
};

function usagePercent(used: number, limit: number) {
  return limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
}

export default function Subscriptions() {
  const [params] = useSearchParams();
  const requestedValue = params.get('plan');
  const requestedTier = tiers.find((tier) => tier === requestedValue);
  const subscription = useXbarStore((state) => state.subscription);
  const canManageBilling = useCurrentRoleCapability('manageBilling');
  const session = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const pushToast = useUiStore((state) => state.pushToast);
  const [checkoutTier, setCheckoutTier] = useState<SubscriptionTier | null>(null);
  const decisionTier = recommendedTier(subscription.tier, requestedTier);
  const decisionPlan = subscriptionPlans[decisionTier];
  const currentPlan = subscriptionPlans[subscription.tier];
  const hasManagedIdentity = Boolean(session?.access_token && workspaceId);
  const anyPaymentLink = Object.values(stripeConfig.paymentLinks).some(Boolean);
  const billingEnabled = stripeConfig.managedBillingEnabled;
  const monthlyDifference = decisionPlan.monthlyRate - currentPlan.monthlyRate;

  const emit = (eventName: Parameters<typeof productEvent>[0], payload: Record<string, unknown>, severity: 'info' | 'warning' = 'info') => {
    void trackRuntimeEvent({ workspaceId, severity, ...productEvent(eventName, payload) });
  };

  const beginCheckout = async (tier: SubscriptionTier) => {
    setCheckoutTier(tier);
    emit(productEventNames.checkoutStarted, { tier, currentTier: subscription.tier, source: requestedTier ? 'selected_plan' : 'plans' });
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

  const usage = [
    { label: 'Team seats', used: subscription.usage.seatsUsed, limit: subscription.usage.seatLimit, suffix: '' },
    { label: 'Documents', used: subscription.usage.documentsProcessed, limit: subscription.usage.documentLimit, suffix: '' },
    { label: 'Storage', used: subscription.usage.storageUsedGb, limit: subscription.usage.storageLimitGb, suffix: ' GB' },
    { label: 'Shared access', used: subscription.usage.sharedAccessSeatsUsed, limit: subscription.usage.sharedAccessSeatLimit, suffix: '' },
  ];

  return <>
    <PageHeader eyebrow="Subscription" title="Plan & billing" actions={<><Pill tone={billingEnabled && (hasManagedIdentity || anyPaymentLink) ? 'emerald' : 'amber'}>{billingEnabled ? (hasManagedIdentity || anyPaymentLink ? 'Secure checkout ready' : 'Sign-in required for checkout') : 'Managed billing paused'}</Pill><Pill tone="blue">{subscription.tier}</Pill></>} />
    <section className="subscription-hero">
      <div className="subscription-hero__main"><Pill tone={requestedTier ? 'emerald' : 'blue'}>{requestedTier ? `${requestedTier} selected` : 'Built to grow with the operation'}</Pill><h2 className="subscription-hero__title">{requestedTier ? `Review ${requestedTier}, then start securely.` : 'Choose capacity around the work that must move.'}</h2><p className="subscription-hero__copy">Every plan protects the core horse record. Move up when collaboration, sale-readiness, operating breadth, or capacity will remove a real blocker from the ranch.</p><div className="subscription-trust-row"><span>Secure checkout when available</span><span>Change plans as the operation grows</span><span>Your records stay intact</span></div></div>
      <aside className="subscription-hero__side"><span className="field-label">Current plan</span><strong style={{ fontSize: 28 }}>{subscription.tier}</strong><span className="stack-item__copy">{formatCurrency(subscription.monthlyRate)}/month{subscription.renewalDate ? ` · renews ${formatDateLabel(subscription.renewalDate)}` : ` · ${subscription.billingState}`}</span>{billingEnabled && stripeConfig.billingPortalUrl && canManageBilling ? <a className="button button--ghost" href={stripeConfig.billingPortalUrl} target="_blank" rel="noreferrer">Manage payment details</a> : <span className="stack-item__copy">{billingEnabled ? 'Review the decision framework before changing capacity.' : 'Billing changes are paused while managed billing is offline.'}</span>}</aside>
    </section>

    <section className="subscription-decision" aria-label={`${decisionTier} decision framework`}>
      <div className="subscription-decision__main"><span className="subscription-decision__eyebrow">What {decisionTier} changes</span><h3>{decisionTier === subscription.tier ? `${decisionTier} remains the right operating level.` : `Move to ${decisionTier} when these outcomes matter now.`}</h3><p>Choose based on the work the operation needs to complete, not a feature count.</p><div className="subscription-decision__outcomes">{planOutcomes[decisionTier].map((outcome) => <span key={outcome}>{outcome}</span>)}</div></div>
      <aside className="subscription-decision__delta"><span className="subscription-decision__eyebrow">Capacity decision</span><div className="subscription-decision__delta-row"><span>Current</span><strong>{subscription.tier}</strong></div><div className="subscription-decision__delta-row"><span>Considering</span><strong>{decisionTier}</strong></div><div className="subscription-decision__delta-row"><span>Monthly change</span><strong>{monthlyDifference === 0 ? 'No change' : `${monthlyDifference > 0 ? '+' : '-'}${formatCurrency(Math.abs(monthlyDifference))}`}</strong></div><div className="subscription-decision__delta-row"><span>Team capacity</span><strong>{decisionPlan.limits.seatLimit} seats</strong></div><div className="subscription-decision__delta-row"><span>Document capacity</span><strong>{decisionPlan.limits.documentLimit.toLocaleString()}</strong></div></aside>
    </section>

    <Panel eyebrow="Capacity" title="Current usage"><div className="subscription-usage-grid">{usage.map((item) => <div className="subscription-usage-card" key={item.label}><div className="subscription-usage-card__top"><span>{item.label}</span><strong>{item.used}{item.suffix} / {item.limit}{item.suffix}</strong></div><ProgressBar value={usagePercent(item.used, item.limit)} tone={usagePercent(item.used, item.limit) >= 80 ? 'amber' : 'blue'} /></div>)}</div></Panel>
    <Panel eyebrow="Choose your operating level" title="Plans"><div className="subscription-plan-grid">{tiers.map((tier) => {
      const config = subscriptionPlans[tier];
      const current = tier === subscription.tier;
      const highlighted = tier === decisionTier;
      const busy = checkoutTier === tier;
      const readiness = getCheckoutReadiness({ billingEnabled, canManageBilling, hasManagedIdentity, hasPaymentLink: Boolean(getStripePaymentLink(tier)), checkoutInProgress: checkoutTier !== null });
      return <article id={`plan-${tier.replace(/\s/g, '-').toLowerCase()}`} className={`subscription-plan${highlighted ? ' subscription-plan--recommended' : ''}`} key={tier}>{highlighted && <span className="subscription-plan__badge">{requestedTier ? 'Your selection' : current ? 'Current fit' : 'Next operating level'}</span>}<div className="subscription-plan__name">{tier}</div><div className="subscription-plan__fit">{tierFit[tier]}</div><div className="subscription-plan__price">{formatCurrency(config.monthlyRate)}<small>/month</small></div><div className="subscription-plan__limits"><span>{config.limits.seatLimit} team seats</span><span>{config.limits.documentLimit.toLocaleString()} documents · {config.limits.storageLimitGb.toLocaleString()} GB</span><span>{config.limits.sharedAccessSeatLimit} shared-access seats</span></div><ul className="subscription-plan__features">{config.featureFlags.map((feature) => <li key={feature}>{feature}</li>)}</ul>{current ? <button className="button button--ghost subscription-plan__action" type="button" disabled>Current plan</button> : <button className="button button--primary subscription-plan__action" type="button" disabled={!readiness.ready} onClick={() => void beginCheckout(tier)}>{busy ? 'Opening secure checkout...' : `Choose ${tier}`}</button>}<div className="subscription-checkout-note">{current ? 'Your current operating capacity.' : readiness.reason}</div></article>;
    })}</div></Panel>
  </>;
}

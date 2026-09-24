import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { canUsePaymentLinkFallback, checkoutRouteFor, requestTrialStart, startManagedCheckout } from '@/lib/billingApi';
import { formatCurrency } from '@/lib/format';
import { isNativeApp } from '@/lib/nativePlatform';
import {
  claimPendingHostedPurchase,
  clearPendingHostedPurchase,
  isPendingHostedPurchase,
  pendingHostedPurchaseKey,
  pendingHostedPurchaseNotice,
  readPendingHostedPurchase,
} from '@/lib/pendingHostedPurchase';
import { getStripePaymentLink, stripeConfig } from '@/lib/platformConfig';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { revenuePlanMatrix } from '@/lib/revenuePlanMatrix';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import {
  getBillingPortalAction,
  getCheckoutReadiness,
  isCurrentPaidPlan,
  isEntitledBillingState,
  hasActivePaidPlan,
  isSubscriptionRecoverable,
  recommendedTier,
} from '@/lib/subscriptionDecision';
import { subscriptionPlans } from '@/lib/subscriptionPlans';
import { getTrialState, trialDaysRemaining, trialStatusCopy } from '@/lib/trialSubscription';
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
  return `${value.toLocaleString()} ${value === 1 && noun.endsWith('s') ? noun.slice(0, -1) : noun}`;
}

export default function Subscriptions() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedValue = params.get('plan');
  const requestedTier = tiers.find((tier) => tier === requestedValue);
  const subscription = useXbarStore((state) => state.subscription);
  const workspaceReady = useWorkspaceReady();
  const canManageBilling = useCurrentRoleCapability('manageBilling');
  const session = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const pushToast = useUiStore((state) => state.pushToast);
  const startTrialSubscription = useXbarStore((state) => state.startTrialSubscription);
  const [checkoutTier, setCheckoutTier] = useState<SubscriptionTier | null>(null);
  const [trialStarting, setTrialStarting] = useState(false);
  // Billing period for plan display and checkout. Annual is 10x monthly (2
  // months free). The server fails closed when an annual price id is not
  // configured, so selecting annual before Stripe is set up cannot sell the
  // wrong period — checkout refuses instead.
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
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
  const defaultDecisionTier = requestedTier ?? lapsedTier ?? recommendedTier(subscription.tier);
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier>(defaultDecisionTier);
  const decisionTier = selectedTier;
  const decisionConfig = subscriptionPlans[decisionTier];
  const decisionProfile = revenuePlanMatrix[decisionTier];
  const hasManagedIdentity = Boolean(session?.access_token && workspaceId);
  const billingEnabled = stripeConfig.managedBillingEnabled;
  const selectedPaymentLink = Boolean(getStripePaymentLink(decisionTier, billingPeriod));
  // The annual toggle is only useful when annual can actually be bought:
  // managed billing (server price ids) or at least one annual payment link.
  const annualAvailable = billingEnabled || tiers.some((tier) => Boolean(getStripePaymentLink(tier, 'annual')));
  /*
   * Read once per render and passed to every billing decision below.
   *
   * App Store Review Guideline 3.1.1: a digital subscription sold inside the
   * app has to go through In-App Purchase, so a store build offers no purchase
   * path at all. The refusals live in getCheckoutReadiness and
   * getBillingPortalAction rather than in this JSX, so all four call sites
   * answer the same question and no role or Stripe configuration can reopen a
   * way around it.
   */
  const nativeApp = isNativeApp();
  /*
   * "Is there a checkout on this screen at all", which in a store build there
   * is not.
   *
   * Disabling the button was not enough, and this is the line that fixes the
   * rest. This flag drives the whole payment panel: without the native term it
   * still read "Due at checkout", "then monthly", "Payment: handled at
   * checkout", and rendered a "Card details / Secure checkout" box with card
   * number, expiration and CVC rows. Apple forbids PRESENTING the paywall, not
   * only completing it, so a store build that displays a card form and calls
   * the price "due at checkout" is the rejection even though nothing can be
   * bought behind it.
   */
  const selectedCheckoutConfigured = !nativeApp && (billingEnabled || selectedPaymentLink);
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
  /*
   * Trial state: 'none' | 'active' | 'expired', computed from the profile's
   * recorded trial start. Native apps never get the trial CTA — Apple treats
   * in-app "free trial" offers as digital-goods language under 3.1.1, and the
   * trial is web-only until the iOS path decision lands.
   */
  const trialState = getTrialState(subscription.trialStart);
  const trialDaysLeft = trialState === 'active' ? trialDaysRemaining(subscription.trialStart) : 0;
  const trialCopy = trialStatusCopy(trialState, trialDaysLeft);
  const trialCanStart = trialState === 'none' && !nativeApp && canManageBilling && !subscriptionActive;
  /*
   * Where a workspace that already has a subscription is sent instead.
   *
   * Refusing checkout is right and is not enough on its own: without this the
   * primary action rendered disabled, the plan cards did nothing, and the copy
   * pointed at a billing portal the app never linked to. See
   * `getBillingPortalAction` for why routing here cannot duplicate a
   * subscription the way checkout would.
   */
  const hasBillingPortal = Boolean(stripeConfig.billingPortalUrl.trim());
  /*
   * Read once per render and passed to every readiness call below.
   *
   * App Store Review Guideline 3.1.1: a digital subscription sold inside the
   * app has to go through In-App Purchase, so a store build offers no purchase
   * path at all. The refusal lives in getCheckoutReadiness rather than in the
   * JSX here, so all three call sites answer the same question and no role or
   * Stripe configuration can reopen a way around it.
   */
  const billingPortalAction = getBillingPortalAction({
    portalUrl: stripeConfig.billingPortalUrl,
    canManageBilling,
    subscriptionActive,
    subscriptionRecoverable,
    nativeApp,
  });
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
    hasBillingPortal,
    nativeApp,
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

  useEffect(() => {
    setSelectedTier(defaultDecisionTier);
  }, [defaultDecisionTier]);

  /*
   * A hosted purchase this deployment cannot confirm.
   *
   * With managed billing off there is no webhook, so completing a payment link
   * changes nothing the app can see. The customer comes back from Stripe to a
   * page that still says Starter with the buttons still enabled, does the
   * obvious thing, and is charged twice. See `pendingHostedPurchase`.
   */
  const [pendingPurchase, setPendingPurchase] = useState(() => readPendingHostedPurchase(workspaceId));

  /*
   * Another tab may have started the purchase.
   *
   * This state is a cache, and it was read once. Two billing tabs open at the
   * same time both began with nothing pending, so after the first redirected
   * the second still showed an enabled button. The redirect itself re-reads
   * storage — that is the guard — and this keeps what the customer is LOOKING
   * at honest, so they are not invited to click something that will be refused.
   */
  useEffect(() => {
    const syncFromStorage = (event: StorageEvent) => {
      // A null key means the whole store was cleared, which is also our answer.
      if (event.key && event.key !== pendingHostedPurchaseKey(workspaceId)) return;
      setPendingPurchase(readPendingHostedPurchase(workspaceId));
    };
    window.addEventListener('storage', syncFromStorage);
    return () => window.removeEventListener('storage', syncFromStorage);
  }, [workspaceId]);
  const purchaseAwaitingActivation =
    isPendingHostedPurchase(pendingPurchase, new Date(), workspaceId) && !subscriptionActive;
  const forgetPendingPurchase = () => {
    clearPendingHostedPurchase(workspaceId);
    setPendingPurchase(null);
  };

  /*
   * THE only way this screen follows a payment link.
   *
   * There are two routes to one — the hosted-only primary route, and the
   * `no_managed_identity` fallback — and they are the same act with the same
   * consequence: a static link that cannot associate its subscription with a
   * workspace, in a deployment with no webhook to confirm it. Guarding one and
   * not the other is exactly the mistake that shipped, so there is no second
   * `assign` to forget: both go through here.
   */
  const followPaymentLink = async (tier: SubscriptionTier, link: string, managedFailure?: string) => {
    /*
     * Nothing here knows whether the last payment went through — that is what
     * the missing webhook was for. It does know one was started, and that is
     * enough to stop offering the same purchase again.
     */
    /*
     * CLAIM the purchase; do not read and then write.
     *
     * Reading storage instead of this tab's cached state fixed the tab that
     * decided from a stale snapshot, but it left a narrower window open: two
     * tabs clicking at the same moment can both finish the read before either
     * writes, and a check-then-set that both sides pass guards nothing. The
     * claim does the read and the write inside one cross-tab lock, so the
     * second tab looks only after the first has finished writing.
     */
    const claim = await claimPendingHostedPurchase(
      { tier, startedAt: new Date().toISOString(), workspaceId },
      new Date(),
      !subscriptionActive,
    );
    if (!claim.claimed) {
      setPendingPurchase(claim.blockedBy);
      emit(productEventNames.checkoutFailed, { tier, reason: 'hosted_purchase_pending' }, 'warning');
      pushToast({
        title: 'A purchase is already waiting to be activated',
        message: pendingHostedPurchaseNotice(claim.blockedBy),
        tone: 'warning',
      });
      setCheckoutTier(null);
      return;
    }

    setPendingPurchase(claim.pending);

    if (managedFailure) {
      emit(productEventNames.checkoutRedirected, { tier, method: 'payment_link', managedFailure }, 'warning');
    } else {
      emit(productEventNames.checkoutRedirected, { tier, method: 'payment_link' });
    }
    window.location.assign(link);
  };

  const openBillingPortal = () => {
    if (!billingPortalAction) return;
    emit(productEventNames.checkoutRedirected, { tier: subscription.tier, method: 'billing_portal' });
    window.location.assign(billingPortalAction.url);
  };

  const selectTier = (tier: SubscriptionTier) => {
    setSelectedTier(tier);
    const nextParams = new URLSearchParams(params);
    nextParams.set('plan', tier);
    setParams(nextParams, { replace: true });
  };

  const beginCheckout = async (tier: SubscriptionTier) => {
    selectTier(tier);
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
      hasPaymentLink: Boolean(getStripePaymentLink(tier, billingPeriod)),
      checkoutInProgress: false,
      subscriptionRecoverable,
      subscriptionActive,
      hasBillingPortal,
      nativeApp,
    });
    if (!readiness.ready) {
      emit(productEventNames.checkoutFailed, { tier, reason: readiness.reason }, 'warning');
      pushToast({
        title:
          readiness.mode === 'external'
            ? 'Plans are managed outside the app'
            : readiness.mode === 'manual'
              ? 'Billing not configured yet'
              : readiness.mode === 'recover'
                ? 'Payment needs to be settled first'
                : 'Checkout needs attention',
        // The external refusal already says the workspace is unchanged, and
        // saying it twice reads like something went wrong. Nothing did: a store
        // build is not supposed to sell anything.
        message:
          readiness.mode === 'external'
            ? readiness.reason
            : `${readiness.reason} Your workspace and current plan were not changed.`,
        tone: 'warning',
      });
      setCheckoutTier(null);
      return;
    }

    /*
     * A hosted-link-only deployment never calls the managed endpoint at all.
     *
     * Not a fallback — the primary route. With managed billing off the
     * endpoint refuses with no code before reading any billing row, and the
     * allowlist below then rightly declines to follow it, which suppressed the
     * one checkout route such a deployment has. See `checkoutRouteFor` for why
     * skipping the request costs no protection.
     */
    const hostedOnlyLink = getStripePaymentLink(tier, billingPeriod);
    if (checkoutRouteFor({ managedBillingEnabled: billingEnabled, paymentLink: hostedOnlyLink }) === 'payment_link') {
      await followPaymentLink(tier, hostedOnlyLink);
      return;
    }

    const managed = await startManagedCheckout({
      tier,
      workspaceId,
      accessToken: session?.access_token ?? '',
      billingPeriod,
    });
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
    // The fallback honors the selected billing period: with no annual link
    // configured there is no fallback, which is what keeps an annual
    // selection from silently buying the monthly link.
    const fallback = canUsePaymentLinkFallback(managed.code) ? getStripePaymentLink(tier, billingPeriod) : '';
    if (fallback) {
      /*
       * The same guard as the hosted-only route, because this is the same act.
       * A static link cannot tell Stripe which workspace it belongs to, and
       * there is no webhook to confirm it either way — so returning to this
       * page after paying left checkout enabled and bought a second
       * subscription. It shipped guarded on one branch and not the other,
       * which is why both now go through `followPaymentLink`.
       */
      await followPaymentLink(tier, fallback, managed.message);
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

  const startTrial = async () => {
    // First-run onboarding keeps its own path: this screen doubles as the
    // setup flow before the workspace is ready.
    if (!workspaceReady) {
      navigate('/setup');
      return;
    }
    // An active or expired trial has no action here — the countdown or the
    // upgrade prompt is the content, and the plan list below is the way up.
    if (trialState !== 'none') {
      navigate('/');
      return;
    }
    // Everyone who cannot start a trial (no billing permission, native app,
    // already on a paid plan) keeps the old behavior: continue on the Starter
    // path. The button says so; it must not silently do nothing.
    if (!trialCanStart || trialStarting) {
      navigate(continuePath);
      return;
    }

    setTrialStarting(true);
    try {
      // Cloud workspaces record the trial on the server: the client cannot
      // grant itself one. Local-only workspaces apply it directly — there is
      // no server to call and the profile persists on this device.
      const startedAt = hasManagedIdentity
        ? await requestTrialStart({ workspaceId: workspaceId ?? '', accessToken: session?.access_token ?? '' }).then(
            (result) => {
              if (!result.ok) {
                pushToast({ title: 'Trial could not start', message: result.message, tone: 'error' });
                return null;
              }
              return result.trial.startedAt;
            },
          )
        : new Date().toISOString();

      if (!startedAt) return;
      const applied = startTrialSubscription(startedAt);
      if (applied.ok) {
        emit(productEventNames.trialStarted, { plan: 'Professional' });
        pushToast({
          title: 'Professional trial started',
          message: 'You have 14 days of full Professional access. No card was charged.',
        });
      } else {
        // The server already recorded the trial, so this is a local-view
        // problem, not a lost trial: the next cloud load reads the record.
        pushToast({
          title: 'Trial started',
          message: `${applied.message} Reload the page to see your Professional access.`,
          tone: 'warning',
        });
      }
    } finally {
      setTrialStarting(false);
    }
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
      hasPaymentLink: Boolean(getStripePaymentLink(tier, billingPeriod)),
      checkoutInProgress: checkoutTier !== null,
      subscriptionRecoverable,
      subscriptionActive,
      hasBillingPortal,
      nativeApp,
    });
    const chooseTier = () => {
      selectTier(tier);
      if (paidCurrent || setupCurrent) return;
      if (!readiness.ready) {
        // A subscription already exists, so this cannot open checkout — but it
        // can open the place where that subscription is actually changed.
        // Returning silently is what left every upgrade with nowhere to go.
        if (billingPortalAction) openBillingPortal();
        return;
      }
      void beginCheckout(tier);
    };

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
          <strong>{formatCurrency(billingPeriod === 'annual' ? config.annualRate : config.monthlyRate)}</strong>
          <small>{billingPeriod === 'annual' ? '/ year · 2 months free' : '/ month'}</small>
        </div>
        <ul>
          <li>{formatLimit(config.limits.horseLimit, 'horses')}</li>
          <li>{formatLimit(config.limits.salePacketLimit, 'sale packets')}</li>
        </ul>
        {/* Seat, document and storage quotas are already included in this
            canonical feature copy; show each once in the comparison card.
            What the tier includes, not just how much of it. Rendered whatever
            the billing configuration is: being unable to buy a plan is no
            reason to stop showing what it contains. */}
        <ul className="checkout-plan__features">
          {config.featureFlags.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        {paidCurrent || setupCurrent ? (
          <button
            type="button"
            disabled={checkoutTier !== null}
            title={`View ${paidCurrent ? 'current plan' : 'Starter setup'} details`}
            onClick={chooseTier}
          >
            {paidCurrent ? 'View current plan' : 'View Starter setup'}
          </button>
        ) : (
          <button
            type="button"
            disabled={checkoutTier !== null}
            title={readiness.ready ? readiness.reason : `View ${tier} details. ${readiness.reason}`}
            onClick={chooseTier}
          >
            {busy
              ? 'Opening checkout...'
              : !readiness.ready
                ? `View ${tier}`
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
              {!workspaceReady ? (
                <>
                  <span>Starter setup</span>
                  <h2>Start with XBAR</h2>
                  <p>No payment is collected in this local setup flow. Paid plans require completed checkout.</p>
                </>
              ) : (
                <>
                  <span>{trialCopy.eyebrow}</span>
                  <h2>{trialCopy.heading}</h2>
                  <p>{trialCopy.message}</p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={startTrial}
              disabled={trialState === 'none' && trialCanStart && trialStarting}
            >
              {!workspaceReady
                ? 'Continue setup'
                : trialState === 'active'
                  ? 'Continue'
                  : trialState === 'expired'
                    ? 'Continue'
                    : trialCanStart
                      ? trialStarting
                        ? 'Starting trial…'
                        : 'Start 14-day trial'
                      : 'Continue'}
            </button>
            <small>
              {starterSetup
                ? 'Setup active'
                : trialState === 'active'
                  ? `${trialDaysLeft} of 14 days left · full Professional access`
                  : trialState === 'expired'
                    ? 'Pick a plan below to keep going'
                    : `${formatLimit(subscriptionPlans.Starter.limits.horseLimit, 'horses')} and ${formatLimit(subscriptionPlans.Starter.limits.documentLimit, 'documents')}`}
            </small>
          </div>

          {annualAvailable && (
            <div className="checkout-billing-toggle" role="group" aria-label="Billing period">
              <button
                type="button"
                aria-pressed={billingPeriod === 'monthly'}
                className={billingPeriod === 'monthly' ? 'checkout-billing-toggle--active' : ''}
                onClick={() => setBillingPeriod('monthly')}
              >
                Monthly
              </button>
              <button
                type="button"
                aria-pressed={billingPeriod === 'annual'}
                className={billingPeriod === 'annual' ? 'checkout-billing-toggle--active' : ''}
                onClick={() => setBillingPeriod('annual')}
              >
                Annual <small>2 months free</small>
              </button>
            </div>
          )}

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
            <span>
              {selectedCheckoutConfigured
                ? 'Due at checkout'
                : billingPeriod === 'annual'
                  ? 'Annual price'
                  : 'Monthly price'}
            </span>
            <strong>
              {formatCurrency(billingPeriod === 'annual' ? decisionConfig.annualRate : decisionConfig.monthlyRate)}
            </strong>
            <small>
              {selectedCheckoutConfigured
                ? billingPeriod === 'annual'
                  ? 'then annually'
                  : 'then monthly'
                : 'not charged in app'}
            </small>
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
          ) : selectedReadiness.mode === 'external' ? (
            <div className="checkout-card-box" aria-label="Billing details">
              <div className="checkout-card-box__top">
                <span>Billing</span>
                <strong>Managed outside the app</strong>
              </div>
              {/*
                Deliberately says nothing about where a plan CAN be bought.
                Guideline 3.1.1 forbids calls to action that direct customers to
                a purchasing mechanism other than In-App Purchase, and that
                covers plain instructions as much as links -- "sign in on the
                web to subscribe" is exactly such a direction, which is what an
                earlier version of this sentence said. Current plan state only.
              */}
              <p>
                Subscriptions are not sold in the app. Every tier is shown in full so you can compare what they include,
                and your workspace and current plan are unchanged.
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

          {billingPortalAction ? (
            <button
              className="checkout-primary-action"
              type="button"
              title={selectedReadiness.reason}
              onClick={openBillingPortal}
            >
              {billingPortalAction.label}
            </button>
          ) : (
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
                  : selectedReadiness.mode === 'external'
                    ? 'Managed outside the app'
                    : selectedReadiness.mode === 'manual'
                      ? 'Billing not configured yet'
                      : 'Continue to secure checkout'}
            </button>
          )}
          <button
            className="checkout-secondary-action"
            type="button"
            onClick={startTrial}
            disabled={trialCanStart && trialStarting}
          >
            {trialCanStart
              ? trialStarting
                ? 'Starting trial…'
                : 'Start 14-day Professional trial instead'
              : 'Continue with Starter setup'}
          </button>
          {/*
            Said plainly, because the alternative is a customer staring at a
            page that still says Starter and concluding the payment failed. The
            way out is offered in the same breath: nothing here can tell an
            abandoned checkout from an unconfirmed one, so the person who knows
            gets to say.
          */}
          {purchaseAwaitingActivation && pendingPurchase ? (
            <p className="checkout-note">
              {pendingHostedPurchaseNotice(pendingPurchase)}{' '}
              <button type="button" className="checkout-inline-action" onClick={forgetPendingPurchase}>
                I did not complete that purchase
              </button>
            </p>
          ) : (
            <p className="checkout-note">
              {selectedPaidCurrent
                ? 'This paid plan is already active.'
                : selectedReadiness.reason || checkoutReadinessLabel}
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

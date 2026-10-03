import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Check, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { XbarMark } from './BrandMark';
import { billingPathForTier } from '../lib/billingRoutes';
import {
  requestUpgradeOffer,
  UPGRADE_FEATURES,
  upgradePriceDisclosure,
  type UpgradeOffer,
  type UpgradeResult,
} from '../lib/upgradeOffer';
import { canPresentPurchaseFlow } from '../lib/nativePlatform';
import { closeUpgradePrompt, useUpgradeStore, type UpgradePromptRequest } from '../store/useUpgradeStore';
import { useCloudStore } from '../store/useCloudStore';
import { useCurrentRoleCapability, useXbarStore } from '../store/useXbarStore';
import { hasRoleCapability } from '../lib/permissions';
import { queueUpgradeDecline, waitForUpgradeDecline } from '../lib/upgradeSequence';
import { useOwnerPreview } from '../hooks/useOwnerPreview';
import './upgradePrompt.css';

function sameWorkspace(prompt: UpgradePromptRequest) {
  const cloud = useCloudStore.getState();
  return cloud.workspaceId === prompt.workspaceId && (cloud.session?.user.id ?? '') === prompt.accountId;
}

function PromptContent({ prompt }: { prompt: UpgradePromptRequest }) {
  const navigate = useNavigate();
  const canManageBilling = useCurrentRoleCapability('manageBilling');
  const { previewing } = useOwnerPreview();
  const feature = UPGRADE_FEATURES[prompt.feature];
  const declineScope = `${prompt.accountId}:${prompt.feature}`;
  const [offer, setOffer] = useState<UpgradeOffer | null>(null);
  const [error, setError] = useState('');
  const [alreadyIncluded, setAlreadyIncluded] = useState(false);
  const [loading, setLoading] = useState(
    Boolean(prompt.accountId && prompt.workspaceId && canManageBilling && !previewing),
  );
  const [checkingOut, setCheckingOut] = useState(false);
  const pendingAttempt = useRef<Promise<UpgradeResult> | null>(null);
  const active = useRef(true);
  const checkoutPending = useRef(false);
  const declined = useRef(false);

  useEffect(() => {
    active.current = true;
    if (!prompt.accountId || !prompt.workspaceId || !canManageBilling || previewing) return;
    // Same id survives effect replay; the server de-duplicates it. It is never
    // a second deliberate attempt simply because React or the network retried.
    const params = {
      ...prompt,
      accessToken: useCloudStore.getState().session?.access_token ?? '',
      action: 'attempt' as const,
    };
    pendingAttempt.current ??= waitForUpgradeDecline(declineScope).then((saved) =>
      saved && sameWorkspace(prompt)
        ? requestUpgradeOffer(params)
        : {
            ok: false as const,
            message:
              'Your previous choice could not be saved. Check your connection, then close this dialog and try again.',
          },
    );
    void pendingAttempt.current.then((result) => {
      if (!active.current || !sameWorkspace(prompt) || useUpgradeStore.getState().prompt !== prompt) return;
      setLoading(false);
      if (result.ok && result.allowed) setAlreadyIncluded(true);
      else if (result.ok && result.offer) setOffer(result.offer);
      else if (!result.ok) setError(result.message);
    });
    return () => {
      active.current = false;
    };
  }, [prompt, canManageBilling, previewing, declineScope]);

  const dismiss = () => {
    // Dismiss is immediate. Recording it may finish later, and only after the
    // server acknowledged this exact attempt. No stored browser counter grants
    // pricing; failure merely means the next attempt cannot claim a discount.
    if (!declined.current && sameWorkspace(prompt) && !checkoutPending.current) {
      declined.current = true;
      queueUpgradeDecline(declineScope, async () => {
        const result = await pendingAttempt.current;
        if (!result?.ok || !result.offer || !sameWorkspace(prompt)) return true;
        return (
          await requestUpgradeOffer({
            ...prompt,
            action: 'decline',
            accessToken: useCloudStore.getState().session?.access_token ?? '',
          })
        ).ok;
      });
    }
    closeUpgradePrompt();
  };

  const checkout = async () => {
    if (
      !offer?.checkoutAvailable ||
      checkoutPending.current ||
      !sameWorkspace(prompt) ||
      !canManageBilling ||
      previewing
    )
      return;
    checkoutPending.current = true;
    setCheckingOut(true);
    setError('');
    const result = await requestUpgradeOffer({
      ...prompt,
      action: 'checkout',
      billingPeriod: offer.billingPeriod,
      expectedDiscountPercent: offer.discountPercent,
      accessToken: useCloudStore.getState().session?.access_token ?? '',
    });
    if (
      !active.current ||
      !sameWorkspace(prompt) ||
      useUpgradeStore.getState().prompt !== prompt ||
      !hasRoleCapability(useXbarStore.getState().currentRole, 'manageBilling') ||
      !canPresentPurchaseFlow()
    )
      return;
    checkoutPending.current = false;
    setCheckingOut(false);
    if (result.ok && result.url) window.location.assign(result.url);
    else if (!result.ok) setError(result.message);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent
        className="upgrade-prompt"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (prompt.trigger?.isConnected) prompt.trigger.focus();
        }}
      >
        <div className="upgrade-prompt__identity">
          <XbarMark width={34} height={34} />
          <span>More from your ranch records</span>
        </div>
        <p className="upgrade-prompt__eyebrow">Included with {feature.tier}</p>
        <DialogTitle className="upgrade-prompt__title">{feature.label}</DialogTitle>
        <DialogDescription>{feature.detail}</DialogDescription>
        <div className="upgrade-prompt__benefit">
          <Check size={17} aria-hidden="true" />
          <span>Your existing records and included features stay available.</span>
        </div>
        <div className="upgrade-prompt__price" aria-live="polite">
          {alreadyIncluded ? (
            <p>Your plan already includes this feature. Refresh the workspace to load the latest access.</p>
          ) : !canManageBilling ? (
            <p>Ask your workspace admin to review the plan.</p>
          ) : previewing ? (
            <p>You’re previewing a plan. Billing uses the workspace’s real subscription.</p>
          ) : loading ? (
            <p>Checking available pricing…</p>
          ) : offer?.checkoutAvailable ? (
            <>
              {offer.discountPercent === 10 && <strong>10% off your first billing period</strong>}
              <p>{upgradePriceDisclosure(offer)}</p>
              <small>Review any prorated adjustment and the final total on Stripe before confirming.</small>
            </>
          ) : (
            <p>Compare plans for current pricing and available billing options.</p>
          )}
          {offer?.message && <small>{offer.message}</small>}
        </div>
        {error && (
          <p className="upgrade-prompt__error" role="status">
            {error}
          </p>
        )}
        <div className="upgrade-prompt__actions">
          <button className="button button--ghost" type="button" onClick={dismiss}>
            Not now
          </button>
          {canManageBilling &&
            !alreadyIncluded &&
            (offer?.checkoutAvailable ? (
              <button
                className="button button--primary"
                type="button"
                disabled={checkingOut || loading}
                onClick={() => void checkout()}
              >
                {checkingOut ? 'Opening secure review…' : 'Review upgrade'}
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <button
                className="button button--primary"
                type="button"
                onClick={() => {
                  closeUpgradePrompt();
                  navigate(billingPathForTier(feature.tier));
                }}
              >
                Compare plans
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            ))}
        </div>
        <p className="upgrade-prompt__assurance">
          <ShieldCheck size={15} aria-hidden="true" />
          No charge until you confirm the payment.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function UpgradePrompt() {
  const prompt = useUpgradeStore((state) => state.prompt);
  const location = useLocation();
  useEffect(
    () =>
      useCloudStore.subscribe((state, before) => {
        // Invalidate synchronously, including A → B → A while a request is pending.
        if (
          state.workspaceId !== before.workspaceId ||
          state.session?.user.id !== before.session?.user.id ||
          state.workspaceRole !== before.workspaceRole
        )
          closeUpgradePrompt();
      }),
    [],
  );
  useEffect(() => {
    closeUpgradePrompt();
  }, [location.pathname]);
  return prompt && canPresentPurchaseFlow() ? <PromptContent key={prompt.attemptId} prompt={prompt} /> : null;
}

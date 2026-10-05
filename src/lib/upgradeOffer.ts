import { apiConfig } from './platformConfig.js';
import { UPGRADE_FEATURES, type UpgradeFeature } from '../../api/_lib/upgrade-features.js';

export { UPGRADE_FEATURES };
export type { UpgradeFeature };
export type UpgradeOffer = {
  attemptId: string;
  feature: UpgradeFeature;
  targetTier: 'Professional' | 'Ranch Ops' | 'Enterprise';
  billingPeriod: 'monthly' | 'annual';
  currency: 'USD';
  regularAmountCents: number | null;
  firstPeriodAmountCents: number | null;
  discountPercent: 0 | 10;
  checkoutAvailable: boolean;
  message?: string;
};

export function validUpgradeOffer(value: unknown, attemptId: string, feature: UpgradeFeature): value is UpgradeOffer {
  if (!value || typeof value !== 'object') return false;
  const offer = value as UpgradeOffer;
  return (
    offer.attemptId === attemptId &&
    offer.feature === feature &&
    offer.targetTier === UPGRADE_FEATURES[feature].tier &&
    ['monthly', 'annual'].includes(offer.billingPeriod) &&
    offer.currency === 'USD' &&
    [0, 10].includes(offer.discountPercent) &&
    typeof offer.checkoutAvailable === 'boolean' &&
    ((!offer.checkoutAvailable &&
      offer.regularAmountCents === null &&
      offer.firstPeriodAmountCents === null &&
      offer.discountPercent === 0) ||
      (typeof offer.regularAmountCents === 'number' &&
        Number.isSafeInteger(offer.regularAmountCents) &&
        offer.regularAmountCents > 0 &&
        Number.isSafeInteger(offer.firstPeriodAmountCents) &&
        offer.firstPeriodAmountCents === Math.round(offer.regularAmountCents * (1 - offer.discountPercent / 100))))
  );
}

export function upgradePriceDisclosure(offer: UpgradeOffer) {
  if (offer.regularAmountCents === null || offer.firstPeriodAmountCents === null)
    return 'Pricing is unavailable until it can be verified.';
  const money = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: offer.currency }).format(cents / 100);
  const period = offer.billingPeriod === 'annual' ? 'year' : 'month';
  return offer.discountPercent === 10
    ? `${money(offer.firstPeriodAmountCents)} for the first ${period}, then ${money(offer.regularAmountCents)} per ${period}. Renews automatically until cancelled. Taxes, if applicable, are shown before confirmation.`
    : `${money(offer.regularAmountCents)} per ${period}. Renews automatically until cancelled. Taxes, if applicable, are shown before confirmation.`;
}

export type UpgradeRequest = {
  workspaceId: string;
  accessToken: string;
  feature: UpgradeFeature;
  attemptId: string;
  action: 'attempt' | 'decline' | 'checkout';
  billingPeriod?: 'monthly' | 'annual';
  expectedDiscountPercent?: 0 | 10;
};
export type UpgradeResult =
  { ok: true; offer?: UpgradeOffer; url?: string; allowed?: boolean } | { ok: false; message: string };

/** No payment-link fallback: an uncertain response never proves a checkout is safe. */
export async function requestUpgradeOffer(params: UpgradeRequest, signal?: AbortSignal): Promise<UpgradeResult> {
  if (!params.workspaceId || !params.accessToken)
    return { ok: false, message: 'Sign in to manage this workspace’s plan.' };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 30_000);
  try {
    const response = await fetch(`${apiConfig.baseUrl.replace(/\/$/, '')}/api/account/upgrade-offer`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.accessToken}` },
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        feature: params.feature,
        attemptId: params.attemptId,
        action: params.action,
        billingPeriod: params.billingPeriod ?? 'monthly',
        expectedDiscountPercent: params.expectedDiscountPercent,
      }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      offer?: unknown;
      url?: unknown;
      message?: string;
      allowed?: boolean;
    };
    if (!response.ok || payload.ok !== true)
      return {
        ok: false,
        message: payload.message || 'We couldn’t verify an upgrade offer. You can still compare the available plans.',
      };
    if (params.action === 'decline') return { ok: true };
    if (payload.allowed === true) return { ok: true, allowed: true };
    if (params.action === 'checkout') {
      if (typeof payload.url !== 'string')
        return { ok: false, message: 'A secure confirmation page wasn’t returned. Please try again.' };
      const url = new URL(payload.url);
      if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname))
        return { ok: false, message: 'The confirmation address could not be verified.' };
      return { ok: true, url: url.toString() };
    }
    if (!validUpgradeOffer(payload.offer, params.attemptId, params.feature))
      return { ok: false, message: 'Upgrade pricing could not be verified. Compare plans for current options.' };
    return { ok: true, offer: payload.offer };
  } catch {
    return { ok: false, message: 'The request couldn’t be confirmed. Check your connection before trying again.' };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

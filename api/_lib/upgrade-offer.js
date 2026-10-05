import Stripe from 'stripe';
import { z } from 'zod';
import { applyCors } from './cors.js';
import { readJsonBody, sendJson } from './http.js';
import { requireWorkspaceAccess } from './supabase-admin.js';
import { enforceRateLimit } from './rate-limit.js';
import { getWorkspaceEntitlements, tierIncludesPlan } from './entitlements.js';
import { claimCheckoutLock, releaseCheckoutLock } from './checkout-session.js';
import { UPGRADE_FEATURES } from './upgrade-features.js';
import {
  assertUpgradeOwner,
  createUpgradeCheckout,
  offerAction,
  prepareUpgradeQuote,
  UpgradeOfferError,
} from './upgrade-checkout.js';

const schema = z
  .object({
    workspaceId: z.string().uuid(),
    feature: z.enum(Object.keys(UPGRADE_FEATURES)),
    attemptId: z.string().uuid(),
    action: z.enum(['attempt', 'decline', 'checkout']),
    billingPeriod: z.enum(['monthly', 'annual']).default('monthly'),
    expectedDiscountPercent: z.union([z.literal(0), z.literal(10)]).optional(),
  })
  .strict();

/** Injectable boundaries keep behavioral tests on the real endpoint. */
export function createUpgradeOfferHandler({
  authenticate = requireWorkspaceAccess,
  entitlements = getWorkspaceEntitlements,
  rateLimit = enforceRateLimit,
  env = process.env,
  stripe: injectedStripe,
  now = () => new Date(),
} = {}) {
  return async function handler(req, res) {
    if (!applyCors(req, res)) return;
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
    if (!(await rateLimit(req, res, { bucket: 'upgrade-offer', limit: 20, windowSeconds: 60 }))) return;
    let body;
    try {
      body = schema.safeParse(await readJsonBody(req));
    } catch {
      return sendJson(res, 400, { ok: false, message: 'A valid upgrade request is required.' });
    }
    if (!body.success || (body.data.action === 'checkout' && body.data.expectedDiscountPercent === undefined)) {
      return sendJson(res, 400, { ok: false, message: 'Review an upgrade offer before continuing.' });
    }
    const request = body.data;
    const authorization = req.headers?.authorization;
    const token = typeof authorization === 'string' ? authorization.replace(/^Bearer\s+/i, '').trim() : '';
    let claimToken = '';
    let access;
    try {
      access = await authenticate(token, request.workspaceId);
      if (!access.ok) return sendJson(res, access.status, { ok: false, message: access.message });
      const input = { ...request, userId: access.user.id };
      await assertUpgradeOwner(access.supabase, request.workspaceId, access.user.id);
      const entitlement = await entitlements(access.supabase, request.workspaceId, access.user.email);
      if (!entitlement.ok) return sendJson(res, entitlement.status || 503, { ok: false, message: entitlement.message });
      const targetTier = UPGRADE_FEATURES[request.feature].tier;
      if (tierIncludesPlan(entitlement.effectiveTier, targetTier)) {
        return sendJson(res, 200, { ok: true, allowed: true, offer: null });
      }
      const state = await offerAction(access.supabase, input, request.action === 'checkout' ? 'read' : request.action);
      if (request.action === 'decline') return sendJson(res, 200, { ok: true });
      if (request.action === 'checkout') {
        claimToken = await claimCheckoutLock(access.supabase, request.workspaceId);
        if (!claimToken)
          throw new UpgradeOfferError(
            'billing_busy',
            'Another billing request is already opening. Wait a moment and retry.',
          );
      }
      const key = env.STRIPE_SECRET_KEY?.trim();
      const stripe =
        injectedStripe === undefined
          ? key
            ? new Stripe(key, { apiVersion: '2026-02-25.clover' })
            : null
          : injectedStripe;
      let quote;
      try {
        quote = await prepareUpgradeQuote({
          stripe,
          supabase: access.supabase,
          input,
          targetTier,
          discountEligible: state.discountEligible,
          env,
          now: now(),
        });
      } catch (error) {
        if (request.action === 'checkout') throw error;
        return sendJson(res, 200, {
          ok: true,
          offer: {
            attemptId: input.attemptId,
            feature: input.feature,
            targetTier,
            billingPeriod: input.billingPeriod,
            currency: 'USD',
            firstPeriodAmountCents: null,
            regularAmountCents: null,
            discountPercent: 0,
            checkoutAvailable: false,
            message:
              error instanceof UpgradeOfferError
                ? error.message
                : 'Upgrade billing could not be verified. Please try again or compare plans.',
          },
        });
      }
      if (request.action === 'attempt') return sendJson(res, 200, { ok: true, offer: quote.offer });
      if (request.expectedDiscountPercent !== quote.offer.discountPercent) {
        throw new UpgradeOfferError(
          'offer_changed',
          'The discount changed since this offer was shown. Close it and review the available plans again.',
        );
      }
      const result = await createUpgradeCheckout({
        stripe,
        supabase: access.supabase,
        input,
        user: access.user,
        quote,
        claimToken,
        env,
        now: now(),
      });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      if (!(error instanceof UpgradeOfferError))
        console.error('Upgrade offer could not be verified.', error?.type || error?.code || error?.name);
      return sendJson(res, error instanceof UpgradeOfferError ? error.status : 503, {
        ok: false,
        code: error instanceof UpgradeOfferError ? error.code : 'offer_unavailable',
        message:
          error instanceof UpgradeOfferError
            ? error.message
            : 'Upgrade billing could not be verified. Please try again shortly.',
      });
    } finally {
      if (claimToken && access?.supabase) await releaseCheckoutLock(access.supabase, request.workspaceId, claimToken);
    }
  };
}
export default createUpgradeOfferHandler();

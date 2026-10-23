import Stripe from 'stripe';
import { getSupabaseAdmin } from './supabase-admin.js';
import { applyCors } from './cors.js';
import { enforceRateLimit } from './rate-limit.js';
import { sendJson } from './http.js';
import healthHandler from '../health.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^(sub|cus|acct)_[A-Za-z0-9]+$/;
const STATUSES = new Set([
  'all',
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'paused',
]);
const PAGE_SIZE = 25;

function readiness() {
  let result;
  healthHandler(
    { method: 'GET' },
    {
      setHeader() {},
      end(body) {
        result = JSON.parse(body);
      },
    },
  );
  return result;
}

const text = (value) => (typeof value === 'string' ? value.slice(0, 300) : null);
const timestamp = (value) => (Number.isSafeInteger(value) && value > 0 ? value : null);

// No workspace role, email address, JWT decoding, or editable user metadata can
// grant platform access. The sole principal is configured on the server, and
// GoTrue verifies the bearer token afresh before ANY customer/Stripe reads.
export function createOwnerHandler({
  env = process.env,
  getAdmin = getSupabaseAdmin,
  makeStripe = (key) => new Stripe(key, { timeout: 12_000, maxNetworkRetries: 1 }),
  rateLimit = enforceRateLimit,
  readReadiness = readiness,
} = {}) {
  return async function ownerHandler(req, res, { accessOnly = false } = {}) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (!applyCors(req, res, { methods: 'GET, OPTIONS' })) return;
    res.setHeader('Vary', 'Origin, Authorization');
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
    const token = /^Bearer ([^\s]+)$/i.exec(req.headers?.authorization || '')?.[1];
    if (!token) return sendJson(res, 401, { ok: false, message: 'Sign in to continue.' });
    const ownerId = env.XBAR_OWNER_USER_ID?.trim();
    if (!ownerId || !UUID.test(ownerId)) {
      return sendJson(res, 503, { ok: false, message: 'Owner access is not configured.' });
    }
    if (!(await rateLimit(req, res, { bucket: 'owner-dashboard', limit: 90, windowSeconds: 60 }))) return;
    try {
      const admin = getAdmin();
      if (!admin) throw new Error('Owner identity service unavailable');
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data?.user)
        return sendJson(res, 401, { ok: false, message: 'Your session could not be verified. Sign in again.' });
      if (data.user.id !== ownerId || !data.user.email_confirmed_at) {
        return sendJson(res, 403, { ok: false, message: 'This dashboard is reserved for the XBAR owner.' });
      }
      if (accessOnly) return sendJson(res, 200, { ok: true, owner: true });

      const query = new URL(req.url || '/', 'http://localhost').searchParams;
      const status = query.get('status') || 'all';
      const cursor = query.get('after') || '';
      if (!STATUSES.has(status) || (cursor && !/^sub_[A-Za-z0-9]+$/.test(cursor))) {
        return sendJson(res, 400, { ok: false, message: 'Invalid subscription filter or page.' });
      }
      const key = env.STRIPE_SECRET_KEY?.trim() || '';
      const mode = /^(?:sk|rk)_(live|test)_[A-Za-z0-9_]+$/.exec(key)?.[1];
      // Preview builds must never query live customer billing.
      if (!mode || (env.VERCEL_ENV === 'production' ? mode !== 'live' : mode !== 'test')) {
        return sendJson(res, 503, {
          ok: false,
          message: 'Billing requires a live key in production or a test key in previews.',
        });
      }
      const stripe = makeStripe(key);
      const account = await stripe.accounts.retrieve();
      const expectedAccount = env.STRIPE_ACCOUNT_ID?.trim();
      if (!/^acct_[A-Za-z0-9]+$/.test(account?.id) || (expectedAccount && account.id !== expectedAccount)) {
        throw new Error('Billing account mismatch');
      }
      const page = await stripe.subscriptions.list({
        status,
        limit: PAGE_SIZE,
        expand: ['data.customer'],
        ...(cursor ? { starting_after: cursor } : {}),
      });
      if (!Array.isArray(page?.data) || typeof page.has_more !== 'boolean' || (page.has_more && !page.data.length)) {
        throw new Error('Incomplete billing response');
      }
      for (const subscription of page.data) {
        if (
          !/^sub_[A-Za-z0-9]+$/.test(subscription.id) ||
          subscription.livemode !== (mode === 'live') ||
          !STATUSES.has(subscription.status)
        ) {
          throw new Error('Unverified subscription');
        }
      }
      const customerIds = [
        ...new Set(page.data.map((s) => (typeof s.customer === 'string' ? s.customer : s.customer?.id))),
      ];
      if (customerIds.some((id) => !/^cus_[A-Za-z0-9]+$/.test(id))) throw new Error('Missing customer identity');
      let bindings = [];
      let workspaces = [];
      let profiles = [];
      if (customerIds.length) {
        const result = await admin
          .from('workspace_billing_customers')
          .select('workspace_id, stripe_customer_id, stripe_subscription_id', { count: 'exact' })
          .in('stripe_customer_id', customerIds)
          .limit(1001);
        if (
          result.error ||
          !Array.isArray(result.data) ||
          result.count !== result.data.length ||
          result.data.length > 1000
        )
          throw new Error('Incomplete workspace bindings');
        bindings = result.data;
        const ids = [...new Set(bindings.map((b) => b.workspace_id))];
        if (ids.length) {
          const [spaces, plans] = await Promise.all([
            admin.from('workspaces').select('id, name, business_name').in('id', ids).limit(1001),
            admin
              .from('workspace_subscription_profiles')
              .select('workspace_id, tier, billing_state, updated_at')
              .in('workspace_id', ids)
              .limit(1001),
          ]);
          if (
            spaces.error ||
            plans.error ||
            !Array.isArray(spaces.data) ||
            !Array.isArray(plans.data) ||
            spaces.data.length > 1000 ||
            plans.data.length > 1000
          )
            throw new Error('Workspace lookup failed');
          workspaces = spaces.data;
          profiles = plans.data;
        }
      }
      const base = `https://dashboard.stripe.com/${account.id}${mode === 'test' ? '/test' : ''}`;
      const subscriptions = page.data.map((s) => {
        const customer = typeof s.customer === 'object' && !s.customer.deleted ? s.customer : null;
        const customerId = typeof s.customer === 'string' ? s.customer : s.customer.id;
        const linked = bindings.filter((b) => b.stripe_customer_id === customerId && b.stripe_subscription_id === s.id);
        return {
          id: s.id,
          customerId,
          name: text(customer?.name),
          email: text(customer?.email),
          status: s.status,
          cancelAtPeriodEnd: s.cancel_at_period_end === true,
          cancelAt: timestamp(s.cancel_at),
          trialEnd: timestamp(s.trial_end),
          collectionPaused: Boolean(s.pause_collection),
          createdAt: timestamp(s.created),
          // Only prices and quantities, never payment methods, addresses, metadata,
          // invoice objects, or the raw customer/subscription response.
          prices: (s.items?.data || []).map((item) => ({
            id: text(item.price?.id),
            amount: Number.isSafeInteger(item.price?.unit_amount) ? item.price.unit_amount : null,
            currency: text(item.price?.currency),
            interval: text(item.price?.recurring?.interval),
            intervalCount: item.price?.recurring?.interval_count || 1,
            quantity: item.quantity ?? null,
            periodEnd: timestamp(item.current_period_end),
          })),
          morePrices: s.items?.has_more === true,
          workspaces: linked.map((b) => {
            const space = workspaces.find((w) => w.id === b.workspace_id);
            const profile = profiles.find((p) => p.workspace_id === b.workspace_id);
            return {
              id: b.workspace_id,
              name: text(space?.business_name || space?.name),
              tier: text(profile?.tier),
              billingState: text(profile?.billing_state),
              syncedAt: text(profile?.updated_at),
            };
          }),
          subscriptionUrl: `${base}/subscriptions/${s.id}`,
          customerUrl: ID.test(customerId) ? `${base}/customers/${customerId}` : null,
        };
      });
      return sendJson(res, 200, {
        ok: true,
        fetchedAt: new Date().toISOString(),
        mode,
        subscriptions,
        nextCursor: page.has_more ? page.data.at(-1).id : null,
        billingUrl: `${base}/subscriptions`,
        paymentsUrl: `${base}/payments`,
        readiness: readReadiness(),
      });
    } catch {
      // Never echo provider errors: these can contain credentials/customer data.
      return sendJson(res, 503, {
        ok: false,
        message: 'Customer data could not be verified. Refresh to try again; no accounts or payments were changed.',
      });
    }
  };
}

export default createOwnerHandler();

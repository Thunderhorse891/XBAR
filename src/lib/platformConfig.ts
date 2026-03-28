import type { SubscriptionTier } from '../types/xbar.js';

const env = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;

function readEnv(value: string | undefined) {
  return value?.trim() ?? '';
}

export const supabaseConfig = {
  url: readEnv(env.VITE_SUPABASE_URL),
  anonKey: readEnv(env.VITE_SUPABASE_ANON_KEY),
  workspaceTable: readEnv(env.VITE_SUPABASE_WORKSPACE_TABLE) || 'workspace_snapshots',
  mediaBucket: readEnv(env.VITE_SUPABASE_MEDIA_BUCKET) || 'horse-media',
  documentBucket: readEnv(env.VITE_SUPABASE_DOCUMENT_BUCKET) || 'horse-documents',
};

export const facebookConfig = {
  appId: readEnv(env.VITE_FACEBOOK_APP_ID),
  publicAppUrl: readEnv(env.VITE_PUBLIC_APP_URL),
};

export const stripeConfig = {
  paymentLinks: {
    Starter: readEnv(env.VITE_STRIPE_PAYMENT_LINK_STARTER),
    Professional: readEnv(env.VITE_STRIPE_PAYMENT_LINK_PROFESSIONAL),
    'Ranch Ops': readEnv(env.VITE_STRIPE_PAYMENT_LINK_RANCH_OPS),
    Enterprise: readEnv(env.VITE_STRIPE_PAYMENT_LINK_ENTERPRISE),
  } satisfies Record<SubscriptionTier, string>,
  billingPortalUrl: readEnv(env.VITE_STRIPE_BILLING_PORTAL_URL),
};

export function isSupabaseConfigured() {
  return Boolean(supabaseConfig.url && supabaseConfig.anonKey);
}

export function isBillingConfigured() {
  return Object.values(stripeConfig.paymentLinks).some(Boolean);
}

export function isFacebookSharingConfigured() {
  return Boolean(facebookConfig.appId);
}

export function getStripePaymentLink(tier: SubscriptionTier) {
  return stripeConfig.paymentLinks[tier];
}

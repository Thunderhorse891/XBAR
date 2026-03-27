import type { SubscriptionTier } from '@/types/xbar';

function readEnv(value: string | undefined) {
  return value?.trim() ?? '';
}

export const supabaseConfig = {
  url: readEnv(import.meta.env.VITE_SUPABASE_URL),
  anonKey: readEnv(import.meta.env.VITE_SUPABASE_ANON_KEY),
  workspaceTable: readEnv(import.meta.env.VITE_SUPABASE_WORKSPACE_TABLE) || 'workspace_snapshots',
  mediaBucket: readEnv(import.meta.env.VITE_SUPABASE_MEDIA_BUCKET) || 'horse-media',
  documentBucket: readEnv(import.meta.env.VITE_SUPABASE_DOCUMENT_BUCKET) || 'horse-documents',
};

export const stripeConfig = {
  paymentLinks: {
    Starter: readEnv(import.meta.env.VITE_STRIPE_PAYMENT_LINK_STARTER),
    Professional: readEnv(import.meta.env.VITE_STRIPE_PAYMENT_LINK_PROFESSIONAL),
    'Ranch Ops': readEnv(import.meta.env.VITE_STRIPE_PAYMENT_LINK_RANCH_OPS),
    Enterprise: readEnv(import.meta.env.VITE_STRIPE_PAYMENT_LINK_ENTERPRISE),
  } satisfies Record<SubscriptionTier, string>,
  billingPortalUrl: readEnv(import.meta.env.VITE_STRIPE_BILLING_PORTAL_URL),
};

export function isSupabaseConfigured() {
  return Boolean(supabaseConfig.url && supabaseConfig.anonKey);
}

export function isBillingConfigured() {
  return Object.values(stripeConfig.paymentLinks).some(Boolean);
}

export function getStripePaymentLink(tier: SubscriptionTier) {
  return stripeConfig.paymentLinks[tier];
}


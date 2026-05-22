import type { SubscriptionTier } from '../types/xbar.js';

const env = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;
const isE2eMode = env.MODE === 'e2e';

function readEnv(value: string | undefined) {
  return value?.trim() ?? '';
}

function readFlag(value: string | undefined, defaultValue: boolean) {
  const normalized = readEnv(value).toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

const relationalSyncEnv = env.VITE_SUPABASE_RELATIONAL_SYNC ?? env.VITE_SUPABASE_RELATIONAL_MIRROR;

export const supabaseConfig = {
  url: isE2eMode ? '' : readEnv(env.VITE_SUPABASE_URL),
  anonKey: isE2eMode ? '' : readEnv(env.VITE_SUPABASE_ANON_KEY),
  workspaceTable: readEnv(env.VITE_SUPABASE_WORKSPACE_TABLE) || 'workspace_snapshots',
  mediaBucket: readEnv(env.VITE_SUPABASE_MEDIA_BUCKET) || 'horse-media',
  documentBucket: readEnv(env.VITE_SUPABASE_DOCUMENT_BUCKET) || 'horse-documents',
  relationalSyncEnabled: readFlag(relationalSyncEnv, true),
  snapshotFallbackEnabled: readFlag(env.VITE_SUPABASE_SNAPSHOT_FALLBACK, true),
};

export const authConfig = {
  allowLocalMode: isE2eMode || readFlag(env.VITE_ALLOW_LOCAL_MODE, Boolean(env.DEV)),
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

export const apiConfig = {
  baseUrl: readEnv(env.VITE_API_BASE_URL),
};

export const monitoringConfig = {
  enabled: readFlag(env.VITE_RUNTIME_MONITORING_ENABLED, true),
};

export function isStaticPreviewHost() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.location.hostname.endsWith('github.io');
}

export function isSupabaseConfigured() {
  return Boolean(supabaseConfig.url && supabaseConfig.anonKey);
}

export function isLocalModeEnabled() {
  return authConfig.allowLocalMode || isStaticPreviewHost();
}

export function isCloudAuthRequired() {
  return !isSupabaseConfigured() && !isLocalModeEnabled();
}

export function isRelationalCloudEnabled() {
  return isSupabaseConfigured() && supabaseConfig.relationalSyncEnabled;
}

export function isRelationalCloudMirrorEnabled() {
  return isRelationalCloudEnabled();
}

export function isSnapshotFallbackEnabled() {
  return isSupabaseConfigured() && supabaseConfig.snapshotFallbackEnabled;
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

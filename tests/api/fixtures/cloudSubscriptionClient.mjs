let client = null;
export function setCloudSubscriptionClient(value) {
  client = value;
}
export function getSupabaseClient() {
  return client;
}
export function authStorageKey() {
  return 'synthetic-owner-entitlement-session';
}

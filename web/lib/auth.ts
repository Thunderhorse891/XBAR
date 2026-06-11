import type { Tier } from './types';

// Demo auth: a signed-in session is represented by cookies that the
// middleware checks. Swapping in a real auth provider only requires
// replacing these helpers and the middleware token check.

export const TOKEN_COOKIE = 'xbar_token';
export const TIER_COOKIE = 'xbar_tier';
export const ONBOARDED_COOKIE = 'xbar_onboarded';

function setCookie(name: string, value: string, days = 30) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${days * 86400}; samesite=lax`;
}

function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : '';
}

export function signIn(email: string, tier: Tier) {
  setCookie(TOKEN_COOKIE, `demo-jwt.${btoa(email)}.${Date.now()}`);
  setCookie(TIER_COOKIE, tier);
}

export function signOut() {
  for (const name of [TOKEN_COOKIE, TIER_COOKIE, ONBOARDED_COOKIE]) {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
}

export function markOnboarded() {
  setCookie(ONBOARDED_COOKIE, '1', 365);
}

export function getToken(): string {
  return getCookie(TOKEN_COOKIE);
}

export function getTier(): Tier {
  const tier = getCookie(TIER_COOKIE);
  return tier === 'pro' || tier === 'business' ? tier : 'basic';
}

export function isOnboarded(): boolean {
  return getCookie(ONBOARDED_COOKIE) === '1';
}

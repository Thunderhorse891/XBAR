import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard', '/horses', '/documents', '/calendar', '/settings', '/barn', '/onboarding'];
const BUSINESS_ONLY_PREFIXES = ['/barn'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isProtected) return NextResponse.next();

  const token = request.cookies.get('xbar_token')?.value;
  if (!token) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  // Subscription-tier route protection: barn management is Business only.
  const tier = request.cookies.get('xbar_tier')?.value ?? 'basic';
  if (BUSINESS_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && tier !== 'business') {
    const billing = new URL('/settings/billing', request.url);
    billing.searchParams.set('upgrade', 'business');
    billing.searchParams.set('reason', 'barn-settings');
    return NextResponse.redirect(billing);
  }

  // First sign-in goes through onboarding (skippable inside the wizard).
  const onboarded = request.cookies.get('xbar_onboarded')?.value === '1';
  if (!onboarded && !pathname.startsWith('/onboarding')) {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }
  if (onboarded && pathname.startsWith('/onboarding')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};

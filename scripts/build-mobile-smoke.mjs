// Build the native (store) bundle for the mobile smoke suite.
//
// Same flags as scripts/build-mobile.mjs — hash router, no marketing post-build,
// VITE_NATIVE_APP=true — in one of two shapes, because the two things this suite
// proves need opposite Supabase configuration and a bundle is built once:
//
//   (default)  Supabase NOT configured + local mode. A workspace can be created
//              without a session, so the billing screen is reachable and the
//              purchase gate can be asserted on the real bundle.
//
//   --auth     Supabase configured. The third-party sign-in row would render
//              here on web, so its absence proves the native gate rather than
//              proving Supabase is merely unconfigured — which is what a
//              single local-mode build would have "proved" vacuously.
//
// Neither set of credentials is ever contacted; the suite only inspects what
// the store build renders.

import { spawn } from 'node:child_process';
import { SITE_ORIGIN } from './marketing/render.mjs';

const authMode = process.argv.includes('--auth');

const env = {
  ...process.env,
  XBAR_SKIP_MARKETING: '1',
  VITE_ROUTER_MODE: 'hash',
  VITE_STATIC_TARGET: 'web',
  VITE_NATIVE_APP: 'true',
  // Same defaults the real mobile build applies, so the smoke suite asserts
  // against the origins a release build would actually ship. Two of them: the
  // SPA lives at /app and the marketing pages at the site root, and pointing
  // in-app links at the root sends every shared buyer link to the marketing
  // homepage.
  VITE_PUBLIC_SITE_URL: SITE_ORIGIN,
  VITE_PUBLIC_APP_URL: `${SITE_ORIGIN}/app`,
  ...(authMode
    ? {
        VITE_SUPABASE_URL: 'https://mobile-smoke.invalid',
        VITE_SUPABASE_ANON_KEY: 'mobile-smoke-anon-key',
        VITE_MANAGED_BILLING_ENABLED: 'true',
      }
    : {
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_ANON_KEY: '',
        VITE_ALLOW_LOCAL_MODE: 'true',
        // Payment links stand in for configured checkout without Supabase, so the
        // billing screen would offer a real purchase button on web.
        VITE_STRIPE_PAYMENT_LINK_STARTER: 'https://buy.stripe.com/test_starter',
        VITE_STRIPE_PAYMENT_LINK_PROFESSIONAL: 'https://buy.stripe.com/test_professional',
        VITE_STRIPE_PAYMENT_LINK_RANCH_OPS: 'https://buy.stripe.com/test_ranch_ops',
        VITE_STRIPE_PAYMENT_LINK_ENTERPRISE: 'https://buy.stripe.com/test_enterprise',
      }),
};

console.log(`[mobile-smoke] building store bundle (${authMode ? 'supabase configured' : 'local mode'})`);

const child = spawn('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

// Build the web bundle used by the held-workspace suite.
//
// Identical to build-auth-smoke.mjs except for the two things that suite
// cannot express: relational sync is ON -- the production default, and the
// reason `status` waits on PostgREST queries against `workspaces` -- and the
// port differs so the two bundles never serve each other's dist.
//
// build-auth-smoke pins relational sync OFF on purpose, so no test there ever
// sees the workspace fetch that the reset screen used to wait behind. That is
// why this second bundle exists rather than a flag on the first.

import { spawn } from 'node:child_process';

// Keep in step with playwright.auth.config.ts.
const AUTH_SLOW_PORT = 4179;

const env = {
  ...process.env,
  VITE_STATIC_TARGET: 'web',
  VITE_ROUTER_MODE: 'browser',
  VITE_RUNTIME_MONITORING_ENABLED: 'false',
  VITE_SUPABASE_URL: `http://127.0.0.1:${AUTH_SLOW_PORT}`,
  VITE_SUPABASE_ANON_KEY: 'auth-smoke-anon-key',
  /*
   * ON here, and that is the whole point of this bundle.
   *
   * With it on, every session change loads a workspace profile over the
   * network before the store publishes `status: 'signed-in'` -- which is the
   * production default and the condition the reset screen used to wait behind.
   * The tests hold those requests open to reproduce a slow or unavailable
   * workspace API while GoTrue stays healthy.
   */
  VITE_SUPABASE_RELATIONAL_SYNC: 'true',
  // No local-mode escape hatch: the point is the Supabase-backed path. Spelled
  // 'false' rather than '' for the same reason -- empty means "use the
  // default", not "off".
  VITE_ALLOW_LOCAL_MODE: 'false',
  // Providers are covered by tests/authProviders.test.ts and the store suite;
  // pinning it empty keeps the sign-in screen deterministic here.
  VITE_AUTH_OAUTH_PROVIDERS: '',
  /*
   * Pinned, not inherited. `env` starts from process.env, so a VITE_NATIVE_APP
   * or XBAR_SKIP_MARKETING left over in the shell -- from a mobile build, say --
   * would quietly turn this into a native bundle, or skip the post-build that
   * produces dist/app.html and leave every /app route 404ing. Neither failure
   * announces itself as a wrong build target.
   */
  VITE_NATIVE_APP: 'false',
  XBAR_SKIP_MARKETING: '',
};

// The post-build (not skipped, see above) is what splits the SPA shell out to
// dist/app.html, which scripts/serve-dist.mjs serves /app/* from.

console.log('[auth-slow] building web bundle (supabase + relational sync configured)');

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

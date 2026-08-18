import { defineConfig } from '@playwright/test';

// Runs the NATIVE (store) bundle — the exact artifact `npx cap sync` copies into
// the iOS/Android project — and asserts the things App Review rejects for:
// a non-IAP purchase path, and links that cannot resolve inside a WebView.
//
// The web suites cannot cover this: the difference is a build-time flag, so the
// only way to prove the store build behaves differently is to build it and load
// it. `scripts/build-mobile-smoke.mjs` produces that bundle before this config
// runs; the webServer only serves the already-built dist.
export default defineConfig({
  testDir: './tests/mobile-smoke',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? 'github' : 'line',
  use: {
    // The native shell loads the SPA shell directly at the root with the hash
    // router, so there is no server-side routing to mirror here.
    baseURL: 'http://127.0.0.1:4176',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.XBAR_CHROME ? { launchOptions: { executablePath: process.env.XBAR_CHROME } } : {}),
  },
  webServer: {
    command: 'node ./node_modules/vite/bin/vite.js preview --port 4176 --strictPort',
    url: 'http://127.0.0.1:4176',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

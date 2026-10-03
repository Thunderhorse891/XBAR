import { defineConfig } from '@playwright/test';

// Reuse CI's initial GitHub-Pages build before prod-smoke replaces dist.
// The spec serves only those built files through an isolated request fixture.
export default defineConfig({
  testDir: './tests/github-pages-smoke',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'line',
  use: {
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.XBAR_CHROME ? { launchOptions: { executablePath: process.env.XBAR_CHROME } } : {}),
  },
});

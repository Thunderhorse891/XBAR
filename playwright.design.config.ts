import { defineConfig } from '@playwright/test';

// CI copies this capture driver to the PR's exact base revision. It provides
// real before images without rebuilding an older interface from memory.
export default defineConfig({
  testDir: './tests/design-review',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: process.env.CI ? 'github' : 'line',
  use: { baseURL: 'http://127.0.0.1:4175', reducedMotion: 'reduce' },
  webServer: {
    command: 'node scripts/serve-dist.mjs --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

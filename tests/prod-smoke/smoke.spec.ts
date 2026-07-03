import { expect, test, type Page } from '@playwright/test';

/**
 * Production smoke test — runs against the built `dist` output served by
 * `vite preview` (see playwright.prod.config.ts). Its job is to catch
 * production-only failures the dev-server e2e suite cannot see, most
 * importantly:
 *   - React failing to mount (blank white screen), e.g. from a bad Rollup
 *     chunk split of react / react-dom.
 *   - Missing/renamed production JS/CSS chunks returning 404.
 *   - Broken /brand/ image references (verified via HTTP requests).
 * These checks are configuration-independent, so they hold regardless of
 * whether Supabase/Stripe env is present.
 *
 * Note: brand images are validated with request.get() rather than by waiting
 * for the browser to decode them, so the suite is robust in restricted
 * sandboxes where the browser cannot fetch large local sub-resources while
 * still catching genuine 404 / missing-asset regressions in real CI.
 */

// Runtime errors that indicate a broken production bundle. Never whitelisted.
const CRITICAL_ERROR = /__SECRET_INTERNALS|Cannot read (?:property|properties)|is not a function|is not defined|Minified React error|ChunkLoadError|Loading chunk \S+ failed|Failed to fetch dynamically imported module|SyntaxError|Unexpected (?:token|identifier)|Rendered fewer hooks|Maximum update depth/i;

type Collected = { pageErrors: string[]; criticalConsole: string[]; chunkFailures: string[] };

function collect(page: Page): Collected {
  const c: Collected = { pageErrors: [], criticalConsole: [], chunkFailures: [] };
  page.on('pageerror', (err) => c.pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CRITICAL_ERROR.test(text)) c.criticalConsole.push(text);
  });
  // A 4xx/5xx on an application JS/CSS chunk is the classic blank-screen cause.
  page.on('response', (res) => {
    if (/\/assets\/.+\.(js|css|mjs)(\?|$)/.test(res.url()) && res.status() >= 400) {
      c.chunkFailures.push(`${res.status()} ${res.url()}`);
    }
  });
  return c;
}

function assertClean(c: Collected) {
  expect(c.pageErrors, `uncaught page errors:\n${c.pageErrors.join('\n')}`).toEqual([]);
  expect(c.criticalConsole, `critical console errors:\n${c.criticalConsole.join('\n')}`).toEqual([]);
  expect(c.chunkFailures, `production JS/CSS chunk failures:\n${c.chunkFailures.join('\n')}`).toEqual([]);
}

test('production build boots and React mounts (no blank screen)', async ({ page }) => {
  const c = collect(page);
  await page.goto('/', { waitUntil: 'load' });
  // React must have mounted actual content into #root. A fresh local-first
  // visit lands on the sign-in screen; waiting on the heading auto-retries
  // through the '/' -> '/login' redirect without an execution-context race.
  await expect(page.locator('#root')).toBeAttached();
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible({ timeout: 15_000 });
  const rootChildren = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0);
  expect(rootChildren, 'React did not render into #root (blank screen)').toBeGreaterThan(0);
  assertClean(c);
});

test('local workspace setup is reachable without cloud sign-in', async ({ page }) => {
  const c = collect(page);
  await page.goto('/login', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/setup/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Configure Workspace' })).toBeVisible({ timeout: 15_000 });
  const rootChildren = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0);
  expect(rootChildren, 'workspace setup rendered blank').toBeGreaterThan(0);
  assertClean(c);
});

test('critical brand assets return 200 with non-empty body', async ({ request }) => {
  const assets = [
    '/brand/icon-512.png',
    '/brand/icon-192.png',
    '/brand/apple-touch-icon.png',
    '/brand/xbar-favicon.png',
    '/brand/xbar-wordmark.png',
    '/brand/xbar-horse-outline-safe.png',
    '/brand/xbar-x-watermark-main.png',
    '/brand/xbar-app-icon.png',
  ];
  for (const asset of assets) {
    const res = await request.get(asset);
    expect(res.status(), `${asset} status`).toBe(200);
    const body = await res.body();
    expect(body.byteLength, `${asset} body size`).toBeGreaterThan(0);
  }
});

test('every /brand/ image referenced on login & dashboard resolves (no 404)', async ({ page, request }) => {
  const seen = new Set<string>();
  for (const path of ['/login', '/']) {
    await page.goto(path, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const srcs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .map((img) => img.getAttribute('src') || '')
        .filter((s) => s.includes('/brand/')),
    );
    srcs.forEach((s) => seen.add(s));
  }
  expect(seen.size, 'expected at least one /brand/ image reference').toBeGreaterThan(0);
  for (const src of seen) {
    const res = await request.get(src);
    expect(res.status(), `${src} status`).toBe(200);
    const body = await res.body();
    expect(body.byteLength, `${src} body size`).toBeGreaterThan(0);
  }
});

test('legacy routes redirect to canonical product routes', async ({ page }) => {
  // Complete local-first onboarding so the app shell (where legacy redirects
  // live) is reachable.
  await page.goto('/login', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/setup/, { timeout: 15_000 });
  await page.getByLabel('Business name').fill('XBAR LLC');
  await page.getByLabel('Ranch name').fill('Primary Ranch');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL((url) => !url.pathname.includes('/setup'), { timeout: 20_000 });

  const redirects: Array<[string, string]> = [
    ['/animals', '/horses'],
    ['/documents-vault', '/documents'],
    ['/document-library', '/documents'],
    ['/sales-pipeline', '/sales'],
    ['/buyer-deal-room', '/buyers'],
    ['/buyer-follow-up', '/buyers'],
    ['/sale-packet-studio', '/sale-packets'],
    ['/plans', '/billing'],
    ['/subscriptions', '/billing'],
  ];
  for (const [legacy, canonical] of redirects) {
    // Navigate client-side (pushState + popstate drives React Router) so the
    // walk exercises the <Navigate> redirects without nine full reloads and
    // IndexedDB rehydrations, which are flaky in constrained environments.
    await page.evaluate((path) => {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, legacy);
    await page.waitForURL((url) => url.pathname === canonical, { timeout: 15_000 });
  }
});

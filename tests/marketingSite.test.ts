import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { subscriptionTierConfig } from '../src/lib/xbarRuntime.js';

// The marketing modules are plain .mjs (they run inside the build, not the
// bundler). Import them via file URLs so this compiled test can load them
// from the repo root regardless of the tsc output directory.
const repoRoot = process.cwd();
const load = (relPath: string) => import(pathToFileURL(path.join(repoRoot, relPath)).href);

type MarketingPlan = {
  tier: string;
  monthlyRate: number;
  fit: string;
  features: string[];
  limits: Record<string, number>;
};

type MarketingPage = {
  path: string;
  title: string;
  description: string;
  body: string;
  noindex?: boolean;
};

test('published pricing exactly matches the tier configuration the app enforces', async () => {
  const { marketingPlans } = (await load('scripts/marketing/pricing-data.mjs')) as {
    marketingPlans: MarketingPlan[];
  };

  const tiers = Object.keys(subscriptionTierConfig);
  assert.deepEqual(
    marketingPlans.map((plan) => plan.tier),
    tiers,
    'marketing must publish every tier, in the same order',
  );

  for (const plan of marketingPlans) {
    const config = subscriptionTierConfig[plan.tier as keyof typeof subscriptionTierConfig];
    assert.ok(config, `unknown marketing tier ${plan.tier}`);
    assert.equal(plan.monthlyRate, config.monthlyRate, `${plan.tier} price drifted from the app`);
    assert.deepEqual(plan.features, config.featureFlags, `${plan.tier} feature list drifted from the app`);
    assert.deepEqual(plan.limits, config.limits, `${plan.tier} limits drifted from the app`);
  }
});

test('every public page has unique metadata and complete static content', async () => {
  const { marketingPages, notFoundPage } = (await load('scripts/marketing/pages.mjs')) as {
    marketingPages: MarketingPage[];
    notFoundPage: MarketingPage;
  };
  const { renderPage } = (await load('scripts/marketing/render.mjs')) as {
    renderPage: (page: MarketingPage) => string;
  };

  const titles = new Set<string>();
  const descriptions = new Set<string>();
  const paths = new Set<string>();

  for (const page of marketingPages) {
    assert.ok(page.title.length >= 20 && page.title.length <= 120, `${page.path}: title length out of range`);
    assert.ok(
      page.description.length >= 70 && page.description.length <= 320,
      `${page.path}: description length out of range (${page.description.length})`,
    );
    assert.ok(!titles.has(page.title), `duplicate title: ${page.title}`);
    assert.ok(!descriptions.has(page.description), `duplicate description on ${page.path}`);
    assert.ok(!paths.has(page.path), `duplicate path: ${page.path}`);
    titles.add(page.title);
    descriptions.add(page.description);
    paths.add(page.path);

    const html = renderPage(page);
    const canonical = `https://xbar.app${page.path === '/' ? '/' : page.path}`;
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}" />`), `${page.path}: missing self-canonical`);
    assert.ok(html.includes('"index, follow'), `${page.path}: public page must be indexable`);
    assert.ok(!html.includes('/assets/'), `${page.path}: marketing page must not load the application bundle`);
    assert.ok(html.length > 4000, `${page.path}: page should carry substantial crawlable content`);
    // View-source completeness: the body copy is in the HTML itself.
    assert.ok(html.includes('<main id="main">'), `${page.path}: missing main landmark`);
  }

  const notFound = renderPage(notFoundPage);
  assert.ok(notFound.includes('noindex'), '404 page must be noindex');
});

test('sitemap policy: only canonical indexable pages, never login or app routes', async () => {
  const { marketingPages } = (await load('scripts/marketing/pages.mjs')) as { marketingPages: MarketingPage[] };
  const sitemapPaths = marketingPages.filter((page) => !page.noindex).map((page) => page.path);

  assert.ok(sitemapPaths.includes('/'), 'homepage must be in the sitemap set');
  assert.ok(sitemapPaths.includes('/pricing'), 'pricing must be in the sitemap set');
  for (const p of sitemapPaths) {
    assert.ok(!p.startsWith('/app'), `sitemap must not contain app routes (${p})`);
    assert.ok(!p.includes('login'), `sitemap must not contain login (${p})`);
    assert.ok(!p.startsWith('/profiles'), `sitemap must not contain share links (${p})`);
  }
});

test('marketing claims stay within evidence: no fabricated social proof', async () => {
  const { marketingPages } = (await load('scripts/marketing/pages.mjs')) as { marketingPages: MarketingPage[] };
  // Phrases that would imply customer evidence this repository does not have.
  const forbidden = /trusted by [\d,]+|customers? (say|love)|testimonial|5-star|award-winning|#1 rated/i;
  for (const page of marketingPages) {
    assert.doesNotMatch(page.body, forbidden, `${page.path}: unverifiable social-proof claim`);
  }
});

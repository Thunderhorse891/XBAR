import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { subscriptionTierConfig } from '../src/lib/xbarRuntime.js';

// The marketing modules are plain .mjs (they run inside the build, not the
// bundler). Import them via file URLs so this compiled test can load them
// from the repo root regardless of the tsc output directory.
const repoRoot = process.cwd();
const load = (relPath: string) => import(pathToFileURL(path.join(repoRoot, relPath)).href);

type MarketingPlan = {
  tier: string;
  monthlyRate: number;
  annualRate: number;
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
    assert.equal(plan.annualRate, config.annualRate, `${plan.tier} annual price drifted from the app`);
    assert.deepEqual(plan.features, config.featureFlags, `${plan.tier} feature list drifted from the app`);
    assert.deepEqual(plan.limits, config.limits, `${plan.tier} limits drifted from the app`);
  }
});

test('every public page has unique metadata and complete static content', async () => {
  const { marketingPages, notFoundPage } = (await load('scripts/marketing/pages.mjs')) as {
    marketingPages: MarketingPage[];
    notFoundPage: MarketingPage;
  };
  const { renderPage, SITE_ORIGIN } = (await load('scripts/marketing/render.mjs')) as {
    renderPage: (page: MarketingPage) => string;
    SITE_ORIGIN: string;
  };
  assert.match(SITE_ORIGIN, /^https:\/\//, 'SITE_ORIGIN must be an https origin');
  assert.ok(!SITE_ORIGIN.endsWith('/'), 'SITE_ORIGIN must not end with a slash');

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
    const canonical = `${SITE_ORIGIN}${page.path === '/' ? '/' : page.path}`;
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}" />`), `${page.path}: missing self-canonical`);
    assert.ok(html.includes('"index, follow'), `${page.path}: public page must be indexable`);
    assert.ok(!html.includes('/assets/'), `${page.path}: marketing page must not load the application bundle`);
    assert.ok(
      html.includes('<script defer src="/site.js"></script>'),
      `${page.path}: missing the first-party analytics beacon`,
    );
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

// Legal and not-found pages share the same public shell, even though they are
// assembled separately from marketingPages during the production build.
async function allPublicPages(): Promise<MarketingPage[]> {
  const { marketingPages, legalPage, notFoundPage } = await load('scripts/marketing/pages.mjs');
  const { getLegalDocument } = await import('../src/lib/legalDocuments.js');
  return [
    ...marketingPages,
    legalPage(getLegalDocument('terms'), '/terms'),
    legalPage(getLegalDocument('privacy'), '/privacy'),
    notFoundPage,
  ];
}

test('every public page shares the homepage brand foundation while cinematic motion stays homepage-only', async () => {
  const { renderPage } = await load('scripts/marketing/render.mjs');
  for (const page of await allPublicPages()) {
    const html = renderPage(page);
    const bodyClasses = html.match(/<body[^>]*class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    assert.ok(bodyClasses.includes('marketing-page'), `${page.path}: missing the shared public brand scope`);
    assert.equal(bodyClasses.includes('landing-page'), page.path === '/', `${page.path}: homepage scope leaked`);
    for (const stylesheet of ['/brand/xbar-brand-tokens.css', '/site.css']) {
      assert.equal(
        html.split(`href="${stylesheet}"`).length - 1,
        1,
        `${page.path}: must load ${stylesheet} exactly once`,
      );
    }
    assert.ok(
      html.indexOf('href="/brand/xbar-brand-tokens.css"') < html.indexOf('href="/site.css"'),
      `${page.path}: canonical brand tokens must precede shared site styles`,
    );
    assert.match(html, /fonts\.googleapis\.com[^"<>]*family=Outfit/, `${page.path}: missing Outfit font`);
    assert.doesNotMatch(html, /Fraunces|class="bg-fx/, `${page.path}: retired public identity returned`);
    if (page.path === '/') {
      assert.match(html, /href="\/landing\.css"/);
      assert.match(html, /<script type="module" src="\/landing\/motion[^"<>]*\.js"><\/script>/);
    } else {
      assert.doesNotMatch(html, /href="\/landing\.css"|src="\/landing\//);
    }
    assert.ok(html.includes(page.body), `${page.path}: the complete body must be present without JavaScript`);
    assert.match(html, /<main id="main">/);
    assert.match(html, /<a class="skip-link" href="#main">Skip to content<\/a>/);
  }
});

test('marketing, legal, and 404 pages share the same native mobile navigation and static actions', async () => {
  const { renderPage } = await load('scripts/marketing/render.mjs');
  const expectedLinks = [
    '/features',
    '/pricing',
    'mailto:xbarje@gmail.com',
    '/solutions',
    '/resources',
    '/demo',
    '/app/login',
    '/app/login?mode=signup',
  ];
  for (const page of await allPublicPages()) {
    const html = renderPage(page);
    const menus = [...html.matchAll(/<details class="landing-mobile-nav">([\s\S]*?)<\/details>/g)];
    assert.equal(menus.length, 1, `${page.path}: exactly one native mobile menu must be rendered`);
    const menu = menus[0][1];
    assert.match(menu, /<summary>Menu /, `${page.path}: native keyboard-accessible menu toggle missing`);
    assert.match(menu, /<nav aria-label="Mobile primary">/);
    assert.deepEqual(
      [...menu.matchAll(/<a[^>]*href="([^"]+)"/g)].map((match) => match[1]),
      expectedLinks,
      `${page.path}: mobile navigation must expose the same public and account destinations`,
    );
    assert.doesNotMatch(menu, /onclick=|href="(?:#|javascript:)/i, `${page.path}: menu must work without scripts`);
    assert.match(
      html,
      /<header[\s\S]*?<svg[^>]*data-xbar-signature/,
      `${page.path}: header needs the recognizable horse signature`,
    );
    assert.match(
      html,
      /<footer[\s\S]*?<svg[^>]*data-xbar-signature/,
      `${page.path}: footer needs the same horse signature`,
    );
  }
});

test('shared public styles derive the white, black, and steel identity from canonical brand tokens', async () => {
  const css = (await readFile('scripts/marketing/site.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  const aliases: Record<string, string> = {
    '--bg': '--xbar-white',
    '--ink': '--xbar-black',
    '--ink-soft': '--xbar-steel',
    '--ink-faint': '--xbar-steel',
    '--accent': '--xbar-gunmetal',
    '--font-display': '--font-ui',
  };
  for (const [role, token] of Object.entries(aliases)) {
    assert.match(css, new RegExp(`${role}:\\s*var\\(${token}\\)`), `${role} must use ${token}`);
  }
  assert.match(css, /--font-ui:\s*'Outfit'/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(\s*\d/gi, 'public color declarations must use brand tokens');
  assert.doesNotMatch(css, /Fraunces|--gold(?:-soft)?\b|\.bg-fx|aurora-drift/i);
  assert.doesNotMatch(css, /--surface(?:-strong)?:\s*linear-gradient|--hairline(?:-hot)?:\s*linear-gradient/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  const landingCss = (await readFile('scripts/marketing/landing.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(
    landingCss,
    /--(?:bg|ink|ink-soft|ink-faint|accent|font-ui|font-display):/,
    'the homepage must inherit the public foundation instead of maintaining a second palette',
  );
});

test('the homepage retains approved artwork, accurate prices, and static signup and sample actions', async () => {
  const { marketingPages } = (await load('scripts/marketing/pages.mjs')) as { marketingPages: MarketingPage[] };
  const { marketingPlans } = (await load('scripts/marketing/pricing-data.mjs')) as { marketingPlans: MarketingPlan[] };
  const { renderPage } = await load('scripts/marketing/render.mjs');
  const home = marketingPages.find((page) => page.path === '/');
  assert.ok(home, 'homepage must exist');
  const html = renderPage(home);
  assert.match(html, /href="\/app\/login\?mode=signup"/);
  assert.match(html, /href="\/samples\/sample-sale-packet.html"/);
  assert.match(html, /\/brand\/xbar-report-horse.png/);
  assert.match(html, /\/brand\/xbar-original-icon-512.png/);
  assert.match(html, /example data/);
  for (const plan of marketingPlans) {
    assert.ok(html.includes(`$${plan.monthlyRate}<span>/month</span>`), `${plan.tier} price must remain accurate`);
  }
  const counter = html.match(/data-landing-count="(\d+)"/);
  const stages = home.body.match(/class="landing-stage-index"/g) ?? [];
  assert.equal(
    Number(counter?.[1]),
    stages.length,
    'counter describes the rendered workflow, not invented usage stats',
  );
});

test('public launch pricing publishes monthly billing without unavailable annual offers', async () => {
  const { marketingPages } = (await load('scripts/marketing/pages.mjs')) as { marketingPages: MarketingPage[] };
  const pricing = marketingPages.find((page) => page.path === '/pricing')!;
  assert.match(pricing.body, /Monthly billing is available/);
  assert.match(pricing.body, /Annual billing is not currently offered/);
  assert.doesNotMatch(pricing.body, /Annual price|2 months free/);
  assert.doesNotMatch(pricing.body, /before cloud sync is configured|before enabling cloud services/);
});

test('the ungated tour distinguishes example screens from account signup', async () => {
  const { marketingPages } = (await load('scripts/marketing/pages.mjs')) as { marketingPages: MarketingPage[] };
  const demo = marketingPages.find((page) => page.path === '/demo')!;
  assert.match(demo.body, /No account is needed to view this tour/);
  assert.match(demo.body, /create an XBAR account/);
  assert.match(demo.body, /href="\/app\/login\?mode=signup"[^>]*>Create an account/);
  assert.doesNotMatch(
    demo.body,
    /requires no cloud account|no cloud account required|Open a local-first workspace|One click, runs in your browser/,
  );
});

test('every public page exposes the approved support contact in navigation and footer', async () => {
  const { marketingPages } = (await load('scripts/marketing/pages.mjs')) as { marketingPages: MarketingPage[] };
  const { renderPage, SUPPORT_EMAIL } = await load('scripts/marketing/render.mjs');
  const { SUPPORT_CONTACT } = await import('../src/lib/legalDocuments.js');
  assert.equal(
    SUPPORT_EMAIL.toLowerCase(),
    SUPPORT_CONTACT.email.toLowerCase(),
    'support contact must match legal documents',
  );
  for (const page of marketingPages) {
    const html = renderPage(page);
    assert.match(html, /<header[\s\S]*?href="mailto:xbarje@gmail.com"[^>]*>Help &amp; support/);
    assert.match(html, /<footer[\s\S]*?href="mailto:xbarje@gmail.com"/);
  }
});

test('public legal pages retain review notices and cross-link the existing policies', async () => {
  const { legalPage } = await load('scripts/marketing/pages.mjs');
  const { getLegalDocument } = await import('../src/lib/legalDocuments.js');
  for (const id of ['terms', 'privacy'] as const) {
    const doc = getLegalDocument(id);
    const page = legalPage(doc, `/${id}`);
    assert.ok(page.body.includes(doc.notice), 'review status must not disappear in presentation cleanup');
    assert.match(page.body, /href="\/terms"/);
    assert.match(page.body, /href="\/privacy"/);
  }
});

type MotionHarnessOptions = {
  reduced?: boolean;
  saveData?: boolean;
  legacyMediaListener?: boolean;
  observerSupported?: boolean;
  animationSupported?: boolean;
};

type HarnessEvent = { target?: unknown };
type HarnessListener = (event: HarnessEvent) => void;

// This executes the real shared site script against only the DOM/animation
// boundary it consumes. It proves lifecycle behavior without launching a browser.
function publicMotionHarness(script: string, options: MotionHarnessOptions = {}) {
  const documentListeners = new Map<string, HarnessListener>();
  const windowListeners = new Map<string, HarnessListener>();
  const mediaListeners = new Map<string, HarnessListener>();
  const connectionListeners = new Map<string, HarnessListener>();
  const animations: { cancelled: boolean; onfinish?: () => void; cancel: () => void }[] = [];
  const contentClasses: string[] = [];
  const parentElement = {};
  const targets = Array.from({ length: 2 }, () => {
    const focusTarget = {};
    return {
      dataset: {} as Record<string, string>,
      parentElement,
      focusTarget,
      contains: (target: unknown) => target === focusTarget,
      classList: { add: (name: string) => contentClasses.push(name) },
      animate: () => {
        const animation = {
          cancelled: false,
          cancel() {
            this.cancelled = true;
          },
        };
        animations.push(animation);
        return animation;
      },
    };
  });
  const reduced = {
    matches: options.reduced ?? false,
    ...(options.legacyMediaListener
      ? { addListener: (listener: HarnessListener) => mediaListeners.set('change', listener) }
      : { addEventListener: (name: string, listener: HarnessListener) => mediaListeners.set(name, listener) }),
  };
  const connection = {
    saveData: options.saveData ?? false,
    addEventListener: (name: string, listener: HarnessListener) => connectionListeners.set(name, listener),
  };
  let observe: ((entries: { isIntersecting: boolean; target: (typeof targets)[number] }[]) => void) | undefined;
  class Observer {
    constructor(callback: NonNullable<typeof observe>) {
      observe = callback;
    }
    observe() {}
    unobserve() {}
  }
  const document = {
    hidden: false,
    activeElement: null,
    documentElement: { classList: { add() {} } },
    body: {
      classList: { contains: () => false },
      ...(options.animationSupported === false ? {} : { animate() {} }),
    },
    querySelector: () => null,
    querySelectorAll: (selector: string) =>
      selector.includes('data-landing-image') || selector.includes('nav-dd') ? [] : targets,
    addEventListener: (name: string, listener: HarnessListener) => documentListeners.set(name, listener),
  };
  const navigator = { doNotTrack: '1', connection };
  const window = {
    navigator,
    matchMedia: () => reduced,
    addEventListener: (name: string, listener: HarnessListener) => windowListeners.set(name, listener),
    ...(options.observerSupported === false ? {} : { IntersectionObserver: Observer }),
  };
  runInNewContext(script, { document, window, navigator });
  function dispatch(listeners: Map<string, HarnessListener>, name: string, event: HarnessEvent = {}) {
    const listener = listeners.get(name);
    assert.ok(listener, `${name} must have a lifecycle listener`);
    listener(event);
  }
  return {
    animations,
    contentClasses,
    intersect: () => observe?.(targets.map((target) => ({ isIntersecting: true, target }))),
    reduceMotion: (value: boolean) => {
      reduced.matches = value;
      dispatch(mediaListeners, 'change');
    },
    saveData: () => {
      connection.saveData = true;
      dispatch(connectionListeners, 'change');
    },
    hideDocument: () => {
      document.hidden = true;
      dispatch(documentListeners, 'visibilitychange');
    },
    leavePage: () => dispatch(windowListeners, 'pagehide'),
    focusFirst: () => dispatch(documentListeners, 'focusin', { target: targets[0].focusTarget }),
  };
}

test('shared public reveals cancel for live motion preferences, hidden documents, and page exit', async () => {
  const script = await readFile('scripts/marketing/site.js', 'utf8');
  for (const change of ['reduceMotion', 'saveData', 'hideDocument', 'leavePage'] as const) {
    const harness = publicMotionHarness(script);
    harness.intersect();
    assert.equal(harness.animations.length, 2, `${change}: the real script must start both visible reveals`);
    assert.ok(harness.animations.every((animation) => !animation.cancelled));
    if (change === 'reduceMotion') harness.reduceMotion(true);
    else harness[change]();
    assert.ok(
      harness.animations.every((animation) => animation.cancelled),
      `${change}: running reveals must stop`,
    );
    assert.deepEqual(harness.contentClasses, [], 'static content must not depend on hidden/reveal CSS classes');
    if (change === 'reduceMotion') harness.reduceMotion(false);
    harness.intersect();
    assert.equal(harness.animations.length, 2, `${change}: previously read content must not fade in again`);
  }
});

test('keyboard focus makes an animated public action immediately readable without cancelling unrelated content', async () => {
  const harness = publicMotionHarness(await readFile('scripts/marketing/site.js', 'utf8'));
  harness.intersect();
  assert.equal(harness.animations.length, 2);
  harness.focusFirst();
  assert.equal(harness.animations[0].cancelled, true, 'focused content must stop moving');
  assert.equal(harness.animations[1].cancelled, false, 'unrelated reveal should keep its lifecycle');
});

test('shared public motion honors initial preferences and supports legacy media listeners', async () => {
  const script = await readFile('scripts/marketing/site.js', 'utf8');
  for (const options of [{ reduced: true }, { saveData: true }]) {
    const harness = publicMotionHarness(script, options);
    harness.intersect();
    assert.equal(harness.animations.length, 0, 'preference-disabled content must stay static from first paint');
    assert.deepEqual(harness.contentClasses, []);
  }
  const legacy = publicMotionHarness(script, { legacyMediaListener: true });
  legacy.intersect();
  assert.equal(legacy.animations.length, 2);
  legacy.reduceMotion(true);
  assert.ok(legacy.animations.every((animation) => animation.cancelled));
});

test('missing observer or animation support preserves static public content', async () => {
  const script = await readFile('scripts/marketing/site.js', 'utf8');
  for (const options of [{ observerSupported: false }, { animationSupported: false }]) {
    const harness = publicMotionHarness(script, options);
    harness.intersect();
    assert.equal(harness.animations.length, 0);
    assert.deepEqual(harness.contentClasses, [], 'fallback content must never acquire a hidden class');
  }
});

test('all public routes show the complete original B artwork without traced substitutions', async () => {
  const { renderPage } = await load('scripts/marketing/render.mjs');
  for (const page of await allPublicPages()) {
    const html = renderPage(page);
    assert.equal(html.split('href="/brand/xbar-signature.css"').length - 1, 1);
    const signatures = [...html.matchAll(/<svg[^>]*data-xbar-signature[^>]*>[\s\S]*?<\/svg>/g)];
    assert.ok(signatures.length >= 2, `${page.path}: header and footer original artwork required`);
    for (const [svg] of signatures) {
      assert.match(svg, /<image[^>]*href="\/brand\/xbar-original-lockup-480.png"/);
      assert.match(svg, /viewBox="0 0 1672 941"/);
      assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
      assert.doesNotMatch(svg, /<path\b|<text\b|xbar-signature__trace/);
    }
  }
});

// Shared HTML rendering for the static marketing site.
// Every public page is complete server-generated HTML: view-source shows the
// full content, each page carries unique metadata and a self-referencing
// canonical, and none of them load the application bundle.

export const SITE_ORIGIN = 'https://xbar.app';
export const APP_LOGIN = '/app/login';
export const APP_SIGNUP = '/app/login?mode=signup';

export function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/solutions', label: 'Solutions' },
  { href: '/resources', label: 'Resources' },
  { href: '/demo', label: 'Product tour' },
];

function navLink(item, currentPath) {
  const current =
    currentPath === item.href || (item.href !== '/' && currentPath.startsWith(`${item.href}/`))
      ? ' aria-current="page"'
      : '';
  return `<a href="${item.href}"${current}>${esc(item.label)}</a>`;
}

function header(currentPath) {
  return `<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/" aria-label="XBAR home">
      <img src="/brand/xbar-app-icon.png" alt="" width="30" height="30" />
      <span>XBAR<small>Horse records &amp; sales</small></span>
    </a>
    <nav class="site-nav" aria-label="Primary">
      ${NAV.map((item) => navLink(item, currentPath)).join('\n      ')}
      <a href="${APP_LOGIN}" rel="nofollow">Sign in</a>
    </nav>
    <a class="btn btn--primary" href="${APP_SIGNUP}" rel="nofollow">Create your workspace</a>
  </div>
</header>`;
}

function footer() {
  return `<footer class="site-footer">
  <div class="wrap">
    <div>
      <a class="brand" href="/"><img src="/brand/xbar-app-icon.png" alt="" width="30" height="30" /><span>XBAR</span></a>
      <p>One trusted operational record for every horse — documents, ownership, care, and sale-ready buyer packets.</p>
    </div>
    <div>
      <h3>Product</h3>
      <ul>
        <li><a href="/features">Features</a></li>
        <li><a href="/pricing">Pricing</a></li>
        <li><a href="/demo">Product tour</a></li>
        <li><a href="${APP_LOGIN}" rel="nofollow">Sign in</a></li>
      </ul>
    </div>
    <div>
      <h3>Solutions</h3>
      <ul>
        <li><a href="/solutions/breeding-programs">Breeding programs</a></li>
        <li><a href="/solutions/sale-barns">Sale barns &amp; consignors</a></li>
        <li><a href="/solutions/trainers">Trainers &amp; show barns</a></li>
        <li><a href="/solutions/ranch-operations">Ranch operations</a></li>
      </ul>
    </div>
    <div>
      <h3>Resources</h3>
      <ul>
        <li><a href="/resources">Resource hub</a></li>
        <li><a href="/resources/horse-records-checklist">Horse records checklist</a></li>
        <li><a href="/resources/sale-ready-horse-documentation">Sale-ready documentation</a></li>
        <li><a href="/resources/equine-ownership-transfer-checklist">Ownership transfer checklist</a></li>
      </ul>
    </div>
    <div class="footer-legal">
      <span>© ${new Date().getUTCFullYear()} XBAR LLC</span>
      <span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span>
    </div>
  </div>
</footer>`;
}

/**
 * Render a full page document.
 * @param {object} page
 * @param {string} page.path        Site-relative path, e.g. "/pricing"
 * @param {string} page.title       Unique <title>
 * @param {string} page.description Unique meta description
 * @param {string} page.body        Page <main> inner HTML
 * @param {object[]} [page.jsonLd]  Extra JSON-LD blocks
 * @param {string} [page.ogType]    Open Graph type (default "website")
 * @param {boolean} [page.noindex]  Emit a robots noindex meta (404 page)
 */
export function renderPage(page) {
  const canonical = `${SITE_ORIGIN}${page.path === '/' ? '/' : page.path}`;
  const verification = process.env.GOOGLE_SITE_VERIFICATION
    ? `\n    <meta name="google-site-verification" content="${esc(process.env.GOOGLE_SITE_VERIFICATION)}" />`
    : '';
  const baseJsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${SITE_ORIGIN}/#organization`,
      name: 'XBAR',
      url: `${SITE_ORIGIN}/`,
      logo: `${SITE_ORIGIN}/brand/xbar-horse-logo-lockup-main.png`,
      description: 'Records, ownership, and sale-readiness software for performance horse and ranch operations.',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${SITE_ORIGIN}/#website`,
      url: `${SITE_ORIGIN}/`,
      name: 'XBAR',
      publisher: { '@id': `${SITE_ORIGIN}/#organization` },
    },
    ...(page.jsonLd ?? []),
  ];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#05070A" />
    <title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.description)}" />
    ${page.noindex ? '<meta name="robots" content="noindex, nofollow" />' : '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />'}
    <link rel="canonical" href="${canonical}" />${verification}

    <meta property="og:type" content="${esc(page.ogType ?? 'website')}" />
    <meta property="og:site_name" content="XBAR" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${esc(page.title)}" />
    <meta property="og:description" content="${esc(page.description)}" />
    <meta property="og:image" content="${SITE_ORIGIN}/brand/xbar-horse-logo-lockup-main.png" />
    <meta property="og:image:alt" content="XBAR horse records" />
    <meta property="og:locale" content="en_US" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(page.title)}" />
    <meta name="twitter:description" content="${esc(page.description)}" />
    <meta name="twitter:image" content="${SITE_ORIGIN}/brand/xbar-horse-logo-lockup-main.png" />

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Outfit:wght@400;500;600;700;800;900&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/site.css" />
    <link rel="icon" type="image/png" href="/brand/xbar-favicon.png" />
    <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" />
    <script type="application/ld+json">${JSON.stringify(baseJsonLd)}</script>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    ${header(page.path)}
    <main id="main">
${page.body}
    </main>
    ${footer()}
  </body>
</html>
`;
}

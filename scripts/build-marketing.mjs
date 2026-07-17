// Post-build step: assemble the public site in dist/.
//
// After `vite build` produces the application bundle, this script:
//   1. moves the SPA shell from dist/index.html to dist/app.html (served
//      under /app/* by vercel.json rewrites — never indexed),
//   2. renders every public marketing page as complete static HTML with
//      unique metadata and self-referencing canonicals,
//   3. renders /privacy and /terms from the same legal source the app uses
//      (src/lib/legalDocuments.ts — imported directly, so no drift),
//   4. generates the sample sale packet shown on /demo,
//   5. writes sitemap.xml containing only canonical public pages.
//
// Skipped for GitHub Pages preview builds and mobile (Capacitor) builds,
// which wrap the SPA shell directly (XBAR_SKIP_MARKETING=1).

import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage, SITE_ORIGIN } from './marketing/render.mjs';
import { marketingPages, legalPage, notFoundPage, CONTENT_UPDATED } from './marketing/pages.mjs';
import { renderSamplePacket } from './marketing/sample-packet.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const dist = path.join(repoRoot, 'dist');

const staticTarget = process.env.VITE_STATIC_TARGET ?? (process.env.GITHUB_ACTIONS ? 'github-pages' : 'web');
if (process.env.XBAR_SKIP_MARKETING === '1' || staticTarget === 'github-pages') {
  console.log(
    `[marketing] skipped (target=${staticTarget}, XBAR_SKIP_MARKETING=${process.env.XBAR_SKIP_MARKETING ?? '0'})`,
  );
  process.exit(0);
}

if (!existsSync(dist)) {
  console.error('[marketing] dist/ not found — run `vite build` first.');
  process.exit(1);
}

/* 1 — relocate the SPA shell to app.html. The Vite-built shell references
   the hashed /assets bundle; the marketing homepage that replaces
   dist/index.html does not. Idempotent across re-runs. */
const indexPath = path.join(dist, 'index.html');
const appShellPath = path.join(dist, 'app.html');
if (existsSync(indexPath) && readFileSync(indexPath, 'utf8').includes('/assets/')) {
  renameSync(indexPath, appShellPath);
  console.log('[marketing] moved SPA shell: index.html -> app.html');
}
if (!existsSync(appShellPath)) {
  console.error('[marketing] app.html missing and dist/index.html is not the SPA shell — rebuild first.');
  process.exit(1);
}

/* 2+3 — render public pages (marketing + legal from the app's own source). */
const { getLegalDocument } = await import('../src/lib/legalDocuments.ts');
const pages = [
  ...marketingPages,
  legalPage(getLegalDocument('privacy'), '/privacy'),
  legalPage(getLegalDocument('terms'), '/terms'),
];

function outputFileFor(pagePath) {
  if (pagePath === '/') return path.join(dist, 'index.html');
  if (pagePath.endsWith('.html')) return path.join(dist, pagePath.slice(1));
  return path.join(dist, pagePath.slice(1), 'index.html');
}

for (const page of [...pages, notFoundPage]) {
  const file = outputFileFor(page.path);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, renderPage(page));
}
copyFileSync(path.join(here, 'marketing', 'site.css'), path.join(dist, 'site.css'));
copyFileSync(path.join(here, 'marketing', 'site.js'), path.join(dist, 'site.js'));

/* 4 — sample sale packet (fictional data, clearly labeled). */
const samplesDir = path.join(dist, 'samples');
mkdirSync(samplesDir, { recursive: true });
writeFileSync(path.join(samplesDir, 'sample-sale-packet.html'), renderSamplePacket());

/* 5 — robots.txt: derived from the same origin as every canonical. */
writeFileSync(
  path.join(dist, 'robots.txt'),
  `# XBAR — public marketing site is crawlable; the application is not.
User-agent: *
Allow: /

# Authenticated application, share links, and API surfaces stay out of the index
Disallow: /app
Disallow: /app/
Disallow: /api/
Disallow: /profiles/
Disallow: /login
Disallow: /setup

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`,
);

/* 6 — sitemap: canonical, indexable public pages only. */
const sitemapEntries = pages
  .filter((page) => !page.noindex)
  .map(
    (page) => `  <url>
    <loc>${SITE_ORIGIN}${page.path === '/' ? '/' : page.path}</loc>
    <lastmod>${page.lastmod ?? CONTENT_UPDATED}</lastmod>
    <changefreq>${page.changefreq ?? 'monthly'}</changefreq>
    <priority>${page.priority ?? '0.5'}</priority>
  </url>`,
  )
  .join('\n');
writeFileSync(
  path.join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries}\n</urlset>\n`,
);

console.log(
  `[marketing] wrote ${pages.length + 1} pages, sample packet, site.css, and sitemap.xml (${pages.length} sitemap URLs)`,
);

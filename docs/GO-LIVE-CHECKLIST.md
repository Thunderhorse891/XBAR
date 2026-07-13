# Go-live checklist — actions outside this repository

The repository is ready for these steps; none of them can be completed from
code. Work top to bottom.

## 1. Canonical domain (Vercel dashboard) — **currently the top blocker**

Verified during the July 2026 audit via the Vercel API: the project
`xbar-horse-management-app` has **no custom domain attached** — only
`xbar-horse-management-app.vercel.app` aliases. Meanwhile every canonical URL,
sitemap entry, and JSON-LD block on the site points at `https://xbar.app`, and
`xbar.app` is registered (not available for purchase). Two possibilities:

- **You own `xbar.app`** → attach it now (steps below).
- **You do not own it** → either acquire it, or change `SITE_ORIGIN` in
  `scripts/marketing/render.mjs` (and `public/robots.txt`) to the domain you
  do own before promoting the site — canonicals pointing at a domain you
  don't control are worse than none.

1. Project → Settings → Domains: add `xbar.app` and `www.xbar.app`.
2. Point DNS (A/ALIAS + CNAME) per Vercel's instructions and wait for both to
   show **Valid Configuration**.
3. Set `xbar.app` as the primary domain. `vercel.json` already 308-redirects
   `www.xbar.app` → `xbar.app`; verify with
   `curl -sI https://www.xbar.app/pricing | grep -i location`.
4. If any other alias domains exist, add a matching host redirect block in
   `vercel.json` (copy the `www` entry).
5. Confirm `PUBLIC_APP_URL=https://xbar.app` in Vercel Production env vars.

## 2. Search Console

1. Create a Domain property for `xbar.app` in Google Search Console
   (DNS TXT verification), or use the HTML-tag method by setting the
   `GOOGLE_SITE_VERIFICATION` environment variable in Vercel — the marketing
   generator emits the meta tag automatically on every public page.
2. Submit `https://xbar.app/sitemap.xml`.
3. Use URL Inspection on `/`, `/pricing`, and one resource page; request
   indexing.
4. After a week, check Coverage for accidental `/app` or `/profiles` URLs —
   they should all report "Excluded by noindex/robots".
5. Repeat property + sitemap in Bing Webmaster Tools.

## 3. Analytics and conversion events

- The CSP is strict (`script-src 'self'`) by design. Options, in order of
  preference:
  1. A proxied/self-hosted analytics endpoint served from your own domain
     (e.g. Plausible/Umami behind a first-party path), or
  2. Deliberately extending the CSP in `vercel.json` for one vetted vendor.
- Conversion events worth wiring first: marketing CTA click-through to
  `/app/login?mode=signup` (measurable server-side from the redirect), workspace
  creation, first document upload, first sale packet build (the app already
  tracks these via `src/lib/telemetry.ts` product events).
- Set up rank tracking for: "horse records software", "equine records app",
  "horse sale packet", "horse ownership transfer checklist", plus brand terms.

## 4. Customer proof (do not fake it)

- The marketing site intentionally ships without testimonials or case studies;
  a unit test blocks unverifiable social-proof claims.
- When the first real operation agrees **in writing**: publish
  `/customers/<name>` with concrete, verifiable specifics (horses managed,
  documents processed, before/after workflow), a named person, and a review
  date — then link it from the homepage and relevant solution page.

## 5. Authority (humans required)

- Recruit one named equine professional (DVM, registry veteran, or working
  sale-barn manager) to review the three resource guides; add their name,
  credentials, and "reviewed on" date to the article bylines.
- Offer the records checklist and transfer checklist to breed associations,
  boarding barns, and trainer networks as printable resources (they link, you
  earn authority).
- Only add comparison pages when every claim about a competitor can be
  documented and dated.

## 6. Post-deploy verification

```sh
curl -sI https://xbar.app/            # 200, HTML, cacheable
curl -sI https://xbar.app/app         # X-Robots-Tag: noindex
curl -sI https://xbar.app/login       # 308 -> /app/login
curl -sI https://xbar.app/horses      # 308 -> /app/horses
curl -s  https://xbar.app/sitemap.xml # marketing pages only
curl -s  https://xbar.app/robots.txt  # Disallow: /app
```

Then run Lighthouse (or PageSpeed Insights) against `/` and `/pricing` —
both are static HTML and should score high; regressions mean something broke
in the generator.

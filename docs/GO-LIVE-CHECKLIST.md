# Go-live checklist — actions outside this repository

The repository is ready for these steps; none of them can be completed from
code. Work top to bottom.

## 0. Preflight — see what's configured before and after each step

```sh
npm run preflight                                                    # local env report
npm run preflight -- --url https://xbar-horse-management-app.vercel.app  # + live /api/health probe
```

The report lists every production subsystem (Supabase accounts/sync, Stripe
billing, email, cron, optional hardening), which env vars each one needs, and
what turning it on unlocks. The `--url` probe compares intent against the
deployed reality. Nothing here blocks a deploy — unconfigured subsystems
degrade honestly (manual-billing panel, local-only mode, in-app reminders).

**Billing launch note:** `VITE_MANAGED_BILLING_ENABLED` is the client-side
master switch. Leave it `false` (the app shows the honest manual-billing
panel) until _all_ Stripe values — secret key, webhook secret, and the four
price IDs — plus Supabase are configured in Vercel; then set it `true` and
redeploy.

## 1. Canonical domain

**Interim decision (July 2026):** the site canonicalizes to
`https://xbar-horse-management-app.vercel.app` — the domain actually attached
to the project — so canonicals, sitemap, JSON-LD, and robots.txt are all
truthful today. The origin comes from one place
(`SITE_ORIGIN` in `scripts/marketing/render.mjs`, overridable via the
`PUBLIC_SITE_ORIGIN` or `PUBLIC_APP_URL` env var), so moving to a custom
domain later is a config change plus redeploy.

When you attach a custom domain (e.g. `xbar.app`, currently registered —
confirm you own it):

1. Project → Settings → Domains: add the domain (+ `www.`) and set it primary.
2. Set `PUBLIC_SITE_ORIGIN=https://<domain>` in Vercel Production env vars and
   redeploy — every canonical, OG URL, sitemap entry, and robots.txt line
   updates automatically.
3. `vercel.json` already 308-redirects `www.xbar.app` → `xbar.app`; add
   equivalent host redirect blocks for any other alias.
4. Resubmit the sitemap in Search Console under the new property.

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

- **Already wired, first-party, CSP-safe:** every marketing page loads
  `/site.js`, which beacons pageviews, sign-up CTA clicks, and sample-packet
  clicks to `/api/metrics` (anonymous — no cookies, respects Do Not Track).
  Events always appear in the Vercel function logs; once Supabase is
  configured they are also stored in `runtime_events` as `marketing.*` rows,
  queryable alongside the app's product events.
- If you later want a full analytics product, keep the CSP strict
  (`script-src 'self'`) and prefer a proxied/self-hosted endpoint
  (Plausible/Umami behind a first-party path) over extending the CSP for a
  third-party vendor.
- In-app conversion events (workspace creation, first document upload, first
  sale packet build) are already tracked via `src/lib/telemetry.ts` product
  events.
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

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

## 7. Auth launch gates — observed state, 9 Sep 2026

Observations read from the live `xbar-records` Supabase project
(`uxvwfepyothlakhqazwv`) on 9 Sep 2026 via the Supabase MCP, by one session
that has not been independently repeated. Nothing was changed. Each item below
names the query or advisor it came from so it can be re-run and disagreed with.

### Observed, with the evidence

- **No retained workspace, horse or subscription records.**

  ```sql
  select (select count(*) from auth.users) as users,
         (select count(*) from auth.users where email_confirmed_at is not null) as confirmed,
         (select count(*) from public.workspaces) as workspaces,
         (select count(*) from public.horses) as horses,
         (select count(*) from public.workspace_subscription_profiles) as subs;
  -- users 1, confirmed 1, workspaces 0, horses 0, subs 0
  ```

  This establishes that no such records are retained **now**. It does not
  establish the flow has never run — rows can be deleted. Either way, there is
  no stored evidence that signup → workspace → horse → tier → checkout has
  succeeded, so it still needs to be demonstrated before launch.

- **Leaked-password protection is disabled** — Supabase advisor
  `auth_leaked_password_protection`, security set. Authentication → Policies
  enables the HaveIBeenPwned check. It governs every password the reset flow
  sets, and turning it on is a single toggle.

- **RLS is enabled with at least one policy on all 25 public tables** (
  `pg_class.relrowsecurity` joined to `pg_policies`). That rules out the
  trivially-open case. It says **nothing about whether the policies are
  correct** — no policy body was reviewed here, and "RLS on" is not a security
  conclusion.

- **Advisor lints 0026/0027** flag those same 25 tables as visible in the
  GraphQL schema to `anon` and to `authenticated`. That is schema
  discoverability; row access is still governed by the policies above. Not a
  data-exposure finding on its own.

- **Two `SECURITY DEFINER` functions are `anon`-executable** (advisor 0028):
  `xbar_resolve_public_listing` and `xbar_track_public_share_view`. Deployed
  `proacl` confirms both carry `anon` and PUBLIC grants while
  `xbar_resolve_public_listing_legacy` carries neither — matching the intent of
  `migrations/20260822_restrict_anon_rpc_surface.sql`. Both are the buyer share
  flow and are meant to stay reachable. **A latent fail-open in them is fixed by
  `migrations/20260909_private_share_token_fail_closed.sql`, which is written
  and NOT YET APPLIED** — see the header of that file for the deployed
  definitions, the column defaults and the absent constraint that produce it.
  The migration leaves the constraint `NOT VALID` if older invalid rows exist;
  new inserts and updates are still checked and the patched RPCs deny those old
  links. The base schema defers validation. Reissue affected private links with
  owner authorization before validating separately. Archiving alone does not
  satisfy the token constraint, which also applies to archived rows; do not
  delete listings or make them public merely to pass validation.

### Not verified here — needs a person with a browser and the dashboards

This session could not reach these; that is a limitation of this environment,
not a claim that nobody can check them. Egress to
`xbar-horse-management-app.vercel.app` is refused by the agent network policy
(403 on CONNECT), and the tools available expose no auth-configuration or
Vercel environment read.

1. **Auth → URL Configuration → Site URL.** If it is still `localhost`,
   confirmation and recovery emails point at a machine the customer does not
   have. Set it to the deployed origin and add the preview-deployment origins
   to Redirect URLs, or links opened from a preview build are rejected.
2. **Send one real signup and one real recovery email.** Confirm they arrive
   (the default Supabase SMTP is rate-limited and is not a launch sender), that
   the link lands on `/app/reset-password`, and that setting a password works.
3. **Enable a provider in Supabase before listing it in
   `VITE_AUTH_OAUTH_PROVIDERS`.** The sign-in screen renders what that variable
   lists; a provider Supabase has not enabled becomes a button that fails.
4. **Stripe:** `VITE_MANAGED_BILLING_ENABLED` stays `false` until the secret
   key, webhook secret and all four price IDs are set — see section 0.

### Recovery consumption — design requirements, not implemented

Recorded so they are not mistaken for protections that exist:

- Browser-side arbitration of a recovery password change is best effort. Web
  Locks close it where they exist; safari13 is a build target and has none.
- A server-side consumption row (`SECURITY DEFINER` RPC, RLS deny-all table,
  unique on the attempt) closes browser-side races only. **It does not make the
  recovery token single-use** — whoever holds it can call GoTrue's
  `PUT /auth/v1/user` directly.
- Nor does PKCE alone: the browser still exchanges the code and holds the
  resulting token. Only an architecture where the session stays server-side
  keeps a GoTrue-capable token out of the browser.
- Requiring the `amr` claim to carry a `recovery` method is how a recovery
  attempt would be told from an ordinary session. Documented by Supabase;
  **not yet observed on a real recovery token** — item 2 above would settle it.

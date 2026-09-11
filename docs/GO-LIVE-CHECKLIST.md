# Go-live checklist — actions outside this repository

Track the evidence below separately from repository tests. Passing tests alone
does not establish production readiness.

## Verified September 10, 2026

- Applied `20260911005818_workspace_access_policies.sql` (September 11 UTC):
  a live authenticated workspace read had failed with policy recursion
  (`42P17`). After the fix, real SQL under the `authenticated` role passes
  owner creation/read/write, tenant isolation, member read-only access,
  Admin writes and owner removal. Self-enrollment and self-promotion are
  denied. Invitation acceptance now verifies the current confirmed account,
  consumes the pending invite atomically and applies its assigned role;
  wrong-recipient, unconfirmed, revoked and replay cases refuse. All synthetic
  users and records rolled back (one original auth user, zero workspace rows).
  Nine relational browser cases passed without retries, including the new
  client RPC path. Deploy the matching client before testing invitations;
  the old client no longer has permission to accept via direct table writes.
- Follow-up share fix applied at `20260911003739` UTC (September 10 Chicago):
  `20260911003739_share_release_selected_row.sql`. Reproduced a released sibling
  authorizing an unreleased draft with the same path before the fix. The live
  rollback test now passes: both resolvers refuse the draft and the tracker
  records no view. Token/public/archive controls still pass, fixture counts
  return to zero, and the legacy function remains unavailable to `anon`.
- Integrated the upstream auth-storage and sign-out changes through `5de5391`:
  all 1,113 unit/API tests and 50 auth smoke cases passed without browser
  retries. A subsequent reset-screen error-handling change passed three
  targeted browser cases, including no repeated mutation after a lock
  completion error. These browser tests use mocked Auth responses.
- Required browser locking passes the integrated auth smoke suite.
  Unsupported/denied locks send no password change. This intentionally limits
  reset availability in older browsers; it does not enforce single-use tokens
  at the GoTrue server.
- Independently ran the `e722979` candidate: 1,095 unit/API tests, 44
  built-bundle auth tests, and eight relational-sync-enabled held-workspace
  tests passed, with browser retries disabled. The browser suites intercept
  Supabase requests; they do not prove real email delivery or cloud sync.
- Applied the private-share migration to `xbar-records` (`uxvwfepyothlakhqazwv`),
  ledger version `20260910173613`. Both live functions reject empty stored
  private tokens; `shared_listings_private_token_present` is validated. No
  listings were present before or after the migration.
- Ran `supabase/checks/share-token-live-rollback.sql` against that live schema:
  empty private-token inserts rejected by the named constraint; missing/wrong
  tokens refused; valid private and public links resolved; archived links
  refused; only permitted views tracked. All fixture rows rolled back, with
  workspace/horse/listing/subscription counts confirmed back at zero. This
  checks deployed SQL behavior, not a browser checkout or customer login.
- Supabase's ledger already records the other five README rollout migrations
  as applied on September 4. Their data effects were not independently replayed.
- Production `/api/health` returned HTTP 200 and `billingReady: true`:
  Supabase admin, Stripe secret/webhook/price IDs and both managed-billing flags
  were present. This proves configuration presence, not credential validity,
  payment completion, or webhook delivery. Email-provider and reminder-cron
  flags were false; this email flag does not report Supabase Auth SMTP.
- The production alias still serves `5c38394e496088e4f8a98c434f3b1c7913f3b881`
  on `main`, not PR #212's `e722979` candidate. A green preview is not a
  production release of the auth fixes.
- Supabase's security advisor still reports leaked-password protection disabled.
  Site URL, real confirmation/recovery email delivery, and the complete
  signup → workspace → horse → checkout → webhook flow remain unverified.
  Browser dashboard access failed in this verification environment.
- Recovery-email attempt: the Auth API accepted one request (HTTP 200) and
  recorded `recovery_sent_at`, but the recipient reported no email received.
  Delivery and link completion remain unverified; acceptance is not delivery.
  Available Auth audit-log rows did not explain the missing message. Inspect
  Auth mail logs/SMTP configuration before repeating requests.
- The documented recovery concurrency residuals remain open; they have not
  been accepted as launch risks or closed by these checks.

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
  flow and are meant to stay reachable. **The private-token fail-open was closed
  on this project on September 10 by
  `migrations/20260910173613_private_share_token_fail_closed.sql`** — see the current
  verification above. The file retains the historical explanation of the flaw.
  The migration leaves the constraint `NOT VALID` if older invalid rows exist;
  new inserts and updates are still checked and the patched RPCs deny those old
  links. The base schema defers validation. Reissue affected private links with
  owner authorization, or archive those listings, before validating separately.
  Archived listings are exempt from the token constraint and remain inaccessible
  through both public RPCs. Prefer archiving for any listing nobody intends to
  share again: re-issuing hands a broken share a working token on the way to
  retiring it, which is the one outcome this fix exists to prevent. Do not delete listings or make them public merely
  to pass validation.

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

- Password reset now requires a Web Lock. Missing or denied locking refuses
  without sending a change, including on safari13. The app no longer relies
  on its storage lease alone for exclusion. Server-side enforcement, direct
  bearer reuse, and requests surviving browser-context termination remain
  separate concerns; this is not a single-use-session guarantee.
- A server-side consumption row (`SECURITY DEFINER` RPC, RLS deny-all table,
  unique on the attempt) closes browser-side races only. **It does not make the
  recovery token single-use** — whoever holds it can call GoTrue's
  `PUT /auth/v1/user` directly.
- Nor does PKCE alone: the browser still exchanges the code and holds the
  resulting token. Only an architecture where the session stays server-side
  keeps a GoTrue-capable token out of the browser.
- The recovery **link** is already single-use at GoTrue: the OTP is consumed at
  `/verify`, so thoroughly that Supabase's own troubleshooting guide names
  email-prefetching scanners consuming it before the customer. What is not
  single-use is the **session token** minted from that one redemption.
- Requiring the `amr` claim to carry a `recovery` method is how a recovery
  attempt would be told from an ordinary session. Documented — Supabase's JWT
  Claims Reference enumerates `"recovery"` among the `amr.method` values — but
  **not yet observed on a real recovery token for this project**; item 2 above
  would settle it. The installed `@supabase/auth-js` types do not enumerate
  `recovery` and settle nothing either way.

The full design, with the three corrections a review raised against it, is in
[`docs/RECOVERY-CONSUMPTION-DESIGN.md`](RECOVERY-CONSUMPTION-DESIGN.md). It is a
design only: no migration, no endpoint, no cloud or configuration change.

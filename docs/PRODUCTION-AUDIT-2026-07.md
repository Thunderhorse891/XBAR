# XBAR production audit — July 2026

This document records what the July 2026 search/trust/product-integrity audit
found, what was changed in this repository, what was verified, and — just as
important — what **cannot** be completed from a repository and still requires
real-world action. Nothing below is marked done unless it was implemented and
verified in this codebase.

## Phase 1 — Search and trust integrity

| Item                                                     | Status                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Make `/` the public homepage                             | **Done**                         | `scripts/build-marketing.mjs` emits a static homepage at `dist/index.html`; prod-smoke test "marketing homepage at / is complete static HTML"                                                                                                                                                                                                                                                    |
| Move the application under `/app`                        | **Done**                         | Router basename `/app` (`src/lib/routeCanon.ts`), SPA shell served as `dist/app.html` via `vercel.json` rewrites; prod-smoke "app shell boots under /app"                                                                                                                                                                                                                                        |
| Attach and verify the canonical custom domain            | **Resolved (interim)**           | Round 2: the site now canonicalizes to `https://xbar-horse-management-app.vercel.app` — the domain actually attached to the project (verified via the Vercel API) — so every canonical/sitemap/robots line is truthful today. A future custom domain is a one-env-var change (`PUBLIC_SITE_ORIGIN`) — see `docs/GO-LIVE-CHECKLIST.md` §1                                                         |
| Permanently redirect all alternate domains               | **Repo side done**               | `www` host redirect is 308-permanent in `vercel.json`. Any additional alias domains must be listed in the Vercel dashboard and added to `vercel.json` the same way                                                                                                                                                                                                                               |
| Server-generated metadata in HTML for every public route | **Done**                         | Every marketing page is complete static HTML with unique title/description/OG/JSON-LD; enforced by `tests/marketingSite.test.ts` (unique, length-bounded, view-source complete)                                                                                                                                                                                                                  |
| `noindex` on login and private routes                    | **Done**                         | App shell carries `<meta name="robots" content="noindex, nofollow">`; `vercel.json` adds `X-Robots-Tag: noindex` on `/app*`, `/app.html`, `/api/*`; verified by prod-smoke "indexing architecture" test                                                                                                                                                                                          |
| Decide whether `/profiles/:id` is public or private      | **Decided: public-but-unlisted** | Buyer share links stay reachable (they are sent to buyers), 308-redirect to `/app/profiles/:id`, and are `noindex` + `Disallow`ed in robots.txt. They are sanitized views (`src/lib/publicShare.ts` strips internal fields)                                                                                                                                                                      |
| Remove login from the sitemap                            | **Done**                         | Sitemap is generated from marketing pages only; test asserts no `login`, `/app`, or `/profiles` URL can enter it                                                                                                                                                                                                                                                                                 |
| Correct robots rules                                     | **Done**                         | `public/robots.txt`: marketing crawlable, `/app`, `/api/`, `/profiles/`, `/login`, `/setup` disallowed                                                                                                                                                                                                                                                                                           |
| Remove or relabel simulated quick-create actions         | **Done**                         | `GlobalCreateDrawer` rewritten: every action persists through a real store mutation (`addHorse`, `createDocumentIntake` with a real file input, `addMedicalEvent`, `addBreedingEvent`, `updateHorseLocation`, `createSalesLead`, `addExpenseReceipt`, `addRanchAsset`) and reports the store's actual result. Actions with no persistence path ("Add Task", "Report Pasture Issue") were removed |

### Additional integrity defects found and fixed (beyond the brief)

- `Login.tsx` showed a **"Signed in" success toast without checking any
  credentials** when Supabase is not configured. Now reports honestly that a
  browser-local workspace was opened.
- Sixteen page-level buttons faked success with toasts and did nothing:
  Equipment ("Work order created", "Repair logged"), AnimalProfile ("Move
  drawer opened", "Health record added", "Breeding record added"), Pastures
  ("Pasture issue reported", "Move from X"), FeedInventory ("Feed logged"),
  HealthCare ("Care scheduled", "Health record added"), BreedingFoaling
  ("Preg check scheduled"), TodayWork ("Snoozed"). Each was either wired to a
  real store mutation, converted to open the real quick-create flow, relabeled
  as navigation, or removed.
- TodayWork "mark done" only lived in React state (lost on reload). It now
  persists per-day dismissals and the toast says what actually happens.

## Phase 2 — Product and design integrity

| Item                                                 | Status              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consolidate the nine CSS systems                     | **Done (measured)** | Round 1 removed the marketing system (1,723 lines) and orphaned route CSS. Round 2 measured class reachability across all TSX/TS and removed every provably-unreachable rule: `productionFinal.css` (0% used) and `dashboardEditorial.css` (never imported) deleted outright; 5,400+ additional dead lines pruned across the remaining files (14,222 → ~8,800). Verified by full build, 12-test e2e suite, 9-test prod-smoke, and fresh screenshots |
| Standardize primary navigation names                 | **Done**            | One unique label per route in `App.tsx` (`Care Board` vs `Health Records`, `Ranch Assets` vs `Equipment`, `Breeding` vs `Breeding Records`, …); `/follow-ups` and `/assets-equipment` now redirect to their canonical routes; command palette and sidebar agree                                                                                                                                                                                     |
| One UI family + one display family                   | **Done**            | Outfit (UI) + Fraunces (display) as `--font-ui`/`--font-display`; Geist and Hanken Grotesk removed; fonts loaded once from `index.html`                                                                                                                                                                                                                                                                                                             |
| Replace mock-only previews with real product imagery | **Done**            | `scripts/capture-product-screenshots.mjs` drives the real built app through the real workflow and captures six screenshots (`public/brand/screenshots/`), used on `/` and `/demo`. The sale-packet sample mirrors the shipped generator's format with clearly-fictional data                                                                                                                                                                        |
| Build real global search or rename it                | **Done**            | The topbar search was a horses-only filter mislabeled as global. It now opens the command palette, which genuinely searches horses, documents, buyers, and modules                                                                                                                                                                                                                                                                                  |
| Finish direct invitation and quick-create workflows  | **Done / verified** | Invitations were already real (validated, seat-limited, persisted, `api/invite.js` email delivery) — verified, not changed. Quick-create rebuilt as above                                                                                                                                                                                                                                                                                           |
| Card interactions fully keyboard accessible          | **Done**            | Shared interactive components already carried `role`, `tabIndex`, and key handlers (verified); the two page-local handlers missing Space activation (TodayWork, Reports) were fixed                                                                                                                                                                                                                                                                 |
| Real loading, success, failure, empty-state behavior | **Done**            | Suspense fallback is a proper `role="status"` spinner; create flows show busy states and surface real store errors; empty states verified by e2e ("horses roster shows an empty state", "documents shows an empty state", horse-required quick-create shows a real next step)                                                                                                                                                                       |

## Phase 3 — Public SEO platform

| Item                                                        | Status                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML-first marketing site                                   | **Done**                                    | 16 static pages; zero application JS; single `site.css`; view-source completeness asserted in tests                                                                                                                                                                                                                                                                                                                   |
| Public pricing and feature pages                            | **Done**                                    | `/pricing` publishes the exact limits the app enforces — `tests/marketingSite.test.ts` fails the build if marketing prices/limits drift from `subscriptionTierConfig`                                                                                                                                                                                                                                                 |
| Solution pages per segment                                  | **Done**                                    | `/solutions/breeding-programs`, `/solutions/sale-barns`, `/solutions/trainers`, `/solutions/ranch-operations` + index                                                                                                                                                                                                                                                                                                 |
| Resource hub around records and sale readiness              | **Done**                                    | `/resources` + three substantial guides (records checklist, sale-ready documentation, ownership-transfer checklist), each with Article + Breadcrumb JSON-LD and an honest "not legal/veterinary advice" disclosure                                                                                                                                                                                                    |
| One legitimate customer case study                          | **Not done — deliberately**                 | There is no customer evidence in this repository, and fabricating a case study would violate the integrity standard this audit enforces. A test now actively blocks unverifiable social-proof claims from the marketing pages. When a real customer agrees in writing, add the case study as a new page                                                                                                               |
| Product demo and downloadable sample packet                 | **Done**                                    | `/demo` walks the real workflow with real screenshots; `/samples/sample-sale-packet.html` is generated in the shipped packet format with clearly-labeled fictional data                                                                                                                                                                                                                                               |
| Search Console, analytics, conversion events, rank tracking | **Repo side done; external setup required** | The generator emits a `google-site-verification` meta when `GOOGLE_SITE_VERIFICATION` is set. Creating the Search Console property, submitting the sitemap, and choosing an analytics vendor are dashboard actions — see `docs/GO-LIVE-CHECKLIST.md`. Note: the strict CSP (`script-src 'self'`) intentionally blocks third-party analytics scripts; pick a proxied/self-hosted option or extend the CSP deliberately |

## Phase 4 — Authority growth

Authority is earned off-repository. What this pass did and did not do:

- **Did**: published expert-quality operational resources with visible update
  dates and honest attribution ("the XBAR team" — no invented credentials);
  made checklists printable/linkable; added a genuinely useful sample packet
  as a linkable asset; blocked fabricated social proof at test level.
- **Did not** (requires humans): author credentials from a named equine
  professional, partnerships with breeders/trainers/sale barns, link
  earning, and comparison pages (none were written because competitor claims
  could not be documented objectively from here).

## Definition of "finished" — scorecard

| Criterion                                                       | State                                                                                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| View-source shows complete public content                       | ✅ verified by test                                                                                                              |
| Unique server-generated metadata per public page                | ✅ verified by test                                                                                                              |
| Self-referencing canonical per public page                      | ✅ verified by test                                                                                                              |
| Login/authenticated routes noindex                              | ✅ verified by prod-smoke                                                                                                        |
| Sitemap contains only canonical public pages                    | ✅ verified by test + prod-smoke                                                                                                 |
| Canonical domain attached, aliases redirect                     | ⚠️ redirects shipped; domain attachment is a Vercel dashboard step                                                               |
| No button reports success without persistent evidence           | ✅ every fake found was fixed; convention documented in README                                                                   |
| One name, one canonical route per feature                       | ✅ unique labels + redirect map                                                                                                  |
| Public visitors can inspect the real product before registering | ✅ /demo with real screenshots + sample packet + local-first workspace                                                           |
| Multiple substantial pages targeting distinct search intent     | ✅ 16 pages across product/solution/resource intent                                                                              |
| Real customer or operational proof present                      | ⚠️ operational proof (real screenshots, real sample packet) yes; **customer** proof honestly absent until a real customer exists |
| Marketing does not load the application infrastructure          | ✅ verified by test (no `/assets/` reference on any public page)                                                                 |

## Verification run for this audit

- `npm test` — 31 unit test files, all passing (includes the new
  `marketingSite` integrity suite)
- `npm run test:prod-smoke` — 9/9 against the production build with
  production-parity routing (`scripts/serve-dist.mjs`)
- `npm run test:e2e` — 11/11 against the dev server
- `npm run lint` — 0 errors
- `npm run build` — clean; generates app bundle + 16 public pages + sitemap

## Round 2 addendum (same audit, continued)

- **Canonical origin corrected to reality.** Every canonical, OG URL, JSON-LD
  id, sitemap entry, and robots.txt line now derives from a single
  `SITE_ORIGIN` defaulting to `https://xbar-horse-management-app.vercel.app`
  (the domain actually attached to the project), overridable via
  `PUBLIC_SITE_ORIGIN`/`PUBLIC_APP_URL` when a custom domain lands.
  robots.txt is generated at build from the same value.
- **OCR verified end-to-end, permanently.** A new e2e test generates a
  scan-like image in the browser (generic filename, no horse selected),
  uploads it through the real quick-create flow, and asserts the document was
  matched to the correct horse — possible only if tesseract actually read the
  pixels on-device. Passes in ~32s including worker init.
- **CSS consolidation, measured.** Class-reachability analysis across all
  TSX/TS drove the prune (numbers above). Functional pseudo-class selectors
  (`:where`/`:is`/`:not`/`:has`) were left untouched by design.
- **Design fixes surfaced by screenshot review:** dashboard attention rows
  ran title and metadata together (`EXAMPLE DOC BARWormer…`) — signal
  title/meta now render as stacked lines; AnimalProfile "Add Task"/"Build
  sale packet" relabeled as the navigations they are.
- **Mobile verified:** marketing home/pricing and the app setup flow render
  correctly at 390px (screenshot-checked).

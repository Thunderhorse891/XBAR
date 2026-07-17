# XBAR Command Infrastructure

Premium operational command infrastructure for modern horse and ranch operations: command files, proof control, title and transfer posture, care status, buyer movement, operating ledger, field conditions, and ranch control across web and mobile.

## Runtime

- Web: Vite + React, deployed through Vercel
- Mobile: Capacitor wrapping the same React application for iOS and Android
- Persistence: local-first IndexedDB with optional Supabase auth, storage, and workspace sync
- Billing: Stripe Billing and Checkout Sessions when server environment variables are configured

## Getting Started

```sh
git clone https://github.com/Thunderhorse891/XBAR.git
cd XBAR
npm install
npm run dev
```

## Core Scripts

| Script                     | Description                                                    |
| -------------------------- | -------------------------------------------------------------- |
| `npm run dev`              | Start the web app locally                                      |
| `npm run build`            | Typecheck, build the app bundle, then generate the public site |
| `npm run preview`          | Serve `dist` with production-parity routing (`serve-dist`)     |
| `npm run test`             | Prepare the Supabase schema, typecheck, and run unit tests     |
| `npm run test:e2e`         | Run Playwright end-to-end tests                                |
| `npm run test:prod-smoke`  | Build `dist` and smoke-test the production bundle in a browser |
| `npm run lint`             | Run ESLint across the repo                                     |
| `npm run format:check`     | Verify Prettier formatting (CI-gated)                          |
| `npm run supabase:prepare` | Generate the executable, idempotent production Supabase schema |
| `npm run mobile:sync`      | Build and sync the app into Capacitor targets                  |

## Deployment

### Web — public site and application are separate surfaces

- **`/` is the public marketing site**: complete static HTML generated at
  build time by `scripts/build-marketing.mjs` (home, features, pricing,
  solutions, resources, demo, privacy, terms). Every page ships unique
  server-generated metadata, a self-referencing canonical, and JSON-LD, and
  never loads the application bundle.
- **`/app/*` is the authenticated application**: the SPA shell is emitted as
  `dist/app.html`, rewritten under `/app/*` by `vercel.json`, and marked
  `noindex` (meta tag + `X-Robots-Tag`). The React Router basename is `/app`
  (`src/lib/routeCanon.ts`).
- `vercel.json` also 308-redirects legacy paths (`/login`, `/landing`,
  `/horses`, `/profiles/:id`, …) into their new homes and redirects
  `www.xbar.app` to the canonical `xbar.app` host.
- `sitemap.xml` is generated with the marketing pages only; `robots.txt`
  disallows `/app`, `/api/`, `/profiles/`.
- `scripts/serve-dist.mjs` mirrors this routing locally (`npm run preview`)
  and backs the prod-smoke Playwright suite.
- Hash routing remains available for GitHub Pages previews and is forced for
  mobile builds (`scripts/build-mobile.mjs`), which skip marketing generation.

### Mobile

1. Add a native target with `npm run mobile:add:ios` or `npm run mobile:add:android`.
2. Sync the current build with `npm run mobile:sync`.
3. Open it with `npm run mobile:open:ios` or `npm run mobile:open:android`.

Capacitor configuration lives in `capacitor.config.ts`.

## Design System

- Premium command infrastructure, not generic SaaS dashboard UI
- Graphite shell, metallic/silver workspace surfaces, restrained electric-blue control accents
- Shared brand rule: one system, distinct operational silhouettes per section
- Typography: exactly one UI family (Outfit) and one display family (Fraunces),
  declared as `--font-ui` / `--font-display` in `src/index.css` and loaded once
  from `index.html` — no per-file font imports
- Command-center visual layer in `src/routes/xbarCommandSystem.css` and `src/routes/commandCenterLocal.css`
- Interaction affordances in `src/routes/interactionSystem.css`
- Base tokens and foundational styles in `src/index.css`
- Public marketing site styles live in `scripts/marketing/site.css` (single
  stylesheet, no application CSS)
- Dead CSS is not tolerated: rules whose classes are unreachable from the
  source tree get removed (see the measured prune in
  `docs/PRODUCTION-AUDIT-2026-07.md`)

### Workflow integrity rule

No button may report success without persistent evidence. Every create/update
action in the UI calls a real store mutation and reports the store's actual
result; navigation actions are labeled as navigation ("Open …"), not as
creation. `tests/marketingSite.test.ts` additionally blocks unverifiable
social-proof claims from the public site.

## Product Standard

Each product surface should answer the same operational sequence:

1. Entity
2. Status
3. Evidence
4. Risk
5. Next action

Daily operations should not collapse into repeated dashboards. Command Center, Command Files, Title & Transfer, Proof Vault, Care Status, Buyer Desk, Operating Ledger, Ranch Assets, Field Conditions, and Ranch Control each require a distinct layout silhouette and workflow.

## Production Environment

Copy `.env.example` to `.env.local` for local development. Configure the same variable names in Vercel Preview and Production. Never expose server secrets with a `VITE_` prefix.

Required for browser cloud auth and sync:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Required for managed Stripe billing and webhook reconciliation:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_STARTER`
- `STRIPE_PRICE_ID_PROFESSIONAL`
- `STRIPE_PRICE_ID_RANCH_OPS`
- `STRIPE_PRICE_ID_ENTERPRISE`
- `PUBLIC_APP_URL`

Optional browser configuration is documented in `.env.example`.

### Operations

- **Health probe**: `GET /api/health` returns liveness plus subsystem-configured booleans (no secrets, no database touch). Point uptime monitors here.
- **Rate limiting**: every request-driven API endpoint is per-IP rate limited. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` so limits are shared across all serverless instances; without them the limiter degrades to per-instance in-memory counting.
- **Crash telemetry**: uncaught browser errors and unhandled promise rejections are reported to `runtime_events` through `/api/telemetry` (rate limited, workspace-verified, capped at 20 reports per session).
- **Marketing analytics**: every public page loads the first-party beacon `/site.js`, which reports pageviews and CTA clicks to `/api/metrics` — anonymous (no cookies, no identifiers, honors Do Not Track), CSP-safe, logged in the Vercel function stream, and stored in `runtime_events` as `marketing.*` when Supabase is configured.
- **Go-live preflight**: `npm run preflight` reports which subsystems are configured and what each missing env var keeps switched off; add `-- --url <deployment>` to probe the live `/api/health` and compare.
- **Webhook replays**: Stripe webhook deliveries are idempotent on `stripe_event_id` — retried events are acknowledged without re-running the subscription sync.
- **CI**: every push runs lint, format check, production-dependency audit, typecheck, unit tests, build, and a browser smoke test of the built bundle; CodeQL scans weekly and on PRs; Dependabot files grouped weekly updates.

### Supabase Bootstrap

Do not paste `supabase/production-schema.sql` directly into production. Generate the executable schema first:

```sh
npm run supabase:prepare
```

Then apply `supabase/production-schema.generated.sql` in the Supabase SQL editor. It converts unsupported policy syntax and appends the idempotent workspace RLS hardening migration.

### Stripe Go-Live

1. Create recurring Stripe prices for Starter `$29`, Professional `$79`, Ranch Ops `$199`, and Enterprise `$499`.
2. Set each corresponding `STRIPE_PRICE_ID_*` variable in Vercel Preview and Production.
3. Configure `/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
4. Set `STRIPE_WEBHOOK_SECRET` and verify a test-mode checkout before enabling live mode.

Managed checkout is restricted to workspace admins and only returns customers to trusted XBAR origins.

## Product State

- Local-first workspace with backup import and export
- Optional cloud authentication, relational workspace sync, and document storage through Supabase
- Managed Stripe checkout and webhook-driven subscription reconciliation
- Command files for horse identity, care, ownership, documents, sales, and operating history
- Title & Transfer desk for chain-of-title posture, release evidence, stakeholder share, and proof gaps
- Proof Vault for document intake, review, matching, approval, and buyer-safe release
- Operating Ledger for receipt intake, cost allocation, and ranch-level expense visibility
- Buyer Desk, buyer follow-ups, shared buyer packets, ranch assets, action queue, and field conditions

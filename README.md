# XBAR Horse Management App

The operating system for modern horse operations: premium horse records, document trust, sales workflows, and ranch operations across web and mobile.

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

| Script | Description |
|---|---|
| `npm run dev` | Start the web app locally |
| `npm run build` | Typecheck and build the production web bundle |
| `npm run preview` | Preview the production web bundle |
| `npm run test` | Prepare the Supabase schema, typecheck, and run unit tests |
| `npm run test:e2e` | Run Playwright end-to-end tests |
| `npm run supabase:prepare` | Generate the executable, idempotent production Supabase schema |
| `npm run mobile:sync` | Build and sync the app into Capacitor targets |

## Deployment

### Web

- Vercel SPA rewrites are configured in `vercel.json`.
- Browser routing is used on hosted environments.
- Hash routing remains available for GitHub Pages previews.

### Mobile

1. Add a native target with `npm run mobile:add:ios` or `npm run mobile:add:android`.
2. Sync the current build with `npm run mobile:sync`.
3. Open it with `npm run mobile:open:ios` or `npm run mobile:open:android`.

Capacitor configuration lives in `capacitor.config.ts`.

## Design System

- Dark-first premium ranch operations command center
- Graphite surfaces, smoked-glass panels, metallic borders, and electric-blue accents
- Shared tokens and foundational styles in `src/index.css`
- Command-center visual layer in `src/routes/xbarCommandSystem.css`
- Interaction affordances in `src/routes/interactionSystem.css`

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
- Horse records, care tracking, ownership, breeding, equipment, expenses, reminders, and weather
- Document intake, review queue, and buyer-safe sharing
- Sales listings, buyer follow-ups, and shared buyer profiles

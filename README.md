# XBAR Horse Management App

Premium horse records, document trust, and ranch operations across web and mobile from one React codebase.

## Runtime Direction

- Web app: Vite + React, ready for hosted deployment on Vercel or similar
- Mobile app: Capacitor wrapping the same React app for iOS and Android
- Desktop: no longer the active path; the repo is now centered on web + Capacitor

## Getting Started

1. Clone the repo:
   ```
   git clone https://github.com/Thunderhorse891/XBAR.git
   cd XBAR
   ```

2. Install dependencies:
   ```powershell
   node "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" install
   ```

3. Start the web app:
   ```powershell
   node "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev
   ```

## Core Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the hosted web app locally |
| `npm run build` | Build the production web bundle |
| `npm run preview` | Preview the production web bundle |
| `npm run test` | Typecheck and run the current test suite |
| `npm run supabase:prepare` | Generate an executable, idempotent production Supabase schema |
| `npm run mobile:add:ios` | Add the iOS Capacitor target |
| `npm run mobile:add:android` | Add the Android Capacitor target |
| `npm run mobile:sync` | Build and sync the app into Capacitor targets |
| `npm run mobile:open:ios` | Open the iOS project in Xcode after adding the target |
| `npm run mobile:open:android` | Open the Android project in Android Studio after adding the target |

## Deployment

### Web

- Vercel-ready SPA rewrites are included in `vercel.json`
- GitHub Pages remains supported for public previews through hash routing
- Browser routing automatically activates on non-`github.io` hosts

### Mobile

1. Add a native target:
   - `npm run mobile:add:ios`
   - `npm run mobile:add:android`
2. Sync the current build:
   - `npm run mobile:sync`
3. Open the native project:
   - `npm run mobile:open:ios`
   - `npm run mobile:open:android`

Capacitor config lives in `capacitor.config.ts`.

## Design System Direction

- Inter-based typography with tighter hierarchy and fewer ad hoc styles
- Warm neutral surfaces, one ranch-grade accent, and darker earth/slate navigation
- shadcn-compatible project manifest included in `components.json`
- Shared tokens live in `src/index.css`

## Tech Stack

- **Frontend:** React 18, TypeScript, Zustand, React Router
- **Web runtime:** Vite 5
- **Mobile runtime:** Capacitor
- **Persistence:** IndexedDB primary, localStorage fallback, local JSON backup and restore
- **Cloud:** Supabase auth, storage, and workspace sync when env is configured
- **Billing:** Stripe Billing and Checkout Sessions when server env is configured

## Production Environment

Copy `.env.example` to `.env.local` for local development. Configure the same variable names in Vercel for Preview and Production. Never expose server secrets with a `VITE_` prefix.

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

Do not paste `supabase/production-schema.sql` directly into production. Prepare the executable schema first:

```powershell
node "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run supabase:prepare
```

Then apply `supabase/production-schema.generated.sql` in the Supabase SQL editor. The generated schema converts unsupported policy syntax and appends the idempotent workspace RLS hardening migration.

### Stripe Go-Live

1. Create four recurring Stripe Prices matching the XBAR tiers: Starter `$29`, Professional `$79`, Ranch Ops `$199`, and Enterprise `$499`.
2. Set each corresponding `STRIPE_PRICE_ID_*` variable in Vercel Preview and Production.
3. Configure a Stripe webhook endpoint at `/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
4. Set `STRIPE_WEBHOOK_SECRET` from that endpoint and verify a test-mode checkout before enabling live mode.

Managed checkout is restricted to workspace admins and only returns customers to trusted XBAR origins.

## Current Product State

- Local-first workspace with IndexedDB persistence and manual backup import/export
- Real cloud auth and relational workspace sync are available when Supabase env is configured
- Real media and document cloud storage is available when Supabase env is configured
- Facebook share posting is available when a Meta app ID is configured
- Managed Stripe checkout and webhook-driven subscription reconciliation are available when server env is configured
- Manual document intake and review queue
- Shared-link access for buyer and owner views

## Handoff

- Project handoff notes live in `docs/PROJECT_HANDOFF.md`

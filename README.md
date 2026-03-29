# XBAR Horse Management App

Premium horse records, document trust, and ranch operations across web and mobile from one React codebase.

## Runtime Direction

- Web app: Vite + React, ready for hosted deployment on Vercel or similar
- Mobile app: Capacitor wrapping the same React app for iOS and Android
- Desktop: legacy Tauri source is still present during migration, but the active product path is now web + Capacitor

## Getting Started

1. Clone the repo:
   ```
   git clone https://github.com/Thunderhorse891/xbar-horse-management-app.git
   cd xbar-horse-management-app
   ```

2. Install dependencies:
   ```powershell
   node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install
   ```

3. Start the web app:
   ```powershell
   node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev
   ```

## Core Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the hosted web app locally |
| `npm run build` | Build the production web bundle |
| `npm run preview` | Preview the production web bundle |
| `npm run test` | Typecheck and run the current test suite |
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
- **Billing:** Stripe payment entry points when env is configured

## Production Environment

Copy `.env.example` to `.env.local` and set the values you plan to use in production.

Required for cloud auth and sync:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Optional but recommended:

- `VITE_SUPABASE_WORKSPACE_TABLE`
- `VITE_SUPABASE_RELATIONAL_SYNC`
- `VITE_SUPABASE_SNAPSHOT_FALLBACK`
- `VITE_SUPABASE_MEDIA_BUCKET`
- `VITE_SUPABASE_DOCUMENT_BUCKET`
- `VITE_FACEBOOK_APP_ID`
- `VITE_PUBLIC_APP_URL`
- `VITE_ROUTER_MODE`
- `VITE_STATIC_TARGET`
- `VITE_STRIPE_PAYMENT_LINK_STARTER`
- `VITE_STRIPE_PAYMENT_LINK_PROFESSIONAL`
- `VITE_STRIPE_PAYMENT_LINK_RANCH_OPS`
- `VITE_STRIPE_PAYMENT_LINK_ENTERPRISE`
- `VITE_STRIPE_BILLING_PORTAL_URL`

Supabase SQL bootstrap is included in:

- `supabase/production-schema.sql`

## Current Product State

- Local-first workspace with IndexedDB persistence and manual backup import/export
- Real cloud auth and relational workspace sync are available when Supabase env is configured
- Real media and document cloud storage is available when Supabase env is configured
- Facebook share posting is available when a Meta app ID is configured
- Real Stripe checkout entry points are available when Stripe payment-link env is configured
- Manual document intake and review queue
- Shared-link access for buyer and owner views
- Full OCR, webhook-driven billing reconciliation, invitations, and real marketplace workflows still need backend completion

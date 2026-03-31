# XBAR Project Handoff

Last updated: March 31, 2026

## Current snapshot

- Repo: `xbar-horse-management-app`
- Active branch: `main`
- Public preview: [GitHub Pages preview](https://thunderhorse891.github.io/xbar-horse-management-app/#/)
- Platform direction: hosted web app first, Capacitor for mobile
- Production status: not live-production-ready yet

## Product summary

XBAR is a ranch and equine operations app focused on horse records, document trust, shared buyer access, intake workflows, and ranch operations. The codebase has moved well beyond a static prototype, but the live public preview is still constrained by GitHub Pages and does not represent the full backend-capable runtime.

## What is working now

- React + Vite web app with routed workspaces
- Capacitor scaffold for iOS and Android targets
- Local-first workspace persistence with backup import/export
- Supabase auth, storage, and relational sync paths when env is configured
- Protected share-link model in the app layer
- Manual document intake and review flows
- Receipt and ranch-ops KPI support
- Weather workspace with live Open-Meteo data
- Stripe checkout entry points and billing portal entry points
- Typecheck, unit tests, Playwright smoke coverage, and build scripts in repo

## What is not fully production-ready

- GitHub Pages cannot run the server-backed `api/` routes
- Stripe webhooks and subscription reconciliation need a real runtime host
- Supabase schema still needs to be applied to the live project
- OCR and document extraction quality still needs real-world hardening
- Invite delivery, seat enforcement, and share access still need stricter backend enforcement
- Monitoring and analytics are wired in code paths, but only become real after proper deployment and env setup

## Architecture at handoff

### Frontend

- React 18
- TypeScript
- React Router
- Zustand
- Tailwind token layer plus shared CSS tokens in `src/index.css`

### Runtime

- Web: Vite
- Mobile: Capacitor
- Preview host: GitHub Pages
- Intended production host: Vercel or similar server-backed runtime

### Cloud services

- Supabase for auth, relational data, storage, and workspace sync
- Stripe for subscription checkout and billing portal
- Open-Meteo for weather data

## Key folders

- `src/` — app UI, routes, state, and runtime helpers
- `api/` — server-backed endpoints that need a real host
- `supabase/` — production SQL bootstrap
- `tests/` — store and workflow tests
- `docs/` — roadmap, product notes, and this handoff

## Local runbook

### Install

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install
```

### Develop

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev
```

### Verify

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run test
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run test:e2e
```

## Environment setup

Use `.env.example` as the baseline. Keep real keys in `.env.local` only.

### Required for cloud auth and sync

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Important optional settings

- `VITE_ALLOW_LOCAL_MODE`
- `VITE_SUPABASE_RELATIONAL_SYNC`
- `VITE_SUPABASE_SNAPSHOT_FALLBACK`
- `VITE_SUPABASE_MEDIA_BUCKET`
- `VITE_SUPABASE_DOCUMENT_BUCKET`
- `VITE_API_BASE_URL`
- `VITE_RUNTIME_MONITORING_ENABLED`
- `VITE_PUBLIC_APP_URL`
- Stripe payment link vars

## Deployment reality

### Current public preview

- Hosted on GitHub Pages
- Useful for UI review only
- Not suitable for final production because it cannot run backend API routes

### Intended production deployment

1. Deploy web app to Vercel
2. Apply `supabase/production-schema.sql`
3. Configure production env vars
4. Point `VITE_PUBLIC_APP_URL` at the real host
5. Connect Stripe webhook endpoint to the deployed runtime
6. Verify auth, storage, share links, billing, and server routes end to end

## UX state at handoff

- Shell is lighter and cleaner than earlier dark-shell iterations
- Sidebar was simplified to remove nested workspace navigation
- Login is calmer and more minimal after rollback of the overdesigned legal-motion pass
- Dashboard, Horses, Documents, and Horse Detail still need one more cohesive premium-system pass for a truly market-leading finish

## Highest-priority next steps

1. Deploy to Vercel and confirm all `api/` routes work live
2. Apply Supabase production SQL and validate relational sync
3. Verify Stripe checkout, portal, and webhook reconciliation in a real environment
4. Tighten server-backed invite and shared-access enforcement
5. Improve OCR and entity extraction accuracy on real PDFs and images
6. Finish one final unified design pass across Dashboard, Horses, Horse Detail, and Documents

## Known repo notes

- The active repo lives at `C:\Users\Erin0\OneDrive\Documents\Playground\xbar-horse-management-app`
- An accidental parent Git repo in `Playground` was already removed
- Pushes should always happen from the XBAR repo directory, not the parent folder

## Handoff summary

This repo is now on the right architecture path: web first, mobile-capable, backend-capable, and no longer centered on a dead desktop wrapper. The biggest remaining gap is not code organization, it is final deployment and live-service validation.

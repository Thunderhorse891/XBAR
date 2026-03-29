# XBAR Horse Management App

Horse records and ranch operations workspace built with React, TypeScript, Zustand, and Tauri.

## Getting Started

1. Clone the repo:
   ```
   git clone https://github.com/Thunderhorse891/xbar-horse-management-app.git
   cd xbar-horse-management-app
   ```

2. Run setup (installs all prerequisites and dependencies):
   ```powershell
   ./setup.ps1
   ```

## Build Scripts

| Script | Description |
|---|---|
| `scripts/download-and-install.ps1` | Downloads and runs the latest installer from GitHub Releases |
| `scripts/local-build.ps1` | Builds the app locally from source |
| `build.ps1` | Full production build script |

## GitHub Actions

Builds automatically trigger on every push to `main` and produce a Windows installer.

[Download Latest Build](https://github.com/Thunderhorse891/xbar-horse-management-app/releases)

## Windows Installation Guide

1. Run `scripts/download-and-install.ps1`
2. Follow the installer prompts
3. App will appear in the System Tray

## Development

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run tauri dev
```

## Tech Stack

- **Frontend:** React 18, TypeScript, Zustand, React Router
- **Desktop:** Tauri v1 (Rust)
- **Persistence:** IndexedDB primary, localStorage fallback, local JSON backup/restore
- **Cloud Ready:** Supabase auth, storage, and workspace sync when env is configured
- **Billing Ready:** Stripe payment links when env is configured
- **Build:** Vite 5

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
- Supabase relational tables are now the primary runtime sync path; legacy snapshots remain an optional fallback for recovery
- Real media/document cloud storage is available when Supabase env is configured
- Facebook share posting is available when a Meta app ID is configured
- Real Stripe checkout entry points are available when Stripe payment-link env is configured
- Manual document intake and review queue
- Shared-link access for buyer and owner views
- Full multi-user relational workflows and automated billing reconciliation still need backend completion

## Cloud Runtime

- When `VITE_SUPABASE_RELATIONAL_SYNC=true`, the app saves horses, documents, intake batches, ownership records, leads, listings, subscription state, and workspace profile into the normalized Supabase tables in `supabase/production-schema.sql`.
- When `VITE_SUPABASE_SNAPSHOT_FALLBACK=true`, the app also writes a legacy `workspace_snapshots` record for recovery and backward compatibility.
- Workspace roles are resolved from `workspace_memberships` and owned `workspaces` before falling back to auth metadata.

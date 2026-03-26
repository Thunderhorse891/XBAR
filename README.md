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
- **Build:** Vite 5

## Current Product State

- Local-first workspace with IndexedDB persistence and manual backup import/export
- Manual document intake and review queue
- Shared-link access for buyer and owner views
- Billing, external auth, and shared backend services are not connected yet

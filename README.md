# XBAR Horse Management App

Desktop horse ranch management application built with Tauri + React + TypeScript.

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
npm install
npm run dev         # Start Vite dev server
npm run tauri dev   # Launch the Tauri desktop app
```

## Tech Stack

- **Frontend:** React 18, TypeScript, Tailwind CSS, Zustand, TanStack Table
- **Desktop:** Tauri v1 (Rust)
- **Database:** Local in-app data store
- **Build:** Vite 5

This app is offline-first. No cloud required.

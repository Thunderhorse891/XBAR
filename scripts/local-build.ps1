# Build XBAR app locally from source
$ErrorActionPreference = "Stop"

if (-not (Test-Path "./src-tauri")) {
    Write-Host "Error: Tauri project not found. Run from repo root." -ForegroundColor Red
    exit 1
}

Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install

Write-Host "Building web assets..." -ForegroundColor Yellow
npm run build

Write-Host "Building Tauri desktop app..." -ForegroundColor Yellow
cargo tauri build

$exePath = "src-tauri/target/release/bundle/nsis"
if (Test-Path $exePath) {
    Write-Host "Success! Installer in: $exePath" -ForegroundColor Green
} else {
    Write-Host "Build may have failed - check output above." -ForegroundColor Yellow
}

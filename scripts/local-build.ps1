# Build XBAR locally from source
$ErrorActionPreference = "Stop"

if (-not (Test-Path "./package.json")) {
    Write-Host "Error: package.json not found. Run from repo root." -ForegroundColor Red
    exit 1
}

Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install

Write-Host "Building web assets..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Web build failed - check output above." -ForegroundColor Red
    exit 1
}

Write-Host "Success! Web bundle in: dist/" -ForegroundColor Green
Write-Host "Optional next step: npm run mobile:sync after adding iOS or Android targets." -ForegroundColor Cyan

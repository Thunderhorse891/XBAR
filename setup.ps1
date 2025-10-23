Write-Host "Setting up XBAR Desktop App..." -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "\'n“ Node.js is required but not found." -ForegroundColor Red
  exit 1
}

Write-Host "\n\uubax - Installing dependencies..." -ForegroundColor Yellow
npm install

Write-Host "\n\uubax - Loading installed files..." -ForegroundColor Yellow
npm run build

Write-Host "\n\uubax - Launching application..." -ForegroundColor Green
npm run tauri

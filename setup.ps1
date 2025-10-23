Write-Host "🌘 Setting up XBAR Desktop App..." -ForegroundColor Cyan

# Check Node.js installation
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "⌘ Node.js is required but not found." -ForegroundColor Red
  exit 1
}

# Install dependencies
 Write-Host "📘 Installing dependencies..." -ForegroundColor Yellow
npm install

# Build the app in development mode
Write-Host "�❟❤ Launching the app..." -ForegroundColor Green
npm run tauri

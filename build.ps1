$ErrorActionPreference = "Stop"

Write-Host "🚀 Building XBAR web bundle..." -ForegroundColor Cyan

$requiredPaths = @("package.json", "src")
foreach ($path in $requiredPaths) {
    if (-not (Test-Path $path)) {
        Write-Host "❌ Missing required path: $path" -ForegroundColor Red
        exit 1
    }
}

Write-Host "✅ Project structure validated" -ForegroundColor Green

Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Dependency installation failed" -ForegroundColor Red
    exit 1
}

Write-Host "🌐 Building production web assets..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Web build failed" -ForegroundColor Red
    exit 1
}

Write-Host "📱 Capacitor sync is optional once iOS or Android targets are added." -ForegroundColor Yellow
Write-Host "✅ Build completed successfully!" -ForegroundColor Green
Write-Host "📁 Web bundle: dist/" -ForegroundColor Cyan
exit 0

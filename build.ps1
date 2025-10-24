$ErrorActionPreference = "Stop"

Write-Host "🚀 Building XBAR Horse Tracker Desktop App..." -ForegroundColor Cyan

# Validate project structure
$requiredPaths = @("src-tauri", "package.json", "src")
foreach ($path in $requiredPaths) {
    if (-not (Test-Path $path)) {
        Write-Host "❌ Missing required path: $path" -ForegroundColor Red
        exit 1
    }
}

Write-Host "✅ Project structure validated" -ForegroundColor Green

# Build process
Write-Host "📦 Building web assets..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Web build failed" -ForegroundColor Red
    exit 1
}

Write-Host "🖥️  Building desktop application..." -ForegroundColor Yellow
npm run tauri build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Tauri build failed" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Build completed successfully!" -ForegroundColor Green
Write-Host "📁 Installer: src-tauri/target/release/bundle/" -ForegroundColor Cyan
exit 0

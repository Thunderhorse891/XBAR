$ErrorActionPreference = "Stop"

Write-Host "🚀 Setting up XBAR Horse Tracker..." -ForegroundColor Cyan

# Check prerequisites
$requirements = @(
    @{Name="Node.js"; Command="node --version"; Install="https://nodejs.org/"},
    @{Name="Rust"; Command="cargo --version"; Install="winget install Rustlang.Rust"},
    @{Name="pnpm"; Command="pnpm --version"; Install="npm install -g pnpm"}
)

foreach ($req in $requirements) {
    try {
        $null = Invoke-Expression $req.Command 2>$null
        Write-Host "✅ $($req.Name) found" -ForegroundColor Green
    } catch {
        Write-Host "❌ $($req.Name) is required but not found." -ForegroundColor Red
        Write-Host "   Install with: $($req.Install)" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "✅ All prerequisites found!" -ForegroundColor Green

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
pnpm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Dependency installation failed" -ForegroundColor Red
    exit 1
}

# Install Tauri CLI
Write-Host "🔧 Installing Tauri CLI..." -ForegroundColor Yellow
cargo install tauri-cli

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Tauri CLI installation failed" -ForegroundColor Red
    exit 1
}

# Launch development mode
Write-Host "🎯 Starting development server..." -ForegroundColor Green
cargo tauri dev

$ErrorActionPreference = "Stop"

Write-Host "🚀 Setting up XBAR Horse Tracker..." -ForegroundColor Cyan

# Check prerequisites
$requirements = @(
    @{Name="Node.js"; Command="node"; Install="https://nodejs.org/"},
    @{Name="Rust"; Command="rustc"; Install="winget install Rustlang.Rust"},
    @{Name="pnpm"; Command="pnpm"; Install="npm install -g pnpm"}
)

foreach ($req in $requirements) {
    if (-not (Get-Command $req.Command -ErrorAction SilentlyContinue)) {
        Write-Host "❌ $($req.Name) is required but not found." -ForegroundColor Red
        Write-Host "   Install with: $($req.Install)" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "✅ All prerequisites found!" -ForegroundColor Green

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
pnpm install

# Launch development mode
Write-Host "🎯 Starting development server..." -ForegroundColor Green
pnpm tauri dev

$ErrorActionPreference = "Stop"

Write-Host "🚀 Setting up XBAR web + mobile workspace..." -ForegroundColor Cyan

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Write-Host "❌ Node.js is required but not found." -ForegroundColor Red
    Write-Host "   Install with: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

$nodeDir = Split-Path -Parent $nodeCommand.Source
$npmCommand = Join-Path $nodeDir "npm.cmd"
if (-not (Test-Path $npmCommand)) {
    $npmCommand = "npm"
}

$requirements = @(
    @{Name="Node.js"; Command={ & $nodeCommand.Source --version }; Install="https://nodejs.org/"},
    @{Name="npm"; Command={ & $npmCommand --version }; Install="Install Node.js from https://nodejs.org/"}
)

foreach ($req in $requirements) {
    try {
        $null = & $req.Command 2>$null
        Write-Host "✅ $($req.Name) found" -ForegroundColor Green
    } catch {
        Write-Host "❌ $($req.Name) is required but not found." -ForegroundColor Red
        Write-Host "   Install with: $($req.Install)" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "✅ Core web prerequisites found!" -ForegroundColor Green

Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
& $npmCommand install

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Dependency installation failed" -ForegroundColor Red
    exit 1
}

Write-Host "🌐 Starting web development server..." -ForegroundColor Green
& $npmCommand run dev

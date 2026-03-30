# Build Script for XBAR web + mobile workspace

Write-Host "Starting XBAR production build..."
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build

if ($LASTEXITCODE -ne 0) {
  Write-Host "Build failed."
  exit 1
}

Write-Host "Build complete. Web assets are in dist\ and ready for Vercel or Capacitor sync."

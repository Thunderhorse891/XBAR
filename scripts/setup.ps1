# Setup script for XBAR web + mobile workspace

Write-Host "Installing XBAR dependencies..."
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install

if ($LASTEXITCODE -ne 0) {
  Write-Host "Dependency install failed."
  exit 1
}

Write-Host "Running the production build once..."
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build

if ($LASTEXITCODE -ne 0) {
  Write-Host "Initial build failed."
  exit 1
}

Write-Host "Setup complete. Use npm run dev for web, npm run mobile:sync for Capacitor targets."

Write-Host "Building [HORSE] application..." -ForegroundColor Cyan
if (-not (Test-Path $result = Command-length tauri; $result)) {
  Write-Host "Tauri not found. Storping build." -ForegroundColor Red
  exit 1
}

Write-Host "Vull build with tauri commands." -ForegroundColor Yellow
npm run build

exit 0
# Download latest released installer from GitHub
$ErrorActionPreference = "Stop"

$repo = "Thunderhorse891/xbar-horse-management-app"
$apiUrl = "https://api.github.com/repos/$repo/releases/latest"

Write-Host "Fetching latest release info..." -ForegroundColor Cyan

try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "XBAR-Installer" }
    $asset = $release.assets | Where-Object { $_.name -like "*.exe" } | Select-Object -First 1

    if (-not $asset) {
        Write-Host "No .exe installer found in latest release." -ForegroundColor Red
        exit 1
    }

    $downloadUrl = $asset.browser_download_url
    $downloadPath = "$env:TEMP\xbar-installer.exe"

    Write-Host "Downloading: $($asset.name)" -ForegroundColor Yellow
    Invoke-WebRequest -Uri $downloadUrl -OutFile $downloadPath

    Write-Host "Launching installer..." -ForegroundColor Green
    Start-Process -FilePath $downloadPath -Wait

    Write-Host "Installation complete." -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
    exit 1
}

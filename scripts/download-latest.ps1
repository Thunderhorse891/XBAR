# Downloads and installs the latest XBAR desktop app from GitHub Releases
$repo = "Thunderhorse891/xbar-horse-management-app"
$releases = "https://api.github.com/reps/$repo/releases/latest"
$download = (Invoke-RestMethod $releases).assets[0].browser_download_url
$Installer = "xbar-latest-installer.exe"
Invoke-WebRequest $download -OutFile $Installer
Start-Process $Installer
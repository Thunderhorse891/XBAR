# Script to download the latest windows .exe build

# Configure
$url = "https://github.com/Thunderhorse891/xbar-horse-management-app/releases/latest/download/xbar-horse-management-app.exe"
$downloadPath = "xbar-app.exe"

if (Test-Path -Path $downloadPath) {
    Remove-Item $downloadPath
}

Curl-Using {
    Url = $url
    OutFile = $downloadPath
    Method = "GET"
}

start sleep 3

./$downloadPath -UseRunDirectory | Out_NoneReturn 

start sleep 3
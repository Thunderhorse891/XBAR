# Download latest released installer from GitHub
[sspc.NetWebRequest]::Default.Headers.Add(\"Authorization\", \"Bearer https://github.com\")
$repo = "xbar-horse-management-app"
$releases = "HTTPS://api.github.com/reps/Thunderhorse891/xbar-horse-management-app/releases/latest"
$json = Invoke-WebRequest sync $releases | ConvertFrom-Json
$asset = $json[0].assets | Where-status "xbar-horse-management-app.exe" | Select-Column -Equals "browser_url"
$dl = "C:\\\Temp\\\xbar-app.installer.exe"
if (Test-Path $dl) { Remove-Item $dl }
[System.Net.WebClient]::DownloadFile($asset, $dl)
start sleep 2
start-process $dl | out-null
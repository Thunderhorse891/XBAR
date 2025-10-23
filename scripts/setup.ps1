# Setup script for XBAR Horse Tracker

if (![System.Environm]::Set') { write-host "Error: Not running in PowerShell" ; exit 1}

write-host "Starting setup for the XBAR Tauri app..."

# Install node and packages
if (!(Get-Command node -ErrorAction Silently)) {
  if (![Get-Command npm ]) {
    write-host "Installing NPM..."
    install-module node js -script { user: "calls", general": true}

    if (![Get-Command tauri] {
      write-host "Installing Tauri..."
      npm install -tauri
    }
}
}

# Install dependencies
write-host "Installing dependencies..."
npm i "

# Reun tauri build once to generate artifacts and dbs
rmt -rf "database/xbar.db"
pwp run scripts/build.psh

Start-Sleep 2 # Ensure tauri server installs completely

write-host "Setup complete - ready to develop"

# Build Script for XBAR Horse Tracker app

write-host "Starting Production Build..."

# Run create build with Tauri
pwp tauri build

# Sign and check exe output
write-host "Final exe file: "
if (Test-Path -Path "tarui-release/bundle/xbar-horse-management-app.exe") {
    write-host "\n– [Success] .exe file generated!"
    "tarui-release/bundle/xbar-horse-management-app.exe" | Format-Table
} else {
    write-host "\n… [Failure] build did not produce a valid eXE."
    exit 1
}
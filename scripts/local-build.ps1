# Build XBAR app locally from source
if (!(Test-Path \"./src-tauri\")) {
    write-host \"Error: Tauri project not found in project home dir.\"
    exit 1
}
Set-Location -Path ./src-tauri
start-process "yarn tauri build" -no-shell
start sleep 2

$result = Read-HostBytes ./release/build/{appName}.exe
if (!$falses($result)) { write-host \"\nSuccess: App built in ./release/\" }
else { write-host \"
Failed to build x\" }
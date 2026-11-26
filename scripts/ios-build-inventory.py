"""Read the compiled .app's identity, privacy resources and SDK linkage; no signing."""

import hashlib
import json
from pathlib import Path
import plistlib
import re
import subprocess
import sys


root = Path(sys.argv[1]).resolve(strict=True)
with (root / "Info.plist").open("rb") as source:
    info = plistlib.load(source)
with (root / "capacitor.config.json").open() as source:
    config = json.load(source)
binary = root / info["CFBundleExecutable"]
assert info["CFBundleIdentifier"] == "com.xbar.ranch"
assert not config.get("server", {}).get("url"), "Inventory must inspect a bundled app"

manifests = []
for file in sorted(root.rglob("PrivacyInfo.xcprivacy")):
    with file.open("rb") as source:
        manifests.append({"path": str(file.relative_to(root)), "manifest": plistlib.load(source)})

libraries = subprocess.run(
    ["xcrun", "otool", "-L", str(binary)], capture_output=True, text=True, check=True, timeout=30
).stdout.splitlines()[1:]
symbols = subprocess.run(
    ["xcrun", "nm", "-jgU", str(binary)], capture_output=True, text=True, check=True, timeout=30
).stdout.splitlines()
sdk_pattern = re.compile(r"GoogleAuth|GoogleSignIn|GIDSignIn|Codetrix|FilesystemPlugin|IONFilesystem|SharePlugin", re.I)
sdk_symbols = sorted(set(line for line in symbols if sdk_pattern.search(line)))

print(json.dumps({
    "bundleId": info["CFBundleIdentifier"],
    "version": info["CFBundleShortVersionString"],
    "build": info["CFBundleVersion"],
    "binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
    "capacitorPluginClasses": config.get("packageClassList", []),
    "frameworks": sorted(str(p.relative_to(root)) for p in root.rglob("*.framework")),
    "linkedLibraries": [line.strip() for line in libraries],
    "matchingSdkSymbols": sdk_symbols,
    "googleAuthEvidenceFound": any(re.search(r"GoogleAuth|GoogleSignIn|GIDSignIn|Codetrix", s, re.I)
                                   for s in sdk_symbols + config.get("packageClassList", []) + libraries
                                   + [str(p.relative_to(root)) for p in root.rglob("*.framework")]),
    "privacyManifests": manifests,
    "scope": "Compiled unsigned app inventory; not a signed archive privacy report or App Store labels approval",
}, indent=2))

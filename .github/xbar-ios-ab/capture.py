"""Read only validated schema records, never print raw console or app data."""
import json
import os
import re
import sys

device = os.environ.get("IOS_SIMULATOR_ID")
if not device:
    print("No simulator selected; startup markers unavailable.")
    sys.exit(0)

phases = {"native-document-start", "html-script", "script-error", "resource-error", "unhandled-rejection",
          "dom-ready", "root-missing", "root-populated", "root-still-empty"}
errors = {"Error", "TypeError", "SyntaxError", "ReferenceError", "RangeError",
          "SecurityError", "NetworkError", "AbortError"}
asset = re.compile(r"[A-Za-z0-9_-]{1,96}\.(?:js|css)(?::\d{1,7}:\d{1,7})?")
seen = set()

def consume(data):
    if isinstance(data, bytes):
        data = data.decode(errors="replace")
    for match in re.finditer(r"XBAR_BOOT (\{[^\r\n]{1,220}?\})", data or ""):
        try:
            rec = json.loads(match.group(1))
        except ValueError:
            continue
        if not isinstance(rec, dict) or set(rec) != {"phase", "kind", "asset"}:
            continue
        if not isinstance(rec["phase"], str) or rec["phase"] not in phases:
            continue
        if rec["kind"] is not None and not (isinstance(rec["kind"], str) and rec["kind"] in errors):
            continue
        if rec["asset"] is not None and not (isinstance(rec["asset"], str) and asset.fullmatch(rec["asset"])):
            continue
        normalized = json.dumps(rec, sort_keys=True)
        if normalized not in seen and len(seen) < 12:
            seen.add(normalized)
            print("XBAR_BOOT " + normalized, flush=True)

from pathlib import Path

path = Path(os.environ["RUNNER_TEMP"]) / "xbar-first-launch.log"
if path.is_file():
    with path.open("rb") as stream:
        consume(stream.read(131072))
if not seen:
    print("No validated first-launch markers; results remain inconclusive.")

"""Read only validated schema records, never print raw console or app data."""
import json
import os
import re
import sys

device = os.environ.get("IOS_SIMULATOR_ID")
if not device:
    print("No simulator selected; startup markers unavailable.")
    sys.exit(0)

summary_pattern = re.compile(r"(local|about|other)(-[01]){5}-(none|script|module|rejection)")
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
        if rec["phase"] != "lifecycle-summary" or rec["kind"] is not None:
            continue
        if not isinstance(rec["asset"], str) or not summary_pattern.fullmatch(rec["asset"]):
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

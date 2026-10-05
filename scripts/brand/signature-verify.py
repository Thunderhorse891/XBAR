#!/usr/bin/env python3
"""Verify signature asset invariants using Python, Pillow, and NumPy."""
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / 'public/brand'
g = json.loads((BRAND / 'xbar-signature-paths.json').read_text())
assert g['viewBox'] == '0 0 1672 941'
assert g['compactViewBox'] == '330 100 1170 760'
assert len(g['paths']) == 21
assert len(g['compactPaths']) == 9
assert len({p['id'] for p in g['paths']}) == len(g['paths'])
for name, expected in {
    'xbar-report-horse.png': '8a8cc3c6215d2b2f45f260ff3d26848313391fab605799321f11eb9f8503eb54',
    'xbar-horse-outline-safe.png': '66c6710e8ba1428923a60cae5f15101cfa4a4b0e489990c8f4f04fc9a7cb17ac',
    'xbar-report-watermark.png': 'd3d9404d7d9c6c8a8187bb29b590ae76ae2b4926f73212aea09462c776264201',
}.items():
    assert hashlib.sha256((BRAND/name).read_bytes()).hexdigest() == expected, name
for name in ('xbar-signature-horse.svg', 'xbar-signature-horse-small.svg', 'xbar-signature-horse-dark.svg', 'xbar-signature-report-overlay.svg', 'xbar-signature-icon.svg', 'xbar-signature-horse-silhouette.svg'):
    raw = (BRAND/name).read_text()
    assert '<image' not in raw and 'base64' not in raw
    root = ET.fromstring(raw)
    paths = [p.attrib['d'] for p in root.iter('{http://www.w3.org/2000/svg}path')]
    compact = name not in ('xbar-signature-horse.svg', 'xbar-signature-report-overlay.svg')
    assert paths == [p['d'] for p in g['compactPaths' if compact else 'paths']], name
for name in BRAND.glob('xbar-signature-*.png'):
    side = int(name.stem.split('-')[-1])
    im = Image.open(name)
    assert im.size == (side,side), name
    assert im.mode == 'RGB' or im.getchannel('A').getextrema() == (255,255), name
mask = np.array(Image.open(BRAND/'xbar-signature-horse-maskable-512.png').convert('RGB')).astype(int)
ys,xs = np.where(np.max(np.abs(mask-np.array([32,45,60])),axis=2)>12)
radius = float(np.sqrt((xs-255.5)**2+(ys-255.5)**2).max())
assert radius <= 204.8, radius
print(json.dumps({'sourceHashes':'unchanged','pathParity':'passed','realVectorPaths':len(g['paths']),'filledCompactPaths':len(g['compactPaths']),'PNGDimensionsAndOpacity':'passed','maskableMaxRadiusPx':radius,'maskableSafeRadiusPx':204.8,'status':'local geometry verification; owner visual approval pending'},indent=2))

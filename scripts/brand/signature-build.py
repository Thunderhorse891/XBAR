#!/usr/bin/env python3
"""Generate review-only SVG and PNG exports from the one signature geometry JSON.

Install CairoSVG into a temporary environment (never the app dependency tree).
Run: PYTHONPATH=/tmp/xbar-signature-tools python scripts/brand/signature-build.py
All source image files are read-only. PNGs are direct renders of the same SVG
paths. The compact composition changes only the viewBox, never the coordinates.
"""
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/brand'
GEOMETRY = json.loads((OUT / 'xbar-signature-paths.json').read_text())
SOURCE = ROOT / 'public' / GEOMETRY['source']['file'].lstrip('/')
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == GEOMETRY['source']['sha256'], 'Master changed; review the trace before rebuilding.'


def svg(stroke='#D6DDE5', width=5, compact=True, small=False, background=None):
    box = GEOMETRY['compactViewBox'] if compact else GEOMETRY['viewBox']
    paths = [p for p in GEOMETRY['paths'] if not (small and p['detail'])]
    markup = '\n'.join(f'    <path id="signature-{p["id"]}" d="{p["d"]}" pathLength="1" />' for p in paths)
    rect = ''
    if background:
        x, y, w, h = box.split()
        rect = f'  <rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{background}" />\n'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" fill="none" role="img" aria-labelledby="signature-title signature-desc">
  <title id="signature-title">XBAR horse signature</title>
  <desc id="signature-desc">Static source-coordinate outline of the supplied XBAR report horse. Draft derivative pending owner visual approval.</desc>
{rect}  <g stroke="{stroke}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round">
{markup}
  </g>
</svg>
'''

def compact_svg(stroke='#D6DDE5'):
    markup = '\n'.join(f'  <path id="compact-{p["id"]}" d="{p["d"]}" fill-rule="{p["fillRule"]}" />' for p in GEOMETRY['compactPaths'])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{GEOMETRY['compactViewBox']}" fill="{stroke}" role="img" aria-labelledby="compact-title compact-desc">
  <title id="compact-title">XBAR horse signature</title>
  <desc id="compact-desc">Filled small-size derivative of the source-coordinate XBAR horse profile. Draft for owner visual approval.</desc>
{markup}
</svg>
'''


def square_svg(side, margin, background, stroke, width=None, small=False):
    # Small icons use filled corresponding contour ribbons from compactPaths.
    # The detailed source-coordinate trace remains separately in paths[].
    x, y, w, h = map(float, GEOMETRY['compactViewBox'].split())
    scale = side * (1 - margin * 2) / w
    tx = (side - w * scale) / 2 - x * scale
    ty = (side - h * scale) / 2 - y * scale
    markup = '\n'.join(f'    <path d="{p["d"]}" fill-rule="{p["fillRule"]}" />' for p in GEOMETRY['compactPaths'])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}" fill="none">
  <title>XBAR horse signature</title>
  <rect width="{side}" height="{side}" fill="{background}" />
  <g transform="translate({tx} {ty}) scale({scale})" fill="{stroke}">
{markup}
  </g>
</svg>
'''


def main():
    variants = {
        'xbar-signature-horse.svg': svg(),
        'xbar-signature-horse-small.svg': compact_svg(),
        'xbar-signature-horse-dark.svg': compact_svg(stroke='#202D3C'),
        'xbar-signature-horse-silhouette.svg': compact_svg(),
        'xbar-signature-report-overlay.svg': svg(width=3, compact=False),
        'xbar-signature-icon.svg': square_svg(512, .04, '#171B20', '#D6DDE5', 26, small=True),
    }
    for name, data in variants.items():
        ET.fromstring(data)
        assert '<image' not in data and 'base64' not in data
        (OUT / name).write_text(data)

    try:
        import cairosvg
    except ImportError as error:
        raise SystemExit('SVGs generated. Install CairoSVG in a temporary environment for PNGs.') from error

    for side in (16, 32, 64, 180, 192, 512):
        width = 28 if side == 32 else (20 if side <= 192 else 10)
        data = square_svg(side, .04, '#171B20', '#D6DDE5', width, small=side <= 64)
        cairosvg.svg2png(bytestring=data.encode(), write_to=str(OUT / f'xbar-signature-horse-{side}.png'), output_width=side, output_height=side)
    for name, side, data in (
        ('xbar-signature-email-192.png', 192, square_svg(192, .06, '#202D3C', '#D6DDE5', 16)),
        ('xbar-signature-print-512.png', 512, square_svg(512, .04, '#FFFFFF', '#202D3C', 9)),
        ('xbar-signature-horse-maskable-512.png', 512, square_svg(512, .18, '#202D3C', '#D6DDE5', 16)),
    ):
        cairosvg.svg2png(bytestring=data.encode(),write_to=str(OUT/name),output_width=side,output_height=side)
    print(f'Generated {len(variants)} real SVGs and 9 PNGs from {len(GEOMETRY["paths"])} detailed paths and {len(GEOMETRY["compactPaths"])} corresponding filled contour pieces.')


if __name__ == '__main__':
    main()

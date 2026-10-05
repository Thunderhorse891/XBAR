#!/usr/bin/env python3
"""Resize the complete owner-selected original B; never trace, crop or recolour it.

Requires Pillow in the tooling environment, not the app dependency tree.
Run with --verify to check existing exports without writing them.
"""
import argparse
import hashlib
import math
import re
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/brand'
SOURCE = OUT / 'xbar-report-horse.png'
MASTER_SHA256 = '8a8cc3c6215d2b2f45f260ff3d26848313391fab605799321f11eb9f8503eb54'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == MASTER_SHA256, 'Original B master changed'
master = Image.open(SOURCE).convert('RGB')
assert master.size == (1672, 941)
tokens = (OUT / 'xbar-brand-tokens.css').read_text()
silver = re.search(r'--xbar-silver:\s*(#[\da-fA-F]{6})', tokens).group(1)


def resized(width):
    return master.resize((width, round(width * 941 / 1672)), Image.Resampling.LANCZOS)


def exports():
    yield 'xbar-original-lockup-480.png', resized(480)
    for side in (32, 64, 180, 192, 512, 1024):
        width = side if side == 32 else round(side * .92)
        art = resized(width)
        canvas = Image.new('RGB', (side, side), silver)
        canvas.paste(art, ((side - art.width) // 2, (side - art.height) // 2))
        yield f'xbar-original-icon-{side}.png', canvas
    side = 512
    art = resized(round(side * .64))
    # Every corner of the full lockup stays within Android's 80% safe circle.
    assert math.hypot(art.width / 2, art.height / 2) < side * .4
    canvas = Image.new('RGB', (side, side), silver)
    canvas.paste(art, ((side - art.width) // 2, (side - art.height) // 2))
    yield 'xbar-original-icon-maskable-512.png', canvas


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    for name, expected in exports():
        target = OUT / name
        if args.verify:
            actual = Image.open(target).convert('RGB')
            assert actual.size == expected.size, f'{name}: wrong dimensions'
            assert ImageChops.difference(actual, expected).getbbox() is None, f'{name}: original pixels differ'
        else:
            expected.save(target)
        print(('Verified ' if args.verify else 'Wrote ') + name)

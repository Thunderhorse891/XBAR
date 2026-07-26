#!/usr/bin/env node
// Build the iOS app-icon assets that App Store Connect will actually accept.
//
//   node scripts/build-ios-assets.mjs
//
// Apple rejects an app icon PNG that carries an alpha channel — including one
// that is fully opaque — with "Invalid large app icon. The large app icon in
// the asset catalog can't be transparent nor contain an alpha channel."
// public/brand/xbar-app-icon.png is a 1024x1024 RGBA file, so it cannot ship
// as-is. This flattens it onto the brand launch colour and re-encodes it
// without the alpha channel, then writes a drag-and-drop asset catalogue.
//
// Output: ios-submission/AppIcon.appiconset/  (Contents.json + icon-1024.png)
// Drag that folder into Assets.xcassets in Xcode, or copy it over the
// AppIcon.appiconset that `npx cap add ios` generates.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodeRgbPng, flattenOntoBackground, hasAlphaChannel, resizeRgb } from './lib/png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const SOURCE = path.join(repoRoot, 'public', 'brand', 'xbar-app-icon.png');
const OUT_DIR = path.join(repoRoot, 'ios-submission', 'AppIcon.appiconset');

// Keep in sync with capacitor.config.ts ios.backgroundColor and the
// theme_color in public/site.webmanifest.
const LAUNCH_BACKGROUND = { r: 0x05, g: 0x07, b: 0x0a };

/**
 * Xcode 14+ takes a single 1024x1024 icon and derives every other size. The
 * marketing icon is the one Apple validates on upload, so that is the one this
 * script guarantees is alpha-free.
 */
const ICON_SIZE = 1024;

function log(message) {
  console.log(`[ios-assets] ${message}`);
}

const sourceBuffer = readFileSync(SOURCE);
const source = decodePng(sourceBuffer);

if (source.width !== source.height) {
  throw new Error(`app icon must be square, got ${source.width}x${source.height}`);
}
if (source.width < ICON_SIZE) {
  throw new Error(
    `app icon master must be at least ${ICON_SIZE}px, got ${source.width}px — Apple will reject an upscale`,
  );
}

log(
  `source ${path.relative(repoRoot, SOURCE)} ${source.width}x${source.height} (alpha: ${hasAlphaChannel(sourceBuffer) ? 'yes' : 'no'})`,
);

const flattened = flattenOntoBackground(source, LAUNCH_BACKGROUND);
const icon = flattened.width === ICON_SIZE ? flattened : resizeRgb(flattened, ICON_SIZE, ICON_SIZE);
const encoded = encodeRgbPng(icon);

if (hasAlphaChannel(encoded)) {
  throw new Error('encoded icon still reports an alpha channel — refusing to write a file Apple will reject');
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, 'icon-1024.png'), encoded);

const contents = {
  images: [
    {
      filename: 'icon-1024.png',
      idiom: 'universal',
      platform: 'ios',
      size: `${ICON_SIZE}x${ICON_SIZE}`,
    },
  ],
  info: { author: 'xcode', version: 1 },
};

writeFileSync(path.join(OUT_DIR, 'Contents.json'), `${JSON.stringify(contents, null, 2)}\n`);

log(`wrote ${path.relative(repoRoot, OUT_DIR)}/icon-1024.png (${ICON_SIZE}x${ICON_SIZE}, no alpha channel)`);
log(`wrote ${path.relative(repoRoot, OUT_DIR)}/Contents.json`);

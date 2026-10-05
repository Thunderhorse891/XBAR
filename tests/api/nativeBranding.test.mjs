import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const master = new URL('../../public/brand/xbar-report-horse.png', import.meta.url);
const canonical = new URL('../../public/brand/xbar-original-icon-1024.png', import.meta.url);
const iconSet = new URL('../../ios/App/App/Assets.xcassets/AppIcon.appiconset/', import.meta.url);

test('the native icon preserves the owner-selected original horse master', () => {
  assert.equal(
    createHash('sha256').update(readFileSync(master)).digest('hex'),
    '8a8cc3c6215d2b2f45f260ff3d26848313391fab605799321f11eb9f8503eb54',
    'The supplied original B master must remain unchanged',
  );
  const catalog = JSON.parse(readFileSync(new URL('Contents.json', iconSet), 'utf8'));
  assert.equal(catalog.images.length, 1);
  const icon = catalog.images[0];
  assert.equal(icon.idiom, 'universal');
  assert.equal(icon.platform, 'ios');
  assert.equal(icon.size, '1024x1024');
  assert.ok(
    readFileSync(new URL(icon.filename, iconSet)).equals(readFileSync(canonical)),
    'The bundled native icon must be the canonical original-horse export, not the retired X icon',
  );
});

test('the App Store icon is a full-size opaque RGB PNG', () => {
  const png = readFileSync(canonical);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  assert.equal(png[24], 8, 'Use 8-bit channels');
  assert.equal(png[25], 2, 'Use opaque RGB with no alpha channel');
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    assert.ok(offset + 12 + length <= png.length, 'PNG chunks must be complete');
    assert.notEqual(png.toString('ascii', offset + 4, offset + 8), 'tRNS', 'Do not use keyed transparency');
    offset += 12 + length;
  }
});

test('the native launch background matches the configured WebView background', () => {
  const config = readFileSync('capacitor.config.ts', 'utf8');
  const configured = config.match(/ios:\s*\{[\s\S]*?backgroundColor:\s*'(#[0-9a-f]{6})'/i)?.[1];
  assert.ok(configured, 'The native WebView background must remain explicit');
  const launch = readFileSync('ios/App/App/Base.lproj/LaunchScreen.storyboard', 'utf8');
  const color = launch.match(/<color key="backgroundColor"[^>]*\/>/)?.[0];
  assert.ok(color);
  assert.doesNotMatch(color, /systemColor=/, 'System light mode must not introduce a white launch frame');
  const rgb = ['red', 'green', 'blue'].map((channel) => {
    const value = color.match(new RegExp(`${channel}="([0-9.]+)"`))?.[1];
    assert.ok(value, `Missing ${channel} channel`);
    return Math.round(Number(value) * 255)
      .toString(16)
      .padStart(2, '0');
  });
  assert.equal(`#${rgb.join('')}`, configured.toLowerCase());
});

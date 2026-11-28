import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { iconAssets, iconUrls } from '../../scripts/brand/icon-assets.mjs';
import { marketingPages } from '../../scripts/marketing/pages.mjs';
import { renderPage } from '../../scripts/marketing/render.mjs';

const expectedSource = '43b7b697184aaa4906f39df66698f2154b8a60b6606320557d1d011018334e98';
const root = 'public/brand/icons/original-blue-20261127-v2/';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('only the approved brighter original supplies every exported icon', () => {
  const manifest = JSON.parse(readFileSync(root + 'source.json', 'utf8'));
  assert.equal(manifest.approvedSourceSha256, expectedSource);
  assert.equal(iconAssets.approvedSourceSha256, expectedSource);
  assert.equal(sha(readFileSync(root + 'icon-1024.png')), expectedSource);
  for (const file of manifest.files) {
    const bytes = readFileSync(root + file.file);
    assert.equal(sha(bytes), file.sha256);
    assert.equal(bytes.readUInt32BE(16), file.width);
    assert.equal(bytes.readUInt32BE(20), file.height);
    if (file.file !== 'icon-1024.png') assert.equal(bytes[25], 2, 'derived RGB PNGs have no alpha');
  }
});

test('app and all public heads use the revisioned Apple and browser icons', () => {
  const urls = iconUrls();
  const spa = readFileSync('index.html', 'utf8').replaceAll('%BASE_URL%', '/');
  for (const html of [spa, ...marketingPages.map(renderPage)]) {
    assert.ok(html.includes(`href="${urls.appleTouch}"`));
    assert.ok(html.includes(`href="${urls.favicon}"`));
    assert.ok(html.includes(`href="${urls.favicon16}"`));
    assert.match(html, /rel="apple-touch-icon" sizes="180x180"/);
    assert.match(html, /rel="manifest" href="\/site.webmanifest"/);
    assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
    assert.match(html, /name="apple-mobile-web-app-title" content="XBAR"/);
  }
  const manifest = JSON.parse(readFileSync('public/site.webmanifest', 'utf8'));
  for (const [key, value] of Object.entries(iconAssets.installIdentity)) assert.equal(manifest[key], value);
  assert.deepEqual(
    manifest.icons.map((icon) => icon.src),
    [urls.normal192, urls.normal512, urls.maskable512],
  );
  assert.equal(manifest.display, 'standalone');
  assert.equal(iconAssets.native.changed, false);
});

test('Safari conventional root icons are byte-identical to the approved Apple icon', () => {
  const approved = readFileSync(`public${iconUrls().appleTouch}`);
  for (const path of ['public/apple-touch-icon.png', 'public/apple-touch-icon-precomposed.png']) {
    assert.deepEqual(readFileSync(path), approved);
  }
});

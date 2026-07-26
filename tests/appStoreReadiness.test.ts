import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Submission guards. These assert against the files that actually get shipped
// or uploaded, so a later change that quietly reintroduces an App Review
// blocker fails here instead of in App Store Connect.

const repoRoot = process.cwd();
const submissionDir = path.join(repoRoot, 'ios-submission');

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Guideline 3.1.1: the billing route hard-stops checkout in the native shell', () => {
  const source = readRepoFile('src/routes/Subscriptions.tsx');

  assert.match(
    source,
    /const purchaseBlockedInApp = isExternalPurchaseBlocked\(\);/,
    'Subscriptions must read the platform purchase gate',
  );
  // Hiding the button is not enough — the handler itself must refuse.
  assert.match(
    source,
    /const beginCheckout = async \(tier: SubscriptionTier\) => \{\s*(\/\/[^\n]*\n\s*)*if \(purchaseBlockedInApp\) \{\s*return;/,
    'beginCheckout must return early when in-app purchase is blocked',
  );
  // Every readiness call has to carry the flag, or one card keeps a buy button.
  const readinessCalls = source.match(/getCheckoutReadiness\(\{/g) ?? [];
  const flagged = source.match(/purchaseBlockedInApp,/g) ?? [];
  assert.ok(readinessCalls.length > 0, 'expected getCheckoutReadiness to be used');
  assert.equal(flagged.length, readinessCalls.length, 'every getCheckoutReadiness call must pass purchaseBlockedInApp');
});

test('the sign-in screen hides the marketing pricing link in the native shell', () => {
  const source = readRepoFile('src/routes/Login.tsx');
  assert.match(
    source,
    /purchaseBlockedInApp \? null : <a href="\/pricing">/,
    '/pricing is not part of the native bundle and points at a purchase path',
  );
});

test('privacy policy and terms are reachable in the app without signing in', () => {
  const app = readRepoFile('src/App.tsx');
  const legalRouteIndex = app.indexOf('<Route path="/legal"');
  const authedShellIndex = app.indexOf('<RequireCloudAuth>');

  assert.ok(legalRouteIndex > 0, '/legal must be routed');
  assert.match(app, /<Route path="\/legal\/:documentId" element=\{<Legal \/>\} \/>/);
  assert.ok(
    legalRouteIndex < authedShellIndex,
    '/legal must be declared outside the authenticated shell so App Review can read it on a fresh install',
  );
});

test('both documents App Review looks for are rendered by the in-app reader', () => {
  const legal = readRepoFile('src/lib/legalDocuments.ts');
  for (const id of ['privacy', 'terms']) {
    assert.match(legal, new RegExp(`id: '${id}'`), `legal library must define the ${id} document`);
  }
  assert.match(readRepoFile('src/routes/Settings.tsx'), /to="\/legal\/privacy"/);
});

test('the legal document library stays importable by the Node marketing build', () => {
  // scripts/build-marketing.mjs imports this module directly under Node to
  // render /privacy and /terms. A DOM or Capacitor import here breaks the
  // production build, so the browser-only actions live in a separate module.
  const legal = readRepoFile('src/lib/legalDocuments.ts');
  assert.doesNotMatch(legal, /window\./, 'legalDocuments.ts must stay DOM-free');
  assert.doesNotMatch(legal, /fileDelivery/, 'legalDocuments.ts must not pull in the Capacitor file layer');
});

test('the App Store icon has no alpha channel and is 1024x1024', () => {
  const iconPath = path.join(submissionDir, 'AppIcon.appiconset', 'icon-1024.png');
  assert.ok(existsSync(iconPath), 'run `npm run ios:assets` to generate the App Store icon');

  const png = readFileSync(iconPath);
  assert.equal(png.readUInt32BE(16), 1024, 'icon width');
  assert.equal(png.readUInt32BE(20), 1024, 'icon height');
  // IHDR colour type byte: 2 = truecolour without alpha. Apple rejects 4 and 6.
  assert.equal(png[25], 2, 'Apple rejects an app icon PNG that carries an alpha channel');
});

test('every capability the code uses has an iOS purpose string', () => {
  const additions = readRepoFile('ios-submission/Info.plist.additions.plist');
  const required = [
    'NSCameraUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSPhotoLibraryAddUsageDescription',
    'NSLocationWhenInUseUsageDescription',
  ];

  for (const key of required) {
    assert.match(additions, new RegExp(`<key>${key}</key>`), `missing ${key}`);
  }

  // A purpose string that does not say why is the classic rejection.
  const strings = [...additions.matchAll(/<string>([^<]+)<\/string>/g)].map((match) => match[1]);
  for (const value of strings) {
    assert.ok(value.length > 30, `purpose string is too vague to pass review: "${value}"`);
  }
});

test('the geolocation purpose string still matches a real code path', () => {
  // If Weather stops asking for a position, the string must go: Apple rejects
  // a declared capability the app never uses.
  assert.match(readRepoFile('src/routes/Weather.tsx'), /geolocation\.getCurrentPosition/);
  assert.match(readRepoFile('src/routes/AnimalProfile.tsx'), /capture="environment"/);
});

test('the privacy manifest exists and declares no tracking', () => {
  const manifest = readRepoFile('ios-submission/PrivacyInfo.xcprivacy');
  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(manifest, /NSPrivacyCollectedDataTypeEmailAddress/);
});

test('the Capacitor bundle id and launch colour stay in sync with the icon build', () => {
  const config = readRepoFile('capacitor.config.ts');
  assert.match(config, /appId: 'com\.xbar\.ranch'/);
  assert.match(config, /backgroundColor: '#05070A'/);
  assert.match(
    readRepoFile('scripts/build-ios-assets.mjs'),
    /r: 0x05, g: 0x07, b: 0x0a/,
    'the icon background must match the launch background or a cold start flashes',
  );
});

test('captured App Store screenshots are at sizes App Store Connect accepts', () => {
  const screenshotRoot = path.join(submissionDir, 'screenshots');
  if (!existsSync(screenshotRoot)) {
    // Screenshots are regenerated from the built app, not required to be
    // present for the unit suite to pass.
    return;
  }

  const accepted: Record<string, [number, number]> = {
    'iphone-6-9': [1290, 2796],
    'iphone-6-5': [1242, 2688],
    'ipad-13': [2048, 2732],
  };

  for (const deviceId of readdirSync(screenshotRoot)) {
    const expected = accepted[deviceId];
    assert.ok(expected, `unexpected screenshot device folder: ${deviceId}`);

    const files = readdirSync(path.join(screenshotRoot, deviceId)).filter((name) => name.endsWith('.png'));
    assert.ok(files.length > 0, `${deviceId} has no screenshots`);

    for (const file of files) {
      const png = readFileSync(path.join(screenshotRoot, deviceId, file));
      assert.equal(png.readUInt32BE(16), expected[0], `${deviceId}/${file} width`);
      assert.equal(png.readUInt32BE(20), expected[1], `${deviceId}/${file} height`);
    }
  }
});

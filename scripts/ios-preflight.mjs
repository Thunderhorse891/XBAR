#!/usr/bin/env node
// iOS submission preflight.
//
//   npm run ios:preflight
//
// Checks everything about an App Store submission that can be verified from
// this repo on any machine — the assets, the compliance gates in the shipped
// code, and the metadata. It deliberately does NOT claim anything about the
// signed binary: archiving, signing, and upload happen on a Mac with Xcode and
// an Apple Developer account, and this script says so rather than pretending.
//
// Exit code 1 if any blocking check fails, so CI can gate on it.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

let blocking = 0;
let warnings = 0;

const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = (relativePath) => existsSync(path.join(repoRoot, relativePath));

function pass(message) {
  console.log(`  ✓ ${message}`);
}

function fail(message, fix) {
  blocking += 1;
  console.log(`  ✗ ${message}`);
  if (fix) console.log(`      fix: ${fix}`);
}

function warn(message, note) {
  warnings += 1;
  console.log(`  ! ${message}`);
  if (note) console.log(`      ${note}`);
}

function section(title) {
  console.log(`\n${title}`);
}

function check(condition, okMessage, failMessage, fix) {
  if (condition) pass(okMessage);
  else fail(failMessage, fix);
}

console.log('XBAR — iOS App Store preflight');

// ---------------------------------------------------------------- identity --
section('App identity');
{
  const config = read('capacitor.config.ts');
  const appId = config.match(/appId: '([^']+)'/)?.[1];
  const appName = config.match(/appName: '([^']+)'/)?.[1];

  check(
    appId && /^[a-z0-9.]+$/.test(appId) && appId.split('.').length >= 3,
    `bundle id ${appId}`,
    `capacitor.config.ts appId is missing or not a reverse-DNS identifier (got ${appId ?? 'nothing'})`,
    'set appId to the identifier registered in App Store Connect',
  );
  check(Boolean(appName), `app name ${appName}`, 'capacitor.config.ts has no appName');
  check(
    /webDir: 'dist'/.test(config),
    'webDir points at the Vite build output',
    'capacitor.config.ts webDir must be "dist"',
  );
  check(
    !/server:\s*\{\s*url:/.test(config.replace(/process\.env\.CAP_SERVER_URL[\s\S]*?undefined,/, '')),
    'no hard-coded live-reload server URL',
    'capacitor.config.ts pins a server.url — a submitted binary must load its bundled assets',
    'remove server.url, or keep it behind the CAP_SERVER_URL env guard',
  );
}

// ------------------------------------------------------------------ assets --
section('Submission assets');
{
  const iconPath = 'ios-submission/AppIcon.appiconset/icon-1024.png';
  if (!exists(iconPath)) {
    fail('App Store icon has not been generated', 'npm run ios:assets');
  } else {
    const png = readFileSync(path.join(repoRoot, iconPath));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const colorType = png[25];

    check(
      width === 1024 && height === 1024,
      `app icon is ${width}x${height}`,
      `app icon must be 1024x1024, got ${width}x${height}`,
    );
    check(
      colorType !== 4 && colorType !== 6,
      'app icon has no alpha channel',
      'app icon carries an alpha channel — App Store Connect rejects this on upload',
      'npm run ios:assets (re-encodes without alpha)',
    );
  }

  check(
    exists('ios-submission/PrivacyInfo.xcprivacy'),
    'privacy manifest present',
    'PrivacyInfo.xcprivacy is missing — required for App Store submission',
  );
  check(
    exists('ios-submission/Info.plist.additions.plist'),
    'Info.plist permission strings present',
    'Info.plist.additions.plist is missing',
  );
  check(
    exists('ios-submission/APP-STORE-METADATA.md'),
    'App Store Connect metadata drafted',
    'APP-STORE-METADATA.md is missing — the listing copy has nowhere to come from',
  );
}

// ----------------------------------------------------------- listing URLs --
section('Required listing URLs resolve');
{
  // App Store Connect requires a Support URL and a Privacy Policy URL, and
  // rejects a listing where either 404s. Both are pages this repo generates,
  // so their existence is checkable here; only the deployed origin is not.
  const pages = read('scripts/marketing/pages.mjs');
  const metadata = read('ios-submission/APP-STORE-METADATA.md');

  check(
    /path: '\/support'/.test(pages),
    'Support URL — /support is a generated page',
    'Support URL — the marketing site has no /support page, so the required Support URL would 404',
    'add a /support page to scripts/marketing/pages.mjs and list it in marketingPages',
  );
  check(
    /legalPage\(getLegalDocument\('privacy'\), '\/privacy'\)/.test(read('scripts/build-marketing.mjs')),
    'Privacy policy URL — /privacy is generated from the legal library',
    'Privacy policy URL — /privacy is no longer generated',
  );

  // The listing must not point at a host that is not serving the site yet.
  const origin = read('scripts/marketing/render.mjs').match(/'(https:\/\/[^']+)'/)?.[1] ?? '';
  const metadataHosts = [
    ...metadata.matchAll(/\| (?:Support|Marketing|Privacy policy)[^|]*\| `(https:\/\/[^/`]+)/g),
  ].map((match) => match[1]);
  const mismatched = [...new Set(metadataHosts.filter((host) => host !== origin))];

  if (!metadataHosts.length) {
    fail('listing URLs are not filled in APP-STORE-METADATA.md');
  } else if (mismatched.length) {
    warn(
      `listing URLs use ${mismatched.join(', ')} but the site builds for ${origin}`,
      'set PUBLIC_SITE_ORIGIN to the custom domain and redeploy before entering these, or the URLs will 404',
    );
  } else {
    pass(`listing URLs match the built origin (${origin})`);
  }
}

// ------------------------------------------------------------- screenshots --
section('Screenshots');
{
  const required = {
    'iphone-6-9': { pixels: [1290, 2796], blocking: true, label: '6.9" iPhone' },
    'iphone-6-5': { pixels: [1242, 2688], blocking: false, label: '6.5" iPhone' },
    'ipad-13': { pixels: [2048, 2732], blocking: false, label: '13" iPad (required only if you ship for iPad)' },
  };
  const root = path.join(repoRoot, 'ios-submission', 'screenshots');

  for (const [id, spec] of Object.entries(required)) {
    const dir = path.join(root, id);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      const message = `${spec.label} screenshots missing`;
      if (spec.blocking) fail(message, 'npm run build:local && npm run ios:screenshots');
      else warn(message, 'npm run ios:screenshots');
      continue;
    }

    const files = readdirSync(dir).filter((name) => name.endsWith('.png'));
    const wrong = files.filter((name) => {
      const png = readFileSync(path.join(dir, name));
      return png.readUInt32BE(16) !== spec.pixels[0] || png.readUInt32BE(20) !== spec.pixels[1];
    });

    if (!files.length) fail(`${spec.label} folder has no PNGs`, 'npm run ios:screenshots');
    else if (wrong.length) fail(`${spec.label}: ${wrong.join(', ')} are not ${spec.pixels.join('x')}`);
    else pass(`${spec.label}: ${files.length} screenshots at ${spec.pixels.join('x')}`);
  }
}

// ------------------------------------------------------- review guidelines --
section('App Review guidelines');
{
  const subscriptions = read('src/routes/Subscriptions.tsx');
  const login = read('src/routes/Login.tsx');
  const app = read('src/App.tsx');
  const settings = read('src/routes/Settings.tsx');

  // 3.1.1 — no digital purchases outside In-App Purchase.
  const guardsHandler = /if \(purchaseBlockedInApp\) \{\s*return;/.test(subscriptions);
  const readinessCalls = (subscriptions.match(/getCheckoutReadiness\(\{/g) ?? []).length;
  const flaggedCalls = (subscriptions.match(/purchaseBlockedInApp,/g) ?? []).length;

  check(
    guardsHandler && readinessCalls > 0 && readinessCalls === flaggedCalls,
    '3.1.1 — the iOS build cannot start a Stripe checkout',
    '3.1.1 — a purchase path is still reachable in the native build',
    'gate every getCheckoutReadiness call and beginCheckout on isExternalPurchaseBlocked()',
  );
  check(
    /purchaseBlockedInApp \? null : <a href="\/pricing">/.test(login),
    '3.1.1 — the sign-in screen hides the marketing pricing link natively',
    '3.1.1 — Login.tsx links to /pricing unconditionally',
  );

  // 5.1.1(v) — in-app account deletion.
  check(
    /Permanently delete my account/.test(settings) && /deleteAccount\(/.test(settings),
    '5.1.1(v) — account deletion is available in the app',
    '5.1.1(v) — no in-app account deletion found in Settings',
  );

  // 5.1.1 — privacy policy reachable in-app, before sign-in.
  const legalIndex = app.indexOf('<Route path="/legal"');
  check(
    legalIndex > 0 && legalIndex < app.indexOf('<RequireCloudAuth>'),
    '5.1.1 — privacy policy and terms are readable without an account',
    '5.1.1 — /legal is missing or sits behind authentication',
  );

  // 4.8 — Sign in with Apple alongside other social logins.
  const socialProviders = login.match(/\['google', 'facebook', 'apple'\]/);
  check(
    Boolean(socialProviders),
    '4.8 — Sign in with Apple is offered alongside the other social logins',
    '4.8 — third-party sign-in is offered without Sign in with Apple',
  );

  // 2.1 — exports must actually produce a file on iOS.
  check(
    exists('src/lib/fileDelivery.ts') && /Share\.share/.test(read('src/lib/fileDelivery.ts')),
    '2.1 — file exports route through the native share sheet',
    '2.1 — exports use <a download>, which silently does nothing in a WKWebView',
  );

  // 4.0 — chrome must clear the notch and home indicator.
  check(
    exists('src/styles/nativeShell.css') && /safe-area-inset-bottom/.test(read('src/styles/nativeShell.css')),
    '4.0 — safe-area insets are applied to the native shell',
    '4.0 — no safe-area handling; app chrome will sit under the Dynamic Island',
  );
  check(
    /viewport-fit=cover/.test(read('index.html')),
    '4.0 — viewport-fit=cover is set so env(safe-area-inset-*) resolves',
    'index.html is missing viewport-fit=cover — the safe-area CSS will be inert',
  );
}

// -------------------------------------------------------------- permissions --
section('Permission strings match real code paths');
{
  const additions = read('ios-submission/Info.plist.additions.plist');
  const capabilities = [
    {
      key: 'NSCameraUsageDescription',
      file: 'src/routes/AnimalProfile.tsx',
      pattern: /capture="environment"/,
      what: 'camera capture',
    },
    {
      key: 'NSLocationWhenInUseUsageDescription',
      file: 'src/routes/Weather.tsx',
      pattern: /geolocation\.getCurrentPosition/,
      what: 'local weather lookup',
    },
  ];

  for (const capability of capabilities) {
    const declared = additions.includes(`<key>${capability.key}</key>`);
    const used = capability.pattern.test(read(capability.file));

    if (declared && used) pass(`${capability.key} — declared, and ${capability.what} is in the code`);
    else if (!declared && used)
      fail(`${capability.what} is used but ${capability.key} is not declared — iOS will crash the WebView`);
    else if (declared && !used)
      warn(
        `${capability.key} is declared but ${capability.what} was not found`,
        'Apple rejects capabilities the app never uses — remove the key or restore the feature',
      );
    else pass(`${capability.key} — not declared, not used`);
  }
}

// -------------------------------------------------------------- mac-only --
section('Requires a Mac with Xcode (not checkable here)');
console.log('  · npx cap add ios && npm run mobile:sync');
console.log('  · add PrivacyInfo.xcprivacy to the App target, merge Info.plist.additions.plist');
console.log('  · drop in ios-submission/AppIcon.appiconset, set the launch screen to #05070A');
console.log('  · signing team, bundle id, marketing version, build number');
console.log('  · Product ▸ Archive ▸ Distribute App ▸ App Store Connect');

// ----------------------------------------------------------------- summary --
console.log(`\n${blocking === 0 ? 'PASS' : 'BLOCKED'} — ${blocking} blocking, ${warnings} warning(s)`);
if (blocking > 0) {
  console.log('Fix the ✗ items above before submitting.');
  process.exit(1);
}

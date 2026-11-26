import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Run after cap sync against what Xcode will actually package. CI also checks
// the compiled .app resource directory, so target membership is not assumed.
const root = process.argv[2] || 'ios/App/App';
const config = JSON.parse(readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
assert.equal(config.appId, 'com.xbar.ranch');
assert.equal(config.server?.url, undefined, 'A store binary must bundle its UI, never load a development server');
assert.notEqual(config.server?.cleartext, true, 'A store binary must not allow cleartext transport');
const html = readFileSync(path.join(root, 'public/index.html'), 'utf8');
assert.match(html, /<div id="root"><\/div>/, 'The app must contain the SPA, not the marketing homepage');
assert.match(html, /type="module"[^>]*src=/, 'Missing bundled application entry point');
assert.ok(existsSync(path.join(root, 'PrivacyInfo.xcprivacy')), 'Privacy manifest must be in the app resources');
console.log('iOS bundle: local SPA, stable app ID, no live reload or cleartext, privacy manifest present');

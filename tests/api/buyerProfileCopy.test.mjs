import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/*
 * Buyer-facing professionalism guardrails for the public sale profile.
 *
 * The public buyer profile is the first thing a stranger from Facebook sees.
 * These are source-level assertions (same pattern as
 * buyerPacketDownloadTruth.test.mjs): the route is not render-tested in this
 * suite, so the copy contracts are pinned here instead.
 */

const root = process.cwd();
const buyerProfile = readFileSync(path.join(root, 'src/routes/BuyerProfile.tsx'), 'utf8');
const buyerInquiries = readFileSync(path.join(root, 'api/_lib/buyer-inquiries.js'), 'utf8');
const indexHtml = readFileSync(path.join(root, 'index.html'), 'utf8');

test('document requests use buyer-plain language, never the internal "proof" kind', () => {
  assert.match(
    buyerInquiries,
    /Your document request was delivered to the seller\./,
    'the proof-requested success message regressed to internal "proof" language',
  );
  assert.doesNotMatch(
    buyerInquiries,
    /proof request was delivered/i,
    'internal "proof request" language is buyer-facing again',
  );
});

test('no dead mailto without a recipient on the public profile', () => {
  assert.doesNotMatch(buyerProfile, /mailto:\?/, 'a mailto: link with no recipient is back on the buyer profile');
});

test('internal scoring language is off the public profile', () => {
  assert.doesNotMatch(buyerProfile, /record complete/i, '"record complete" scoring copy is buyer-facing again');
  assert.match(buyerProfile, /record coverage/i, 'buyer-plain "record coverage" copy is missing');
  assert.doesNotMatch(buyerProfile, /Inquiry count/, 'the inquiry-count card is back on the buyer profile');
  assert.doesNotMatch(
    buyerProfile,
    /Buyer posture not disclosed/,
    'internal "buyer posture" language is buyer-facing again',
  );
});

test('photo copy is registry-neutral on the public profile', () => {
  assert.doesNotMatch(buyerProfile, /AQHA photos/, 'breed-assuming "AQHA photos" copy is back');
  assert.match(buyerProfile, /Sale photos/, 'registry-neutral "Sale photos" copy is missing');
  assert.match(buyerProfile, /No sale photos/, 'registry-neutral empty state is missing');
});

test('buyer form placeholders and price detail are buyer-plain', () => {
  assert.doesNotMatch(buyerProfile, /you@example\.com/, 'dev-flavored placeholder is back');
  assert.match(buyerProfile, /Your email address/, 'buyer-plain email placeholder is missing');
  assert.doesNotMatch(
    buyerProfile,
    /Contact ranch for financing options/,
    'ranch-internal financing copy is back under the asking price',
  );
  assert.match(buyerProfile, /Contact seller for payment terms/, 'buyer-plain price detail is missing');
});

test('the footer links XBAR support through the shared support-contact constant', () => {
  assert.match(buyerProfile, /SUPPORT_CONTACT\.email/, 'the footer no longer uses the shared XBAR support contact');
  assert.match(buyerProfile, />\s*Support\s*</, 'the footer support link is missing');
});

test('no dead seller-contact block promises contact it cannot render', () => {
  // The public listing payload carries no seller contact fields (the share RPC
  // and its sanitizer expose only listing metadata), so a SellerContactBlock
  // rendered from it always returned null — a contact promise the page could
  // never keep. It is gone; the inquiry panel is the documented contact path.
  assert.doesNotMatch(buyerProfile, /SellerContactBlock/, 'dead seller contact block is back');
  assert.doesNotMatch(buyerProfile, /readSellerContact/, 'dead contact reader is back');
  assert.match(buyerProfile, /The inquiry panel below is the contact path/, 'the contact path must be stated');
});

test('the app shell carries static social-unfurl fallback tags', () => {
  assert.match(indexHtml, /<meta property="og:title" content="XBAR — Horse sale profile" \/>/);
  assert.match(indexHtml, /<meta property="og:image" content="[^"]+\/brand\/og-card\.jpg" \/>/);
  assert.match(indexHtml, /<meta name="twitter:card" content="summary_large_image" \/>/);
});

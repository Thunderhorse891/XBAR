import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/*
 * The sale-packet email goes out under the RANCH's name to a buyer, and the
 * download link is the buyer's only way in. These pin the buyer-facing
 * promises: a 72-hour link (a 1-hour link dies before most buyers look), exact
 * instructions for getting a fresh one, a From name that is the ranch rather
 * than the platform, and a support email that cannot drift from the legal
 * track's single source of truth.
 *
 * Source-level assertions, matching tests/api/buyerPacketDownloadTruth.test.mjs:
 * importing the handler would pull the whole server dependency tree.
 */
const root = process.cwd();
const handlerSrc = readFileSync(path.join(root, 'api/sale-packets.js'), 'utf8');
const emailLibSrc = readFileSync(path.join(root, 'api/_lib/email.js'), 'utf8');
const legalSrc = readFileSync(path.join(root, 'src/lib/legalDocuments.ts'), 'utf8');

function supportEmailFromLegal() {
  const match = /SUPPORT_CONTACT\s*=\s*\{[^}]*email:\s*'([^']+)'/.exec(legalSrc);
  assert.ok(match, 'SUPPORT_CONTACT.email not found in src/lib/legalDocuments.ts');
  return match[1];
}

test('packet download links live 72 hours', () => {
  assert.ok(
    handlerSrc.includes('const SIGNED_URL_TTL_SECONDS = 72 * 3600;'),
    'buyer links must live 72 hours (72 * 3600s), not 1 — api/sale-packets.js changed the TTL',
  );
});

test('the email promises 72 hours and tells the buyer how to get a fresh link', () => {
  assert.ok(handlerSrc.includes('link expires in 72 hours'), 'email must state the 72-hour expiry');
  assert.ok(
    /reply to this email or contact the seller/i.test(handlerSrc),
    'email must tell the buyer exactly how to request a fresh link',
  );
  assert.ok(!handlerSrc.includes('link expires in 1 hour'), 'stale 1-hour copy must be gone');
});

test('the email is sent as the ranch with replies routed to the seller', () => {
  assert.ok(/fromName:\s*sellerDisplayName/.test(handlerSrc), 'From display name must be the ranch');
  assert.ok(/replyTo,/.test(handlerSrc), 'Reply-To must be passed through');
  assert.ok(
    /replyTo\s*=\s*context\.workspace\.operationsEmail/.test(handlerSrc),
    "Reply-To must be the seller's ops email",
  );
  assert.ok(/reply_to:\s*replyToAddress/.test(emailLibSrc), 'the email module must forward Reply-To to Resend');
  assert.ok(/replyTo:\s*\{\s*email:\s*replyToAddress\s*\}/.test(emailLibSrc), 'and to SendGrid');
});

test('the email signature carries the support contact, never a fake phone or address', () => {
  assert.ok(handlerSrc.includes('SUPPORT_EMAIL'), 'signature must use the support contact constant');
  assert.ok(!/\+1[\d\s()-]{7,}|\(\d{3}\)\s*\d{3}/.test(handlerSrc), 'no invented phone number in the packet email');
});

test('the support email matches the legal track single source of truth', () => {
  const canonical = supportEmailFromLegal();
  assert.equal(canonical, 'Xbarje@gmail.com');
  const fallback = /const SUPPORT_EMAIL\s*=\s*process\.env\.SUPPORT_EMAIL\s*\|\|\s*'([^']+)'/.exec(handlerSrc);
  assert.ok(fallback, 'SUPPORT_EMAIL fallback not found in api/sale-packets.js');
  assert.equal(fallback[1], canonical, 'the api fallback must mirror SUPPORT_CONTACT.email — update both or neither');
});

test('no buyer-facing fallback names the platform when the ranch name is unset', () => {
  assert.ok(!handlerSrc.includes("'An XBAR workspace'"), 'email body must not fall back to the platform name');
  assert.ok(!handlerSrc.includes("'XBAR workspace'"), 'PDF cover must not fall back to the platform name');
  assert.ok(handlerSrc.includes("|| 'A horse seller'"), 'unset business names fall back to a neutral "A horse seller"');
});

test('the verify link always prints an absolute URL', () => {
  assert.ok(
    /const appOrigin =[\s\S]*?'https:\/\/xbar\.app'/.test(handlerSrc),
    'appOrigin must fall back to the canonical domain so the packet never prints a dead relative path',
  );
});

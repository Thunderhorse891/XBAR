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
    /replyTo\s*=\s*identity\.email\s*\|\|\s*user\?\.email/.test(handlerSrc),
    "Reply-To must be the seller's ops email with the quick-start sentinel filtered",
  );
  assert.ok(/reply_to:\s*replyToAddress/.test(emailLibSrc), 'the email module must forward Reply-To to Resend');
  assert.ok(
    /reply_to:\s*\{\s*email:\s*replyToAddress\s*\}/.test(emailLibSrc),
    'SendGrid v3 wants reply_to (object) — the SDK-style replyTo field is ignored by the raw API',
  );
  assert.ok(
    /from:\s*\{\s*email:\s*fromAddress[\s\S]*?name:\s*fromNameValue/.test(emailLibSrc),
    'SendGrid from must carry the ranch display name as a separate name field, not drop it',
  );
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

test('quick-start placeholders never become the cloud packet sender identity', async () => {
  // Behavioral: the invented quick-start identity must not reach a buyer as
  // the sender. A fresh quick-start workspace stores 'My Ranch LLC' /
  // 'Main Ranch' / 'owner@ranch.local' — the packet email and its Presented
  // By block must degrade to an honest absence, not a false identity.
  const { isQuickStartSentinel, sellerIdentity } = await import('../../api/_lib/workspace-identity.js');

  assert.ok(isQuickStartSentinel('My Ranch LLC'));
  assert.ok(isQuickStartSentinel('Main Ranch'));
  assert.ok(isQuickStartSentinel('Operations Lead'));
  assert.ok(isQuickStartSentinel('OWNER@RANCH.LOCAL'), 'email match is case-insensitive');
  assert.ok(!isQuickStartSentinel('Rocking R Ranch'), 'a real ranch name is not a sentinel');

  const quickStart = sellerIdentity({
    businessName: 'My Ranch LLC',
    ranchName: 'Main Ranch',
    operationsEmail: 'owner@ranch.local',
  });
  assert.equal(quickStart.business, '', 'invented business name is not sender identity');
  assert.equal(quickStart.ranch, '', 'invented ranch name is not sender identity');
  assert.equal(quickStart.email, '', 'invented mailbox is not the reply-to');

  const real = sellerIdentity({
    businessName: 'Rocking R Ranch LLC',
    ranchName: 'Rocking R Ranch',
    operationsEmail: 'ranch@example.com',
  });
  assert.equal(real.business, 'Rocking R Ranch LLC');
  assert.equal(real.ranch, 'Rocking R Ranch');
  assert.equal(real.email, 'ranch@example.com');

  // The handler must build its sender identity through this helper.
  assert.ok(
    /sellerIdentity\(context\.workspace\)/.test(handlerSrc),
    'api/sale-packets.js must filter sender identity through sellerIdentity',
  );
  assert.ok(
    !/businessName \|\| context\.workspace\.ranchName/.test(handlerSrc),
    'no unfiltered businessName/ranchName may remain in sender construction',
  );
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

test('the SendGrid request body uses the v3 API field names (behavioral)', async () => {
  // Source assertions above pin the shape; this one serializes the actual
  // provider payload through a stubbed fetch, because a wrong field name in
  // the JSON body is exactly the failure a regex cannot feel.
  const email = await import('../../api/_lib/email.js');
  const prevSendgrid = process.env.SENDGRID_API_KEY;
  const prevResend = process.env.RESEND_API_KEY;
  const prevFetch = globalThis.fetch;
  let captured;
  process.env.SENDGRID_API_KEY = 'test-key';
  delete process.env.RESEND_API_KEY;
  globalThis.fetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return { ok: true, status: 202, text: async () => '' };
  };
  try {
    const result = await email.sendEmail({
      to: 'buyer@example.com',
      subject: 'Sale packet',
      text: 'hello',
      html: '<p>hello</p>',
      fromName: 'Rocking R Ranch',
      replyTo: 'seller@ranch.test',
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'sendgrid');
    assert.equal(captured.url, 'https://api.sendgrid.com/v3/mail/send');
    assert.equal(captured.body.reply_to.email, 'seller@ranch.test');
    assert.equal(captured.body.from.email, 'no-reply@xbar.app');
    assert.equal(captured.body.from.name, 'Rocking R Ranch');
    assert.ok(!('replyTo' in captured.body), 'SDK-style replyTo must never reach the raw v3 API');
  } finally {
    if (prevSendgrid === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = prevSendgrid;
    if (prevResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResend;
    globalThis.fetch = prevFetch;
  }
});

/*
 * The server seal must authenticate the SAME filtered seller identity the
 * PDF cover renders. buildServerSaleCredential hashed the raw workspace
 * (My Ranch LLC / Main Ranch) before the identity filter ran, so the seal
 * authenticated names the PDF omits. The handler now resolves
 * sellerIdentity(context.workspace) first and passes it as sellerIdentity —
 * the filter site and the seal site must not be reordered apart.
 */
test('the server seal is built over the filtered seller identity', () => {
  const filterAt = handlerSrc.indexOf('const identity = sellerIdentity(context.workspace);');
  const sealAt = handlerSrc.indexOf('const seal = buildServerSaleCredential({');
  assert.ok(filterAt !== -1, 'the handler must resolve the filtered seller identity');
  assert.ok(sealAt !== -1, 'the handler must build the server seal');
  assert.ok(filterAt < sealAt, 'the identity filter must run before the seal so the seal covers the filtered names');
  assert.ok(/sellerIdentity:\s*identity/.test(handlerSrc), 'the filtered identity must be passed into the seal');
});

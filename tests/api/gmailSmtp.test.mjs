import assert from 'node:assert/strict';
import test from 'node:test';
import nodemailer from 'nodemailer';
import { gmailSmtpStatus, sendGmailEmail } from '../../api/_lib/gmail-smtp.js';
import { isEmailConfigured, sendEmail } from '../../api/_lib/email.js';

const KEYS = [
  'GMAIL_SMTP_ENABLED',
  'GMAIL_SMTP_USER',
  'GMAIL_SMTP_APP_PASSWORD',
  'RESEND_API_KEY',
  'SENDGRID_API_KEY',
  'EMAIL_FROM_ADDRESS',
];
const READY = {
  GMAIL_SMTP_ENABLED: 'true',
  GMAIL_SMTP_USER: 'synthetic@gmail.com',
  GMAIL_SMTP_APP_PASSWORD: 'abcd efgh ijkl mnop',
};
const MAIL = {
  to: 'recipient@example.test',
  subject: 'Synthetic email',
  html: '<p>Example</p>',
  text: 'Example',
  fromName: 'Example Ranch',
  replyTo: 'seller@example.test',
};
async function withEnv(values, fn) {
  const saved = new Map(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
function fakeFactory(sendMail, seen = {}) {
  return (options) => {
    seen.options = options;
    return {
      sendMail: async (mail) => {
        seen.mail = mail;
        return sendMail(mail);
      },
      close() {
        seen.closed = true;
      },
    };
  };
}

test('Gmail readiness requires explicit opt-in, a Gmail address and an App Password shape', async () => {
  for (const values of [
    {},
    { ...READY, GMAIL_SMTP_ENABLED: 'yes' },
    { ...READY, GMAIL_SMTP_USER: 'sender@vercel.app' },
    { ...READY, GMAIL_SMTP_APP_PASSWORD: 'short' },
  ]) {
    await withEnv(values, async () => {
      assert.equal(gmailSmtpStatus().configured, false);
      assert.equal(isEmailConfigured(), false);
    });
  }
  await withEnv(READY, async () => {
    assert.equal(gmailSmtpStatus().configured, true);
    assert.equal(isEmailConfigured(), true);
  });
});

test('Gmail uses authenticated sender, verified TLS and bounded non-pooled SMTP', async () =>
  withEnv(READY, async () => {
    const seen = {};
    const result = await sendGmailEmail(
      MAIL,
      fakeFactory(async () => ({ accepted: [MAIL.to], rejected: [] }), seen),
    );
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'gmail-smtp');
    assert.equal(seen.options.host, 'smtp.gmail.com');
    assert.equal(seen.options.port, 465);
    assert.equal(seen.options.secure, true);
    assert.equal(seen.options.tls.rejectUnauthorized, true);
    assert.equal(seen.options.tls.minVersion, 'TLSv1.2');
    assert.equal(seen.options.pool, false);
    assert.equal(seen.options.logger, false);
    assert.equal(seen.options.auth.pass, 'abcdefghijklmnop');
    assert.equal(seen.options.socketTimeout, 10000);
    assert.equal(seen.mail.from.address, READY.GMAIL_SMTP_USER);
    assert.equal(seen.mail.from.name, MAIL.fromName);
    assert.equal(seen.mail.replyTo.address, MAIL.replyTo);
    assert.equal(seen.mail.disableFileAccess, true);
    assert.equal(seen.mail.disableUrlAccess, true);
    assert.equal(seen.closed, true);
  }));

test('Gmail cannot open a connection while disabled or for multiple recipients', async () => {
  await withEnv({}, async () =>
    assert.equal((await sendGmailEmail(MAIL, () => assert.fail('must not connect'))).skipped, true),
  );
  await withEnv(READY, async () =>
    assert.equal(
      (
        await sendGmailEmail({ ...MAIL, to: 'one@example.test,two@example.test' }, () =>
          assert.fail('must not connect'),
        )
      ).rejected,
      true,
    ),
  );
});

test('Gmail requires positive acceptance for the intended single recipient', async () =>
  withEnv(READY, async () => {
    for (const info of [
      {},
      { accepted: ['other@example.test'] },
      { accepted: [MAIL.to], rejected: [MAIL.to] },
      { accepted: [MAIL.to], pending: [MAIL.to] },
    ]) {
      const result = await sendGmailEmail(
        MAIL,
        fakeFactory(async () => info),
      );
      assert.equal(result.ok, false);
      assert.notEqual(result.retryable, true);
    }
  }));

test('Gmail negative acknowledgements, rate limits and ambiguous timeouts are distinct', async () =>
  withEnv(READY, async () => {
    for (const [error, rejected, retryable, backoff] of [
      [{ responseCode: 535, response: 'secret should not leak' }, true, false],
      [{ responseCode: 450 }, true, true, 3600],
      [{ responseCode: 550, response: '550 5.4.5 daily sending limit' }, true, true, 86400],
      [{ code: 'ETIMEDOUT', message: 'secret should not leak' }, false, false],
    ]) {
      const result = await sendGmailEmail(
        MAIL,
        fakeFactory(async () => {
          throw error;
        }),
      );
      assert.equal(result.ok, false);
      assert.equal(Boolean(result.rejected), rejected);
      assert.equal(Boolean(result.retryable), retryable);
      assert.equal(result.retryAfterSeconds, backoff);
      assert.ok(!result.message.includes('secret should not leak'));
    }
  }));

test('shared email dispatch reaches Gmail only after API providers, without sender spoofing', async () =>
  withEnv({ ...READY, EMAIL_FROM_ADDRESS: 'XBAR <not-owned@example.test>' }, async () => {
    const originalTransport = nodemailer.createTransport;
    const originalFetch = globalThis.fetch;
    const seen = {};
    let connections = 0;
    nodemailer.createTransport = (options) => {
      connections += 1;
      return fakeFactory(async () => ({ accepted: [MAIL.to], rejected: [] }), seen)(options);
    };
    globalThis.fetch = async () => {
      throw new Error('HTTP provider should not be called');
    };
    try {
      const result = await sendEmail({ ...MAIL, fromEmail: 'not-owned@example.test' });
      assert.equal(result.provider, 'gmail-smtp');
      assert.equal(seen.mail.from.address, READY.GMAIL_SMTP_USER);
      assert.match(seen.mail.html, /Synthetic|Example/);
      process.env.RESEND_API_KEY = 'synthetic-api-key';
      globalThis.fetch = async () => new Response('{}', { status: 200 });
      assert.equal((await sendEmail(MAIL)).provider, 'resend');
      delete process.env.RESEND_API_KEY;
      process.env.SENDGRID_API_KEY = 'synthetic-api-key';
      assert.equal((await sendEmail(MAIL)).provider, 'sendgrid');
      assert.equal(connections, 1);
    } finally {
      nodemailer.createTransport = originalTransport;
      globalThis.fetch = originalFetch;
    }
  }));

test('Gmail accepts the real Nodemailer envelope for an internationalized recipient domain', async () =>
  withEnv(READY, async () => {
    const mime = nodemailer.createTransport({ streamTransport: true, buffer: true });
    let envelope;
    try {
      const result = await sendGmailEmail(
        { ...MAIL, to: 'recipient@bücher.example' },
        fakeFactory(async (message) => {
          const info = await mime.sendMail(message);
          envelope = info.envelope;
          return { accepted: info.envelope.to, rejected: [] };
        }),
      );
      assert.deepEqual(envelope.to, ['recipient@xn--bcher-kva.example']);
      assert.equal(result.ok, true);
      assert.equal(
        (
          await sendGmailEmail({ ...MAIL, to: '"quoted"@example.test' }, () =>
            assert.fail('unsupported mailbox syntax must not send'),
          )
        ).rejected,
        true,
      );
    } finally {
      mime.close();
    }
  }));

test('malformed recipient domains and dot-atoms cannot change the target', async () =>
  withEnv(READY, async () => {
    for (const to of [
      'recipient@example.test/path',
      'recipient@example.test#bad',
      'recipient@example.test?query',
      'recipient@example.test%2fpath',
      'recipient@example.test:465',
      'recipient@example.test\\path',
      '.a@example.test',
      'a.@example.test',
      'a..b@example.test',
      'recipient@-example.test',
      'recipient@example-.test',
      'recipient@127.1',
      'recipient@0177.0.0.1',
    ]) {
      // Ordinary surrounding whitespace is trimmed, but embedded controls and
      // URL/path syntax must never turn a malformed target into a different one.
      const result = await sendGmailEmail({ ...MAIL, to }, () =>
        assert.fail(`must not connect for ${JSON.stringify(to)}`),
      );
      assert.equal(result.rejected, true, to);
    }
  }));
